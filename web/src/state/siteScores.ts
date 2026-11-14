// Live risk of every built-in site for the mission on screen: landing date, mission length,
// mast height and limits. Feeds the "Best" badge in the site list and the highlighted pins.
//
// Only the samples of the mission window are computed (engine/grid.ts, scorePlace), so the
// five sites take well under a millisecond each and follow every control as it moves.
import { useEffect, useMemo, useState } from "react";
import { loadSiteTerrain, type SiteInfo, type SiteTerrain, type SkyTables } from "../data/load.ts";
import { scorePlace } from "../engine/grid.ts";
import { horizonForMast, mastAdjustable } from "../engine/mast.ts";
import type { MissionWindow, Score } from "../engine/risk.ts";
import { useEffectiveProfile } from "./limits.ts";
import { useScenario } from "./scenario.ts";

export interface SiteScore {
  score: Score;
  window: MissionWindow;
}

export interface SiteScores {
  /** By site key; a site is missing while its terrain loads or when its window leaves the data. */
  byKey: Map<string, SiteScore>;
  /** Lowest risk (then most usable Sun) among the sites; null when every site is high risk. */
  bestKey: string | null;
}

export function useSiteScores(tables: SkyTables | null, sites: SiteInfo[]): SiteScores {
  const [terrains, setTerrains] = useState<Map<string, SiteTerrain>>(new Map());
  const startMs = useScenario((s) => s.startMs);
  const mastM = useScenario((s) => s.mastM);
  const hasLimits = useScenario((s) => s.limits !== null);
  const profile = useEffectiveProfile();

  useEffect(() => {
    let alive = true;
    for (const site of sites) {
      loadSiteTerrain(site.key).then(
        (terrain) => alive && setTerrains((current) => new Map(current).set(site.key, terrain)),
        // The site stays without a score; its own panel reports the missing file.
        () => undefined,
      );
    }
    return () => {
      alive = false;
    };
  }, [sites]);

  return useMemo(() => {
    const byKey = new Map<string, SiteScore>();
    if (!tables || !hasLimits) return { byKey, bestKey: null };
    for (const site of sites) {
      const terrain = terrains.get(site.key);
      if (!terrain) continue;
      // The mast estimate, as in the panel when the terrain service gives no exact profile.
      const horizon = mastAdjustable(terrain) ? horizonForMast(terrain, mastM).horizon : terrain.horizon;
      const result = scorePlace(tables.vectors, tables.stationMaxAlt, site.lat, site.lon, horizon, terrain.slopeP95Deg, profile, startMs);
      if (result) byKey.set(site.key, result);
    }
    let bestKey: string | null = null;
    let best: SiteScore | null = null;
    for (const [key, entry] of byKey) {
      if (entry.score.level === "high") continue;
      const better =
        !best ||
        entry.score.overall < best.score.overall ||
        (entry.score.overall === best.score.overall && entry.window.power.sunlit_pct > best.window.power.sunlit_pct);
      if (better) {
        best = entry;
        bestKey = key;
      }
    }
    return { byKey, bestKey };
  }, [tables, hasLimits, sites, terrains, mastM, profile, startMs]);
}
