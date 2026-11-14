// One data path for every place: vectors table -> Sun/Earth angles -> per-sample state.
//
// A built-in site, a custom point and the equatorial reference all go through
// skyFromVectors + buildSeries; they differ only in the horizon they have (a precomputed
// file, an answer of the terrain service, or none = sphere model).
import { useEffect, useMemo, useState } from "react";
import { loadSiteTerrain, loadSkyTables, type SiteTerrain, type SkyTables } from "../data/load.ts";
import { TerrainError, fetchHorizon, insideTerrainCoverage, terrainConfigured } from "../data/terrain.ts";
import { findTransitions, limbClearance, type Transitions } from "../engine/events.ts";
import { pointHorizon } from "../engine/grid.ts";
import { horizonForMast, mastAdjustable } from "../engine/mast.ts";
import { DEFAULT_PROFILE, EARTH_RADIUS_DEG, SUN_RADIUS_DEG, buildSeries, raisedHorizon, type Horizon, type Profile, type Series, type SkySeries } from "../engine/risk.ts";
import { skyFromVectors } from "../engine/sky.ts";
import { useEffectiveProfile } from "./limits.ts";
import type { Place } from "./scenario.ts";

let tablesPromise: Promise<SkyTables> | null = null;

/** The site-independent tables, loaded once for the page. */
export function useSkyTables(): { tables: SkyTables | null; error: string | null } {
  const [result, setResult] = useState<{ tables: SkyTables | null; error: string | null }>({ tables: null, error: null });
  useEffect(() => {
    let alive = true;
    tablesPromise ??= loadSkyTables();
    tablesPromise.then(
      (tables) => alive && setResult({ tables, error: null }),
      (error: Error) => alive && setResult({ tables: null, error: error.message }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return result;
}

export type TerrainStatus =
  /** Terrain horizon in use. */
  | "terrain"
  /** Waiting for the terrain file or service; the sphere model is shown meanwhile. */
  | "loading"
  /** Sphere model: no terrain exists or could be fetched for this place. */
  | "sphere";

interface TerrainState {
  placeId: string;
  terrain: SiteTerrain | null;
  /** Position actually assessed (the service snaps a point to the nearest height pixel). */
  center: { lat: number; lon: number } | null;
  status: TerrainStatus;
  /** Why there is no terrain, for the panel. */
  reason: string | null;
}

function sphereReason(place: Place): string | null {
  if (place.kind === "reference") return "Outside the terrain data";
  if (place.kind === "custom") {
    if (!insideTerrainCoverage(place.lat, place.lon)) return "Outside the terrain data (60° S to the pole)";
    if (!terrainConfigured()) return "Terrain service not connected";
  }
  return null;
}

/** Terrain of a place: a precomputed file for built-in sites, the terrain service for custom points. */
function useTerrain(place: Place | null): TerrainState | null {
  const [loaded, setLoaded] = useState<TerrainState | null>(null);

  useEffect(() => {
    if (!place) return;
    const controller = new AbortController();
    const done = (patch: Omit<TerrainState, "placeId">) => {
      if (!controller.signal.aborted) setLoaded({ placeId: place.id, ...patch });
    };
    if (place.kind === "site") {
      loadSiteTerrain(place.key).then(
        (terrain) => done({ terrain, center: null, status: "terrain", reason: null }),
        () => done({ terrain: null, center: null, status: "sphere", reason: "Terrain file could not be loaded" }),
      );
    } else if (place.kind === "custom" && terrainConfigured() && insideTerrainCoverage(place.lat, place.lon)) {
      // A newer click aborts this request (see the cleanup below).
      fetchHorizon({ lat: place.lat, lon: place.lon, grid: 1, precision: DEFAULT_PROFILE.landing_precision_m }, controller.signal).then(
        (grid) => {
          const point = grid.points[0];
          done({
            terrain: {
              horizon: pointHorizon(point),
              horizonRangeKm: [],
              mastM: point.mast_m,
              groundHeightM: point.ground_height_m ?? 0,
              slopeP95Deg: point.slope_deg,
              slopeRadiusM: grid.precision_m,
              heightErrorM: null,
            },
            center: grid.center,
            status: "terrain",
            reason: null,
          });
        },
        (error: unknown) => {
          const reason = error instanceof TerrainError ? error.message : "The terrain service cannot be reached";
          done({ terrain: null, center: null, status: "sphere", reason });
        },
      );
    }
    return () => controller.abort();
  }, [place]);

  // Until the terrain arrives (or when there is none) the place is shown on the sphere model.
  const fallback = useMemo((): TerrainState | null => {
    if (!place) return null;
    const reason = sphereReason(place);
    return { placeId: place.id, terrain: null, center: null, status: reason ? "sphere" : "loading", reason };
  }, [place]);
  return place && loaded?.placeId === place.id ? loaded : fallback;
}

/** Everything the panels need about one place, over the whole date range. */
export interface PlaceData {
  place: Place;
  /** Position assessed; differs from the place by up to ~42 m when the terrain service snapped it. */
  lat: number;
  lon: number;
  sky: SkySeries;
  series: Series;
  /** Horizon in use; null = sphere model. */
  horizon: Horizon | null;
  terrain: SiteTerrain | null;
  status: TerrainStatus;
  sphereReason: string | null;
  /** Rise and set events of the Sun's and the Earth's upper limb. */
  sunEvents: Transitions;
  earthEvents: Transitions;
  /** Slope statistic for the surface score; null on the sphere model. */
  slopeP95Deg: number | null;
  mast: MastState;
  /**
   * The same place with the horizon raised by what the map's height error allows
   * (engine/risk.ts, raisedHorizon); null where the error or the obstruction distances
   * are not known (sphere model, custom points).
   */
  mapError: { series: Series; heightErrorM: number; maxDeg: number } | null;
}

export interface MastState {
  /** Observer height the horizon in use stands for, meters. */
  heightM: number;
  /**
   * "base": the precomputed profile; "estimate": first-order formula (engine/mast.ts);
   * "exact": recomputed by the terrain service; "fixed": this place has no adjustable horizon.
   */
  mode: "base" | "estimate" | "exact" | "fixed";
}

/** Sun/Earth angles are a few milliseconds of work per place; keep the last few. */
const skyCache = new Map<string, SkySeries>();

function skyFor(tables: SkyTables, lat: number, lon: number): SkySeries {
  const key = `${lat},${lon}`;
  let sky = skyCache.get(key);
  if (!sky) {
    // Height 0, like the backend's per-site tables: terrain enters through the horizon only.
    sky = skyFromVectors(tables.vectors, lat, lon, 0);
    if (skyCache.size >= 8) skyCache.delete(skyCache.keys().next().value!);
    skyCache.set(key, sky);
  }
  return sky;
}

export function buildPlaceData(
  tables: SkyTables,
  place: Place,
  terrain: SiteTerrain | null,
  horizon: Horizon | null,
  status: TerrainStatus,
  reason: string | null,
  center: { lat: number; lon: number } | null,
  mast: MastState,
  profile: Profile,
): PlaceData {
  const lat = center?.lat ?? place.lat;
  const lon = center?.lon ?? place.lon;
  const sky = skyFor(tables, lat, lon);
  const series = buildSeries(sky, horizon, tables.stationMaxAlt, profile);
  let mapError: PlaceData["mapError"] = null;
  if (horizon && terrain && terrain.heightErrorM !== null && terrain.horizonRangeKm.length === horizon.horizonDeg.length) {
    const raised = raisedHorizon(horizon, terrain.horizonRangeKm, terrain.heightErrorM);
    mapError = {
      series: buildSeries(sky, raised.horizon, tables.stationMaxAlt, profile),
      heightErrorM: terrain.heightErrorM,
      maxDeg: raised.maxDeg,
    };
  }
  return {
    place,
    lat,
    lon,
    sky,
    series,
    horizon,
    terrain,
    status,
    sphereReason: reason,
    sunEvents: findTransitions(limbClearance(series.sunAboveTerrain, SUN_RADIUS_DEG)),
    earthEvents: findTransitions(limbClearance(series.earthAboveTerrain, EARTH_RADIUS_DEG)),
    slopeP95Deg: terrain?.slopeP95Deg ?? null,
    mast,
    mapError,
  };
}

/** How long the mast slider must rest before the terrain service is asked, milliseconds. */
const MAST_REQUEST_DELAY_MS = 350;

/**
 * Exact horizon for a mast height from the terrain service, when one is configured.
 * Returns null while there is none (no service, the base height, a request under way or
 * failed); the caller then falls back to the estimate.
 */
function useExactMastHorizon(place: Place | null, lat: number | null, lon: number | null, mastM: number, baseMastM: number | null) {
  const [exact, setExact] = useState<{ key: string; horizon: Horizon } | null>(null);
  const wanted = place && lat !== null && lon !== null && baseMastM !== null && mastM !== baseMastM && terrainConfigured() && insideTerrainCoverage(lat, lon);
  const key = wanted ? `${place.id}|${mastM}` : null;

  useEffect(() => {
    if (!key || lat === null || lon === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchHorizon({ lat, lon, grid: 1, mast: mastM, precision: DEFAULT_PROFILE.landing_precision_m }, controller.signal).then(
        (grid) => !controller.signal.aborted && setExact({ key, horizon: pointHorizon(grid.points[0]) }),
        // The estimate stays on screen; nothing to report.
        () => undefined,
      );
    }, MAST_REQUEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, lat, lon, mastM]);

  return exact && exact.key === key ? exact.horizon : null;
}

/**
 * Per-sample state of a place over the whole table for an observer `mastM` above ground;
 * null until the tables have loaded.
 */
export function usePlaceSeries(tables: SkyTables | null, place: Place | null, mastM: number): PlaceData | null {
  const terrainState = useTerrain(place);
  const terrain = terrainState?.terrain ?? null;
  const exact = useExactMastHorizon(
    place,
    terrain ? (terrainState?.center?.lat ?? place?.lat ?? null) : null,
    terrain ? (terrainState?.center?.lon ?? place?.lon ?? null) : null,
    mastM,
    terrain?.mastM ?? null,
  );
  const profile = useEffectiveProfile();
  return useMemo(() => {
    if (!tables || !place || !terrainState) return null;
    const { status, reason, center } = terrainState;
    let horizon: Horizon | null = null;
    let mast: MastState = { heightM: terrain?.mastM ?? mastM, mode: "fixed" };
    if (terrain) {
      if (exact) {
        horizon = exact;
        mast = { heightM: mastM, mode: "exact" };
      } else if (mastAdjustable(terrain)) {
        const adjusted = horizonForMast(terrain, mastM);
        horizon = adjusted.horizon;
        mast = { heightM: mastM, mode: adjusted.mode };
      } else {
        horizon = terrain.horizon;
      }
    }
    return buildPlaceData(tables, place, terrain, horizon, status, reason, center, mast, profile);
  }, [tables, place, terrainState, terrain, exact, mastM, profile]);
}
