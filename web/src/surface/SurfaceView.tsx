// First-person view from the surface: real LOLA terrain, the Sun and the Earth where the
// ephemeris puts them, and the skyline the risk model uses. Lazy entry point (three.js lives
// in this chunk only).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CornerUpLeft, Earth, Sun, X } from "lucide-react";
import { HorizonView } from "../charts/HorizonView.tsx";
import { MastControl } from "../panels/MastControl.tsx";
import { loadSiteTerrainPatch } from "../data/load.ts";
import { sampleAt } from "../engine/events.ts";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG } from "../engine/risk.ts";
import { getMode, modeActions, subscribeMode } from "../state/mode.ts";
import { pointDistanceM } from "../engine/grid.ts";
import { betterSpot, hopOrigin, neighbourPlace, offsetText, type NearbyResult } from "../state/nearby.ts";
import { actions, getScenario, placeTitle, subscribeScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { formatAngle } from "../ui/format.ts";
import { SurfaceScene, webgl2Available, type BeaconSpec } from "./scene.ts";
import "./surface.css";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const TWEEN_MS = 700;
/** Drag: degrees of view turned per pixel are the field of view over the canvas width. */
const KEY_STEP_DEG = 2;

interface SurfaceViewProps {
  view: ScenarioView;
  /** Shows a close button (the Planner's overlay). */
  onClose?: () => void;
  /** Where the camera turns when a place opens; default: the Sun, or the Earth while the Sun is down. */
  look?: "sun" | "earth";
  /** Scored grid around the place: nearby points become beacons one can hop to. */
  nearby?: NearbyResult | null;
  /** Planner: the eight nearest points and the best spot, coloured by risk. Explorer: the best spot only. */
  beacons?: "plan" | "explore";
}

const LEVEL_COLOR = { low: "#30d158", medium: "#ffd60a", high: "#ff453a" } as const;
const BEST_COLOR = "#0a84ff";
const FLIGHT_MS = 900;
const NEAREST_BEACONS = 8;

interface Beacon extends BeaconSpec {
  label: string;
  /** Hop target. */
  index: number;
}

/** Signed difference a - b of two azimuths, -180..180. */
const azDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

export default function SurfaceView({ view, onClose, look, nearby, beacons }: SurfaceViewProps) {
  const [supported] = useState(webgl2Available);
  if (!supported) return <Fallback view={view} reason="This browser cannot draw the 3D view (no WebGL 2)." />;
  return <SurfaceCanvas view={view} onClose={onClose} look={look} nearby={nearby} beacons={beacons} />;
}

export function Fallback({ view, reason }: { view: ScenarioView; reason: string }) {
  return (
    <div className="surface surface--fallback">
      <HorizonView view={view} />
      <p className="surface__note">{reason} The horizon chart shows the same skyline, Sun and Earth.</p>
    </div>
  );
}

function SurfaceCanvas({ view, onClose, look, nearby = null, beacons: beaconMode = "plan" }: SurfaceViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const sunMarkRef = useRef<HTMLDivElement>(null);
  const earthMarkRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const landerRef = useRef<HTMLDivElement>(null);
  const beaconsRef = useRef<HTMLDivElement>(null);
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
        headingDeg: m.headingDeg,
        pitchDeg: m.pitchDeg,
        fovDeg: m.fovDeg,
      });
      drawCompass(compassRef.current, m.headingDeg, scene.horizontalFovDeg);
      placeMark(sunMarkRef.current, scene.project(at.sunAz, at.sunAlt), at.sunVisible, m.headingDeg, at.sunAz);
      placeMark(earthMarkRef.current, scene.project(at.earthAz, at.earthAlt), at.earthVisible, m.headingDeg, at.earthAz);
      placeLanderLabel(landerRef.current, scene.landerShadowInfo());
      placeBeaconLabels(beaconsRef.current, scene.beaconProjections());
      if (readoutRef.current) {
        readoutRef.current.textContent = `Looking ${COMPASS[Math.round(m.headingDeg / 45) % 8]} ${m.headingDeg.toFixed(0)}°, ${formatAngle(m.pitchDeg, 0)}`;
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
    modeActions.look(target.az, Math.max(-5, Math.min(20, target.el)));
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
      if ((event.target as HTMLElement).closest("button, .surface__mast")) return;
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
        if (pinch > 0 && next > 0) modeActions.setFov(m.fovDeg * (pinch / next));
        pinch = next;
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
      modeActions.setFov(getMode().fovDeg * Math.exp(event.deltaY * 0.0015));
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
    const m = getMode();
    const step = event.shiftKey ? KEY_STEP_DEG * 5 : KEY_STEP_DEG;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      modeActions.look(m.headingDeg + move[0], m.pitchDeg + move[1]);
    } else if (event.key === "+" || event.key === "=") modeActions.setFov(m.fovDeg / 1.2);
    else if (event.key === "-") modeActions.setFov(m.fovDeg * 1.2);
  };

  const terrain = !placeKey ? "curtain" : loaded?.key === placeKey ? loaded.kind : "loading";

  if (failed) return <Fallback view={view} reason="The 3D view could not start in this browser." />;

  return (
    <div
      ref={rootRef}
      className="surface"
      tabIndex={0}
      role="application"
      aria-roledescription="3D view"
      aria-label={`View from the surface at ${data.place.name}. Drag or use the arrow keys to look around; plus and minus zoom.`}
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
      <div className="surface__tools">
        <Button size="sm" onClick={() => lookAt("sun")}>
          <Sun aria-hidden="true" /> Look at Sun
        </Button>
        <Button size="sm" onClick={() => lookAt("earth")}>
          <Earth aria-hidden="true" /> Look at Earth
        </Button>
        {hop ? (
          <Button size="sm" onClick={() => actions.selectPlace(hop.origin.kind === "site" ? hop.origin : neighbourPlace(hop.origin, hop.grid.points[0], hop.grid))}>
            <CornerUpLeft aria-hidden="true" /> Back to {placeTitle(hop.origin)}
          </Button>
        ) : null}
      </div>
      {onClose ? (
        <IconButton className="surface__close" label="Close the surface view" size="sm" tipSide="left" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      ) : null}
      <div className="surface__mast glass glass--thick">
        <MastControl views={[view]} />
      </div>
      <div ref={readoutRef} className="surface__readout" aria-hidden="true" />
      <p className="surface__caption">
        {terrain === "mesh"
          ? "Measured: terrain (LOLA, 60 m pixels), Sun and Earth (JPL ephemeris), the risk model's skyline. Illustrative: light, glare, stars. No rocks or craters smaller than about 60 m."
          : terrain === "loading"
            ? "Loading the terrain…"
            : "No 3D terrain for this point: the dark band is the risk model's skyline (measured); Sun and Earth from the JPL ephemeris."}
      </p>
    </div>
  );
}

/** Beacon labels follow the tops of their poles; hidden while the pole is out of view. */
function placeBeaconLabels(el: HTMLDivElement | null, projections: { x: number; y: number; inView: boolean }[]) {
  if (!el) return;
  el.querySelectorAll<HTMLElement>(".surface__beacon").forEach((button) => {
    const p = projections[Number(button.dataset.i)];
    button.hidden = !p || !p.inView;
    if (p && p.inView) {
      button.style.left = `${(p.x * 100).toFixed(2)}%`;
      button.style.top = `${(p.y * 100).toFixed(2)}%`;
    }
  });
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
    modeActions.look(azimuthDeg, pitch);
    return;
  }
  const dHeading = azDiff(azimuthDeg, start.headingDeg);
  const dPitch = pitch - start.pitchDeg;
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

