// First-person view from the surface: real LOLA terrain, the Sun and the Earth where the
// ephemeris puts them, and the skyline the risk model uses. Lazy entry point (three.js lives
// in this chunk only).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { CornerUpLeft, Drone, Earth, PersonStanding, SlidersHorizontal, Sun, X } from "lucide-react";
import { HorizonView } from "../charts/HorizonView.tsx";
import { obstruction, rangeAt, sentence } from "../charts/why.ts";
import type { SkyTables } from "../data/load.ts";
import { MastControl } from "../panels/MastControl.tsx";
import { useSkyTables } from "../state/placeData.ts";
import { loadSiteTerrainPatch } from "../data/load.ts";
import { sampleAt } from "../engine/events.ts";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, horizonAt } from "../engine/risk.ts";
import { sampleIndex } from "../engine/sky.ts";
import { formatDistance } from "../geo/polar.ts";
import { getMode, modeActions, subscribeMode, useMode } from "../state/mode.ts";
import { pointDistanceM, type ScoredPoint } from "../engine/grid.ts";
import { betterSpot, hopOrigin, neighbourPlace, offsetText, type NearbyResult } from "../state/nearby.ts";
import { actions, getScenario, placeTitle, subscribeScenario, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { formatAngle } from "../ui/format.ts";
import { useMediaQuery } from "../ui/useMediaQuery.ts";
import { destination } from "./geometry.ts";
import { SurfaceScene, webgl2Available, type BeaconSpec, type HeatSpec } from "./scene.ts";
import type { TrackPoint } from "./sky.ts";
import "./surface.css";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const TWEEN_MS = 700;
/** Drag: degrees of view turned per pixel are the field of view over the canvas width. */
const KEY_STEP_DEG = 2;
/** Drone view: degrees the camera circles or tilts per pixel dragged. */
const ORBIT_DEG_PER_PX = 0.25;
/** Drone view: beyond this distance only the best spot keeps its label, meters. */
const DRONE_LABELS_WITHIN_M = 1500;
/** Planner below this width: the mast and ground controls move into a settings popover. */
const COMPACT_QUERY = "(max-width: 1399px)";
/** Phones: the settings button in both modes, the legend stacked under the tools. */
const PHONE_QUERY = "(max-width: 759px)";

/** What the ground around the place is tinted with: a score of every nearby grid point. */
type GroundOverlay = "off" | "risk" | "sun";
const OVERLAY_OPTIONS: { value: GroundOverlay; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "risk", label: "Risk" },
  { value: "sun", label: "Sun" },
];

type Rgb = [number, number, number];
/** Risk 0, 50 and 100: the colours of the low, medium and high levels. */
const RISK_RAMP: Rgb[] = [[48, 209, 88], [255, 214, 10], [255, 69, 58]];
/** Least to most usable Sun among the grid points (dark to bright, readable without colour vision). */
const SUN_RAMP: Rgb[] = [[59, 28, 140], [33, 144, 141], [253, 231, 37]];
const css = (ramp: Rgb[]) => `linear-gradient(90deg, ${ramp.map((c) => `rgb(${c.join(",")})`).join(", ")})`;

/** Colour at t (0-1) along a ramp of evenly spaced stops. */
function rampColor(ramp: Rgb[], t: number): Rgb {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => ramp[i][k] + (ramp[i + 1][k] - ramp[i][k]) * f) as Rgb;
}

interface Heat {
  spec: HeatSpec;
  /** Legend: the ramp and what its two ends stand for. */
  title: string;
  gradient: string;
  low: string;
  high: string;
  note: string;
}

/**
 * The scored grid as a ground tint. Risk uses the fixed 0-100 scale of the score; usable Sun
 * is stretched between the lowest and the highest value of the grid, which the legend names.
 */
function buildHeat(nearby: NearbyResult, overlay: Exclude<GroundOverlay, "off">): Heat | null {
  const { grid, scored } = nearby;
  const size = grid.grid;
  const step = grid.step_m;
  if (size < 2 || scored.length !== size * size) return null;
  const half = ((size - 1) / 2) * step;
  const cell = (entry: ScoredPoint) => ({ col: Math.round((entry.point.east_m + half) / step), row: Math.round((entry.point.north_m + half) / step) });
  const corner = (col: number, row: number) => scored.find((entry) => cell(entry).col === col && cell(entry).row === row)?.point;
  const [southWest, southEast, northWest] = [corner(0, 0), corner(size - 1, 0), corner(0, size - 1)];
  if (!southWest || !southEast || !northWest) return null;
  const value = (entry: ScoredPoint) => (overlay === "risk" ? entry.score.overall : entry.window.power.sunlit_pct);
  let lo = Infinity;
  let hi = -Infinity;
  for (const entry of scored) {
    lo = Math.min(lo, value(entry));
    hi = Math.max(hi, value(entry));
  }
  const colors = new Uint8Array(size * size * 4);
  for (const entry of scored) {
    const { col, row } = cell(entry);
    if (col < 0 || row < 0 || col >= size || row >= size) continue;
    const v = value(entry);
    const color = overlay === "risk" ? rampColor(RISK_RAMP, v / 100) : rampColor(SUN_RAMP, hi - lo < 0.05 ? 1 : (v - lo) / (hi - lo));
    colors.set([...color.map(Math.round), 255], (row * size + col) * 4);
  }
  const spec = { size, stepM: step, colors, southWest, southEast, northWest };
  const points = `${size * size} points, ${step} m apart`;
  if (overlay === "risk") return { spec, title: "Risk of this mission", gradient: css(RISK_RAMP), low: "0", high: "100", note: `${points} · here ${lo.toFixed(0)} to ${hi.toFixed(0)}` };
  return { spec, title: "Usable Sun in this mission", gradient: css(SUN_RAMP), low: `${lo.toFixed(0)} %`, high: `${hi.toFixed(0)} %`, note: points };
}

interface SurfaceViewProps {
  view: ScenarioView;
  /** Shows a close button (the Planner's overlay). */
  onClose?: () => void;
  /** Where the camera turns when a place opens; default: the Sun, or the Earth while the Sun is down. */
  look?: "sun" | "earth";
  /** Scored grid around the place: nearby points become beacons one can hop to. */
  nearby?: NearbyResult | null;
  /**
   * Planner: guide lines, the bodies' tracks, the blocking skyline, and the eight nearest
   * points and the best spot as beacons coloured by risk. Explorer: the Earth card, the
   * permanently shadowed region pin, the "why" caption, and the best spot only.
   */
  mode?: "plan" | "explore";
}

const SPEED_OF_LIGHT_KM_S = 299792.458;
const EARTH_RADIUS_KM = 6378.137;

const LEVEL_COLOR = { low: "#30d158", medium: "#ffd60a", high: "#ff453a" } as const;
const BEST_COLOR = "#0a84ff";
const FLIGHT_MS = 900;
const NEAREST_BEACONS = 8;

/** At most this many day labels along the Sun's track (a long mission labels every n-th day). */
const MAX_DAY_MARKS = 14;

interface DayMark {
  /** Days after the landing. */
  day: number;
  azimuthDeg: number;
  elevationDeg: number;
  /** The place sees the Sun at that moment. */
  visible: boolean;
}

interface Beacon extends BeaconSpec {
  label: string;
  /** Hop target. */
  index: number;
}

/** Signed difference a - b of two azimuths, -180..180. */
const azDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

export default function SurfaceView({ view, onClose, look, nearby, mode }: SurfaceViewProps) {
  const [supported] = useState(webgl2Available);
  if (!supported) return <Fallback view={view} reason="This browser cannot draw the 3D view (no WebGL 2)." />;
  return <SurfaceCanvas view={view} onClose={onClose} look={look} nearby={nearby} mode={mode} />;
}

export function Fallback({ view, reason }: { view: ScenarioView; reason: string }) {
  return (
    <div className="surface surface--fallback">
      <HorizonView view={view} />
      <p className="surface__note">{reason} The horizon chart shows the same skyline, Sun and Earth.</p>
    </div>
  );
}

function SurfaceCanvas({ view, onClose, look, nearby = null, mode: beaconMode = "plan" }: SurfaceViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const sunMarkRef = useRef<HTMLDivElement>(null);
  const earthMarkRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const landerRef = useRef<HTMLDivElement>(null);
  const beaconsRef = useRef<HTMLDivElement>(null);
  const earthCardRef = useRef<HTMLDivElement>(null);
  const psrRef = useRef<HTMLDivElement>(null);
  const whyRef = useRef<HTMLParagraphElement>(null);
  const hereRef = useRef<HTMLDivElement>(null);
  /** The drone camera needs a terrain mesh; without one the view stays first person. */
  const droneRef = useRef(false);
  const [overlay, setOverlay] = useState<GroundOverlay>("off");
  /** Where the Sun stands at the start of each mission day, along its track. */
  const [dayMarks, setDayMarks] = useState<DayMark[]>([]);
  const dayMarksRef = useRef<DayMark[]>([]);
  const daysRef = useRef<HTMLDivElement>(null);
  const { tables } = useSkyTables();
  const tablesRef = useRef<SkyTables | null>(null);
  const modeRef = useRef(beaconMode);
  /** Last blockers handed to the scene, so the skyline highlight is rebuilt only when it changes. */
  const blockersRef = useRef("");
  /** Camera position while flying to a nearby point (scene frame of the current place). */
  const flightRef = useRef<[number, number, number] | null>(null);
  const sceneRef = useRef<SurfaceScene | null>(null);
  const viewRef = useRef(view);
  const updateRef = useRef<() => void>(() => {});
  // What the terrain of a place turned out to be, once known.
  const [loaded, setLoaded] = useState<{ key: string; kind: "mesh" | "curtain" } | null>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    viewRef.current = view;
    tablesRef.current = tables;
    modeRef.current = beaconMode;
    dayMarksRef.current = dayMarks;
  });

  // Renderer, store subscriptions and the per-frame overlay.
  useEffect(() => {
    let scene: SurfaceScene;
    try {
      scene = new SurfaceScene(canvasRef.current!);
    } catch {
      // Reported from outside the effect's own run: the renderer is an external system.
      queueMicrotask(() => setFailed(true));
      return;
    }
    sceneRef.current = scene;
    const root = rootRef.current!;

    const update = () => {
      const v = viewRef.current;
      const s = getScenario();
      const m = getMode();
      const at = sampleAt(v.data.series, v.data.sky, v.startMs + s.offsetMs);
      const i = Math.round(at.position);
      scene.setState({
        sun: { azimuthDeg: at.sunAz, elevationDeg: at.sunAlt, radiusDeg: v.data.series.sunRadius[i] ?? SUN_RADIUS_DEG },
        earth: { azimuthDeg: at.earthAz, elevationDeg: at.earthAlt, radiusDeg: v.data.series.earthRadius[i] ?? EARTH_RADIUS_DEG },
        observerLit: at.solarFraction,
        eyeHeightM: v.data.mast.heightM,
        eye: flightRef.current ?? undefined,
        droneDistanceM: droneRef.current ? m.droneDistanceM : null,
        headingDeg: m.headingDeg,
        pitchDeg: m.pitchDeg,
        fovDeg: m.fovDeg,
        latDeg: v.data.lat,
        timeMs: at.ms,
      });
      drawCompass(compassRef.current, m.headingDeg, scene.horizontalFovDeg);
      placeMark(sunMarkRef.current, scene.project(at.sunAz, at.sunAlt), at.sunVisible, m.headingDeg, at.sunAz);
      placeMark(earthMarkRef.current, scene.project(at.earthAz, at.earthAlt), at.earthVisible, m.headingDeg, at.earthAz);
      const drone = droneRef.current;
      placeLanderLabel(landerRef.current, drone ? null : scene.landerShadowInfo());
      // From far away the labels of neighbours 125 m apart pile up: only the best spot keeps its own.
      placeBeaconLabels(beaconsRef.current, scene.beaconProjections(), drone && scene.cameraDistanceM > DRONE_LABELS_WITHIN_M);
      placeHere(hereRef.current, drone && !flightRef.current ? scene.observerProjection() : null);
      placeDayMarks(daysRef.current, drone ? null : dayMarksRef.current.map((mark) => scene.project(mark.azimuthDeg, mark.elevationDeg)));
      if (readoutRef.current && drone) {
        readoutRef.current.textContent = `Drone · ${formatDistance(scene.cameraDistanceM)} away · looking ${COMPASS[Math.round(m.headingDeg / 45) % 8]}`;
      } else if (readoutRef.current) {
        // What is at the center of the view: direction, and the skyline there with its distance.
        let skyline = "";
        if (v.data.horizon) {
          const km = rangeAt(v.data, m.headingDeg);
          skyline = ` · skyline ${formatAngle(horizonAt(v.data.horizon, m.headingDeg), 1)}${km !== null ? ` at ${formatDistance(km * 1000)}` : ""}`;
        }
        readoutRef.current.textContent = `${COMPASS[Math.round(m.headingDeg / 45) % 8]} ${m.headingDeg.toFixed(0)}°, ${formatAngle(m.pitchDeg, 0)}${skyline}`;
      }
      const blocked = [obstruction(v.data, "sun", at), obstruction(v.data, "earth", at)].filter((o) => o !== null);
      if (modeRef.current === "plan") {
        // The stretch of skyline that hides a body (0.25 deg steps, so the key changes rarely).
        const marks = blocked.filter((o) => o.byTerrain).map((o) => ({ azimuthDeg: Math.round(o.az * 4) / 4, color: o.kind === "sun" ? 0xffb340 : 0x64d2ff }));
        const key = JSON.stringify(marks);
        if (key !== blockersRef.current) {
          blockersRef.current = key;
          scene.setBlockers(marks);
        }
      } else {
        if (whyRef.current) whyRef.current.textContent = blocked.map((o) => sentence(o, true)).join(" ");
        writeEarthCard(earthCardRef.current, at, v.data.series.earthRadius[i] ?? EARTH_RADIUS_DEG, tablesRef.current, v.data.series.profile.station_min_elevation_deg);
        placePsrPin(psrRef.current, scene, v.data);
      }
    };
    updateRef.current = update;

    let pending = 0;
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(() => ((pending = 0), update()));
    };
    const offScenario = subscribeScenario(schedule);
    const offMode = subscribeMode(schedule);
    const resize = new ResizeObserver(() => {
      scene.resize(root.clientWidth, root.clientHeight);
      schedule();
    });
    resize.observe(root);
    scene.resize(root.clientWidth, root.clientHeight);
    update();
    return () => {
      cancelAnimationFrame(pending);
      offScenario();
      offMode();
      resize.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // The skyline and the terrain of the place on screen.
  const { data } = view;
  // A hopped-to point stands on the terrain patch of the site its grid belongs to.
  const hop = hopOrigin(data.place.id);
  const placeKey = data.place.kind === "site" ? data.place.key : hop?.origin.kind === "site" ? hop.origin.key : null;
  const groundM = data.terrain?.groundHeightM ?? null;
  useEffect(() => {
    sceneRef.current?.setHorizon(data.horizon);
    updateRef.current();
  }, [data.horizon]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setTerrain(null, 0, 0, 0);
    if (!placeKey) return;
    let cancelled = false;
    loadSiteTerrainPatch(placeKey).then(
      (patch) => {
        if (cancelled) return;
        scene.setTerrain(patch, data.lat, data.lon, data.place.kind === "site" || groundM === null ? patch.groundHeightM : groundM);
        setLoaded({ key: placeKey, kind: "mesh" });
      },
      () => {
        if (!cancelled) setLoaded({ key: placeKey, kind: "curtain" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [placeKey, data.lat, data.lon, data.place.kind, groundM]);

  // Beacons: nearby grid points one can hop to.
  const beaconList = useMemo((): Beacon[] => {
    if (!nearby) return [];
    const { scored, center } = nearby;
    const best = betterSpot(nearby);
    const here = center.point;
    const away = (p: typeof here) => Math.hypot(p.east_m - here.east_m, p.north_m - here.north_m);
    const picked = beaconMode === "explore" ? [] : scored.filter((entry) => entry !== center).sort((x, y) => away(x.point) - away(y.point)).slice(0, NEAREST_BEACONS);
    if (best && !picked.includes(best)) picked.push(best);
    return picked.map((entry) => {
      const isBest = entry === best;
      const rel = { ...entry.point, east_m: entry.point.east_m - here.east_m, north_m: entry.point.north_m - here.north_m };
      const where = pointDistanceM(rel) < 1 ? "Grid center" : offsetText(rel);
      return {
        lat: entry.point.lat,
        lon: entry.point.lon,
        groundHeightM: entry.point.ground_height_m ?? 0,
        color: isBest ? BEST_COLOR : beaconMode === "explore" ? "#ffffff" : LEVEL_COLOR[entry.score.level],
        best: isBest,
        label: `${isBest ? "Best spot · " : ""}${where} · Risk ${entry.score.overall.toFixed(0)}`,
        index: nearby.scored.indexOf(entry),
      };
    });
  }, [nearby, beaconMode]);

  const terrainReady = loaded?.key === placeKey && loaded?.kind === "mesh";

  // Drone camera: only over a terrain mesh. A place without one falls back to first person.
  const camera = useMode((s) => s.camera);
  const drone = camera === "drone" && terrainReady;
  const noMesh = !placeKey || (loaded?.key === placeKey && loaded.kind === "curtain");
  useEffect(() => {
    if (camera === "drone" && noMesh) modeActions.setCamera("eye");
  }, [camera, noMesh]);
  useLayoutEffect(() => {
    droneRef.current = drone;
    updateRef.current();
  }, [drone]);

  // Ground tint: the scores of the nearby grid for the mission on screen.
  const heat = useMemo(() => (nearby && overlay !== "off" ? buildHeat(nearby, overlay) : null), [nearby, overlay]);
  useEffect(() => {
    sceneRef.current?.setHeat(terrainReady ? (heat?.spec ?? null) : null);
  }, [heat, terrainReady]);

  // Planner labels on or off.
  useEffect(() => {
    sceneRef.current?.setGuides(beaconMode === "plan");
    blockersRef.current = "";
    updateRef.current();
  }, [beaconMode]);

  // The Sun's and the Earth's tracks over the mission window.
  const windowHours = useScenario((s) => s.windowHours);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { sky } = data;
    const first = sampleIndex(sky, view.startMs);
    const { series } = data;
    const sun: TrackPoint[] = [];
    const earth: TrackPoint[] = [];
    const days: DayMark[] = [];
    const perDay = Math.round(24 / sky.stepHours);
    const totalDays = Math.floor(windowHours / 24);
    const every = Math.max(1, Math.ceil(totalDays / MAX_DAY_MARKS));
    for (let k = 0; k <= windowHours / sky.stepHours; k++) {
      const i = first + k;
      if (i < 0 || i >= sky.count) continue;
      // Visible as the risk model counts it: the upper limb above the skyline.
      const sunVisible = i < series.count ? series.sunAboveTerrain[i] + series.sunRadius[i] > 0 : true;
      const earthVisible = i < series.count ? series.earthVisible[i] === 1 : true;
      sun.push({ azimuthDeg: sky.sunAz[i], elevationDeg: sky.sunAlt[i], visible: sunVisible });
      earth.push({ azimuthDeg: sky.earthAz[i], elevationDeg: sky.earthAlt[i], visible: earthVisible });
      const day = k / perDay;
      if (k % perDay === 0 && day % every === 0) days.push({ day, azimuthDeg: sky.sunAz[i], elevationDeg: sky.sunAlt[i], visible: sunVisible });
    }
    scene.setTracks(sun, earth);
    setDayMarks(days);
  }, [data, view.startMs, windowHours]);
  useEffect(() => updateRef.current(), [dayMarks]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setBeacons(terrainReady ? beaconList : []);
    updateRef.current();
  }, [beaconList, terrainReady, data.lat, data.lon]);

  /** Flies over the mesh to a grid point, then makes it the place on screen. */
  const hopTo = (index: number) => {
    const scene = sceneRef.current;
    const entry = nearby?.scored[index];
    if (!scene || !entry || !nearby || flightRef.current) return;
    const origin = hop?.origin ?? data.place;
    const arrive = () => {
      flightRef.current = null;
      scene.setBeaconsVisible(true);
      actions.selectPlace(neighbourPlace(origin, entry.point, nearby.grid));
    };
    const target = scene.groundToScene(entry.point.lat, entry.point.lon, entry.point.ground_height_m ?? 0);
    const eye = viewRef.current.data.mast.heightM;
    if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      arrive();
      return;
    }
    scene.setBeaconsVisible(false);
    if (beaconsRef.current) beaconsRef.current.hidden = true;
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / FLIGHT_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      // A gentle arc, so the camera does not skim through bumps on the way.
      flightRef.current = [target.x * e, eye + (target.y - 0) * e + Math.sin(Math.PI * t) * 12, target.z * e];
      updateRef.current();
      if (t < 1) requestAnimationFrame(step);
      else arrive();
    };
    requestAnimationFrame(step);
  };

  // A new place opens looking at the Sun (or as asked), at the Earth when the Sun is down.
  useEffect(() => {
    const at = sampleAt(data.series, data.sky, viewRef.current.startMs + getScenario().offsetMs);
    const earth = look === "earth" || (look === undefined && !at.sunVisible && at.earthVisible);
    const target = earth ? { az: at.earthAz, el: at.earthAlt } : { az: at.sunAz, el: at.sunAlt };
    // The drone keeps its tilt and only turns toward the body.
    modeActions.look(target.az, getMode().camera === "drone" ? getMode().pitchDeg : Math.max(-5, Math.min(20, target.el)));
  }, [data.place.id, data.series, data.sky, look]);

  const lookAt = (body: "sun" | "earth") => {
    const v = viewRef.current;
    const at = sampleAt(v.data.series, v.data.sky, v.startMs + getScenario().offsetMs);
    tweenLook(body === "sun" ? at.sunAz : at.earthAz, body === "sun" ? at.sunAlt : at.earthAlt);
  };

  // Drag to look (mouse, pen, one finger); pinch or wheel for the field of view.
  useEffect(() => {
    const root = rootRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("button, .surface__mast, .surface__overlay")) return;
      root.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) pinch = spread(pointers);
    };
    const onMove = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const current = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      const m = getMode();
      if (pointers.size >= 2) {
        const next = spread(pointers);
        if (pinch > 0 && next > 0) {
          if (droneRef.current) modeActions.setDroneDistance(m.droneDistanceM * (pinch / next));
          else modeActions.setFov(m.fovDeg * (pinch / next));
        }
        pinch = next;
        return;
      }
      if (droneRef.current) {
        // Drag turns the ground under the pointer: the camera circles the other way.
        modeActions.look(m.headingDeg + (current.x - last.x) * ORBIT_DEG_PER_PX, m.pitchDeg - (current.y - last.y) * ORBIT_DEG_PER_PX);
        return;
      }
      const degPerPx = m.fovDeg / Math.max(1, root.clientHeight);
      modeActions.look(m.headingDeg - (current.x - last.x) * degPerPx, m.pitchDeg + (current.y - last.y) * degPerPx);
    };
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest(".surface__mast")) return;
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.0015);
      if (droneRef.current) modeActions.setDroneDistance(getMode().droneDistanceM * factor);
      else modeActions.setFov(getMode().fovDeg * factor);
    };
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    // Keys from the settings popover bubble here through the portal; they are not for the camera.
    if (event.defaultPrevented || !rootRef.current?.contains(event.target as Node)) return;
    const m = getMode();
    const step = event.shiftKey ? KEY_STEP_DEG * 5 : KEY_STEP_DEG;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    // Segmented controls and buttons inside the view keep their own arrow keys.
    if ((event.target as HTMLElement).closest("button")) return;
    const zoom = (factor: number) => (droneRef.current ? modeActions.setDroneDistance(m.droneDistanceM * factor) : modeActions.setFov(m.fovDeg * factor));
    if (move) {
      event.preventDefault();
      // Drone: left / right circle the place, up / down tilt toward a top view and back.
      if (droneRef.current) modeActions.look(m.headingDeg - move[0], m.pitchDeg - move[1]);
      else modeActions.look(m.headingDeg + move[0], m.pitchDeg + move[1]);
    } else if (event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd") zoom(1 / 1.2);
    else if (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract") zoom(1.2);
  };

  const terrain = !placeKey ? "curtain" : loaded?.key === placeKey ? loaded.kind : "loading";
  const narrowPlanner = useMediaQuery(COMPACT_QUERY) && beaconMode === "plan";
  const phone = useMediaQuery(PHONE_QUERY);
  const compact = narrowPlanner || phone;

  const groundRow =
    terrainReady && nearby ? (
      <div className="surface__overlay-row">
        <span className="surface__overlay-name">Ground</span>
        <Segmented size="sm" label="Colour the ground around the place" value={overlay} onChange={setOverlay} options={OVERLAY_OPTIONS} />
      </div>
    ) : null;
  const legend =
    terrainReady && nearby && heat ? (
      <div className="surface__legend">
        <span className="surface__legend-title">{heat.title}</span>
        <div className="surface__legend-scale">
          <span>{heat.low}</span>
          <span className="surface__legend-bar" style={{ background: heat.gradient }} />
          <span>{heat.high}</span>
        </div>
        <span className="surface__legend-note">{heat.note}</span>
      </div>
    ) : null;

  if (failed) return <Fallback view={view} reason="The 3D view could not start in this browser." />;

  return (
    <div
      ref={rootRef}
      className="surface"
      tabIndex={0}
      role="application"
      aria-roledescription="3D view"
      aria-label={
        drone
          ? `Drone view of ${data.place.name}. Drag or use the arrow keys to circle the place; plus and minus move closer or away.`
          : `View from the surface at ${data.place.name}. Drag or use the arrow keys to look around; plus and minus zoom.`
      }
      data-camera={drone ? "drone" : "eye"}
      data-compact={compact || undefined}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="surface__canvas" />
      <div ref={compassRef} className="surface__compass" aria-hidden="true" />
      <div ref={sunMarkRef} className="surface__mark surface__mark--sun" aria-hidden="true">
        <span className="surface__mark-arrow">➤</span>
        <span className="surface__mark-label">Sun</span>
      </div>
      <div ref={earthMarkRef} className="surface__mark surface__mark--earth" aria-hidden="true">
        <span className="surface__mark-arrow">➤</span>
        <span className="surface__mark-label">Earth</span>
      </div>
      <div ref={landerRef} className="surface__lander" aria-hidden="true" />
      <div ref={hereRef} className="surface__here" hidden aria-hidden="true">
        {placeTitle(data.place)}
      </div>
      {beaconMode === "explore" ? (
        <>
          <div ref={psrRef} className="surface__psr" hidden aria-hidden="true" />
          <p ref={whyRef} className="surface__why" aria-live="polite" />
        </>
      ) : null}
      <div ref={daysRef} className="surface__days" aria-hidden="true">
        {dayMarks.map((mark, i) => (
          <span key={mark.day} className="surface__day" data-i={i} data-hidden={mark.visible ? undefined : true} hidden>
            {mark.day === 0 ? "Landing" : `Day ${mark.day}`}
          </span>
        ))}
      </div>
      <div ref={beaconsRef} className="surface__beacons" key={data.place.id}>
        {terrainReady
          ? beaconList.map((beacon, i) => (
              <button key={`${beacon.lat},${beacon.lon}`} type="button" className="surface__beacon" data-i={i} data-best={beacon.best || undefined} onClick={() => hopTo(beacon.index)}>
                <span className="surface__beacon-dot" style={{ background: beacon.color }} aria-hidden="true" />
                {beacon.label}
              </button>
            ))
          : null}
      </div>
      {/* Top left, stacked so nothing overlaps however the buttons wrap: the tools, the
          Explorer's Earth card and, on phones, the ground tint's legend. */}
      <div className="surface__top">
        <div className="surface__tools">
          <Button size="sm" onClick={() => lookAt("sun")}>
            <Sun aria-hidden="true" /> Look at Sun
          </Button>
          <Button size="sm" onClick={() => lookAt("earth")}>
            <Earth aria-hidden="true" /> Look at Earth
          </Button>
          {terrainReady ? (
            <Button size="sm" onClick={() => modeActions.setCamera(drone ? "eye" : "drone")}>
              {drone ? <PersonStanding aria-hidden="true" /> : <Drone aria-hidden="true" />} {drone ? "Surface view" : "Drone view"}
            </Button>
          ) : null}
          {hop ? (
            <Button size="sm" onClick={() => actions.selectPlace(hop.origin.kind === "site" ? hop.origin : neighbourPlace(hop.origin, hop.grid.points[0], hop.grid))}>
              <CornerUpLeft aria-hidden="true" /> Back to {placeTitle(hop.origin)}
            </Button>
          ) : null}
        </div>
        {beaconMode === "explore" ? <div ref={earthCardRef} className="surface__earth-card" aria-live="off" /> : null}
        {phone && legend ? <div className="surface__legend-card glass glass--thick">{legend}</div> : null}
      </div>
      {onClose ? (
        <IconButton className="surface__close" label="Close the surface view" size="sm" tipSide="left" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      ) : null}
      {compact ? (
        <>
          <Popover.Root>
            <Popover.Trigger asChild>
              <IconButton className="surface__settings" label="View settings" size="sm" tipSide="bottom">
                <SlidersHorizontal aria-hidden="true" />
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="popover popover--surface glass glass--thick" side="bottom" align="end" sideOffset={8} collisionPadding={12}>
                <MastControl views={[view]} />
                {groundRow}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {legend && !phone ? <div className="surface__overlay surface__overlay--legend glass glass--thick">{legend}</div> : null}
        </>
      ) : (
        <>
          <div className="surface__mast glass glass--thick">
            <MastControl views={[view]} />
          </div>
          {groundRow ? (
            <div className="surface__overlay glass glass--thick">
              {groundRow}
              {legend}
            </div>
          ) : null}
        </>
      )}
      <div ref={readoutRef} className="surface__readout" aria-hidden="true" />
      <p className="surface__caption">
        {drone ? "Drone view: labels and scores are the lander's, not the camera's. Lander model is generic. " : ""}
        {terrain === "mesh"
          ? "Measured: terrain (LOLA, 60 m), Sun and Earth positions. Illustrative: lighting, stars, Earth's map, fine ground detail."
          : terrain === "loading"
            ? "Loading the terrain…"
            : "No 3D terrain for this point: the dark band is its measured skyline."}
      </p>
    </div>
  );
}

/** Explorer: how far the Earth is, how long its light takes, and which ground station sees the Moon. */
function writeEarthCard(el: HTMLDivElement | null, at: { ms: number; earthVisible: boolean }, earthRadiusDeg: number, tables: SkyTables | null, minStationDeg: number) {
  if (!el) return;
  const km = EARTH_RADIUS_KM / Math.sin((earthRadiusDeg * Math.PI) / 180);
  const delay = km / SPEED_OF_LIGHT_KM_S;
  let stations = "";
  if (tables) {
    const i = sampleIndex(tables.vectors, at.ms);
    const up = tables.stations.filter((station) => (station.alt[i] ?? -90) > minStationDeg).map((station) => station.name[0].toUpperCase() + station.name.slice(1));
    stations = up.length > 0 ? `${up.join(" and ")} can see the Moon` : "No ground station can see the Moon right now";
  }
  const lines = [
    `Earth · ${Math.round(km).toLocaleString("en-US")} km away · its light takes ${delay.toFixed(2)} s`,
    at.earthVisible ? stations : "Below the skyline: no direct radio link",
  ];
  el.textContent = lines.filter(Boolean).join("\n");
}

const COMPASS_SHORT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Explorer: a pin at the nearest permanently shadowed region (built-in sites with the PSR map). */
function placePsrPin(el: HTMLDivElement | null, scene: SurfaceScene, data: ScenarioView["data"]) {
  if (!el) return;
  const psr = data.place.kind === "site" ? data.terrain?.psr : null;
  if (!psr) {
    el.hidden = true;
    return;
  }
  if (psr.siteInPsr) {
    el.hidden = false;
    el.dataset.here = "true";
    el.style.left = "50%";
    el.style.top = "86%";
    el.textContent = "You are standing in a permanently shadowed region: no sunlight here at any time of year.";
    return;
  }
  const spot = destination(data.lat, data.lon, psr.bearingDeg, psr.distanceM);
  const point = scene.terrainPointAt(spot.lat, spot.lon);
  const p = point ? scene.projectPoint(point.setY(point.y + 3)) : null;
  el.hidden = !p || !p.inView;
  el.dataset.here = "false";
  if (!p || !p.inView) return;
  el.style.left = `${(p.x * 100).toFixed(2)}%`;
  el.style.top = `${(p.y * 100).toFixed(2)}%`;
  const slope = Number.isFinite(psr.slopeMaxDeg) ? ` · slope on the way up to ${psr.slopeMaxDeg.toFixed(0)}°` : "";
  el.textContent = `Permanently shadowed region · ${formatDistance(psr.distanceM)} ${COMPASS_SHORT[Math.round(psr.bearingDeg / 45) % 8]}${slope}`;
}

/** Beacon labels follow the tops of their poles; hidden while the pole is out of view. */
function placeBeaconLabels(el: HTMLDivElement | null, projections: { x: number; y: number; inView: boolean }[], bestOnly = false) {
  if (!el) return;
  el.querySelectorAll<HTMLElement>(".surface__beacon").forEach((button) => {
    const p = projections[Number(button.dataset.i)];
    button.hidden = !p || !p.inView || (bestOnly && !button.dataset.best);
    if (p && p.inView) {
      button.style.left = `${(p.x * 100).toFixed(2)}%`;
      button.style.top = `${(p.y * 100).toFixed(2)}%`;
    }
  });
}

/** The day labels along the Sun's track; null hides them all. */
function placeDayMarks(el: HTMLDivElement | null, projections: { x: number; y: number; inView: boolean }[] | null) {
  if (!el) return;
  el.querySelectorAll<HTMLElement>(".surface__day").forEach((label) => {
    const p = projections?.[Number(label.dataset.i)];
    label.hidden = !p || !p.inView;
    if (p && p.inView) {
      label.style.left = `${(p.x * 100).toFixed(2)}%`;
      label.style.top = `${(p.y * 100).toFixed(2)}%`;
    }
  });
}

/** Drone view: the place's name over its marker. */
function placeHere(el: HTMLDivElement | null, p: { x: number; y: number; inView: boolean } | null) {
  if (!el) return;
  el.hidden = !p || !p.inView;
  if (!p || !p.inView) return;
  el.style.left = `${(p.x * 100).toFixed(2)}%`;
  el.style.top = `${(p.y * 100).toFixed(2)}%`;
}

/** Label at the tip of the lander's shadow: its true length on flat ground. */
function placeLanderLabel(el: HTMLDivElement | null, info: { lengthM: number; tip: { x: number; y: number; inView: boolean } } | null) {
  if (!el) return;
  if (!info || !info.tip.inView) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.style.left = `${(info.tip.x * 100).toFixed(2)}%`;
  el.style.top = `${(info.tip.y * 100).toFixed(2)}%`;
  const length = info.lengthM;
  el.textContent = !Number.isFinite(length) ? "Lander shadow: endless" : length >= 1000 ? `Lander shadow ${(length / 1000).toFixed(1)} km long` : `Lander shadow ${Math.round(length)} m long`;
}

function spread(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

/** Turns the camera to a direction; eased unless the user prefers reduced motion. */
function tweenLook(azimuthDeg: number, elevationDeg: number) {
  const pitch = Math.max(-80, Math.min(80, elevationDeg));
  const start = getMode();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    modeActions.look(azimuthDeg, start.camera === "drone" ? start.pitchDeg : pitch);
    return;
  }
  const dHeading = azDiff(azimuthDeg, start.headingDeg);
  const dPitch = start.camera === "drone" ? 0 : pitch - start.pitchDeg;
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / TWEEN_MS);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    modeActions.look(start.headingDeg + dHeading * e, start.pitchDeg + dPitch * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The compass strip: a tick every 15 degrees across the field of view, letters at 45. */
function drawCompass(el: HTMLDivElement | null, headingDeg: number, hfovDeg: number) {
  if (!el) return;
  let html = "";
  for (let az = 0; az < 360; az += 15) {
    const offset = azDiff(az, headingDeg) / hfovDeg;
    if (Math.abs(offset) > 0.5) continue;
    const label = az % 45 === 0 ? COMPASS[az / 45] : "";
    html += `<span class="surface__tick${label ? " surface__tick--major" : ""}" style="left:${((0.5 + offset) * 100).toFixed(2)}%">${label || ""}</span>`;
  }
  el.innerHTML = html;
}

/**
 * A label over a body in view; at the edge with an arrow when the body is outside the view.
 * A body behind the terrain is labelled too, dimmed: the engine says it is hidden.
 */
function placeMark(el: HTMLDivElement | null, p: { x: number; y: number; inView: boolean }, visible: boolean, headingDeg: number, azimuthDeg: number) {
  if (!el) return;
  el.dataset.hidden = visible ? "false" : "true";
  if (p.inView) {
    el.dataset.edge = "none";
    el.style.left = `${(p.x * 100).toFixed(2)}%`;
    el.style.top = `${(p.y * 100).toFixed(2)}%`;
    el.style.removeProperty("--arrow-angle");
    return;
  }
  // Out of view: pin to the side the body is on (by azimuth), at its height where possible.
  const side = azDiff(azimuthDeg, headingDeg) >= 0 ? "right" : "left";
  const y = Math.max(0.12, Math.min(0.88, p.y));
  el.dataset.edge = p.x >= 0 && p.x <= 1 ? (p.y < 0 ? "top" : "bottom") : side;
  if (el.dataset.edge === "top" || el.dataset.edge === "bottom") {
    el.style.left = `${(Math.max(0.06, Math.min(0.94, p.x)) * 100).toFixed(2)}%`;
    el.style.top = el.dataset.edge === "top" ? "9%" : "88%";
  } else {
    el.style.left = side === "right" ? "97%" : "3%";
    el.style.top = `${(y * 100).toFixed(2)}%`;
  }
}

