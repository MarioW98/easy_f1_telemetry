import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleDot,
  LocateFixed,
  Maximize,
  Minimize,
  Route,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LapData, PosSample } from "@/lib/telemetry";
import { MAX_POS_GAP, positionAt, telemetryAt } from "@/lib/telemetry";

export interface MapDriver {
  lap: LapData;
  color: string;
  label: string;
  number: number;
  /** line dash pattern (same code as the charts) and z-emphasis for the reference lap */
  dash?: string | undefined;
  reference?: boolean;
}

/** Inspection card: telemetry values at the clicked point of a trajectory. */
interface Inspect {
  key: string;
  label: string;
  color: string;
  t: number;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  gear: number | null;
  drsOpen: number | null;
}

const MIN_OUTLINE_POINTS = 60;
const MAX_ZOOM = 14;
const PAD_FRAC = 0.04;

/** Spezza i campioni di posizione in segmenti continui: un buco temporale maggiore di
 *  MAX_POS_GAP inizia un nuovo segmento; i campioni isolati vengono scartati
 *  (nessun collegamento inventato tra lacune). */
export function splitAtGaps(pts: PosSample[], gap: number = MAX_POS_GAP): PosSample[][] {
  const segs: PosSample[][] = [];
  let cur: PosSample[] = [];
  for (const p of pts) {
    if (cur.length === 0 || p.t - cur[cur.length - 1]!.t <= gap) cur.push(p);
    else {
      if (cur.length >= 2) segs.push(cur);
      cur = [p];
    }
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

/** Percorso SVG dei segmenti disegnati fino all'istante `upTo` (y già ribaltata come
 *  nel viewBox). La punta è interpolata solo DENTRO il segmento corrente: non attraversa
 *  mai una lacuna e non supera mai l'ultimo campione registrato. */
export function trailPath(segs: PosSample[][], upTo: number): string {
  const n = (v: number) => String(Math.round(v));
  let d = "";
  for (const seg of segs) {
    if (seg.length === 0 || upTo < seg[0]!.t) continue;
    let sub = `M${n(seg[0]!.x)},${n(-seg[0]!.y)}`;
    for (let i = 1; i < seg.length; i++) {
      const p = seg[i]!;
      if (p.t <= upTo) {
        sub += ` L${n(p.x)},${n(-p.y)}`;
      } else {
        const a = seg[i - 1]!;
        if (upTo > a.t) {
          const f = (upTo - a.t) / (p.t - a.t);
          sub += ` L${n(a.x + (p.x - a.x) * f)},${n(-(a.y + (p.y - a.y) * f))}`;
        }
        break;
      }
    }
    if (d) d += " ";
    d += sub;
  }
  return d;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** center clamp: window must stay over the track (no pan at fit zoom, bounded pan when zoomed) */
const clampC = (c: number, size: number, lo: number, hi: number) =>
  size >= hi - lo ? (lo + hi) / 2 : clamp(c, lo + size / 2, hi - size / 2);

export function TrackMap({
  drivers,
  time,
  onPickTime,
  showTrails = true,
}: {
  drivers: MapDriver[];
  time: number;
  onPickTime?: (t: number) => void;
  /** true = linee reali sul circuito; false = solo nastro circuito + punti posizione */
  showTrails?: boolean;
}) {
  // Per-driver in-lap samples, kept in time order (the only geometry source: /location X,Y).
  const series = useMemo(
    () =>
      drivers.map((d) => ({
        d,
        pts: d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration),
      })),
    [drivers],
  );

  // Reference outline: the first visible driver with enough samples to describe the circuit.
  const outline = useMemo(() => {
    for (const s of series) {
      if (s.pts.length >= MIN_OUTLINE_POINTS && s.d.lap.coverage.maxPosGap < 5) return s;
    }
    return null;
  }, [series]);

  const paths = useMemo(
    () =>
      series
        .filter((s) => s.pts.length >= 2)
        .map((s) => {
          const segs = splitAtGaps(s.pts);
          return { ...s, segs, full: trailPath(segs, Infinity) };
        })
        .filter((s) => s.full !== ""),
    [series],
  );

  // View box: union bounding box of ALL visible trajectories (nothing gets clipped),
  // not just the reference lap — different years/lines may exceed it.
  const geo = useMemo(() => {
    if (!outline) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const scan = (pts: PosSample[]) => {
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    };
    for (const s of series) scan(s.pts);
    if (minX === Infinity) return null;
    const w = maxX - minX,
      h = maxY - minY;
    const pad = Math.max(w, h) * PAD_FRAC;
    // y is flipped (OpenF1 y grows upward); uniform scale keeps proportions
    const vb = { x: minX - pad, y: -maxY - pad, w: w + pad * 2, h: h + pad * 2 };
    return { vb, d: trailPath(splitAtGaps(outline.pts), Infinity), unit: Math.max(w, h) / 100 };
  }, [series, outline]);

  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [progressive, setProgressive] = useState(false);
  const [showPts, setShowPts] = useState(false);
  const [full, setFull] = useState(false);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<{ d0: number; z0: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // current clamped viewport window (viewBox coords, y already flipped)
  const viewOf = (z: number, c: { x: number; y: number } | null) => {
    if (!geo) return null;
    const vw = geo.vb.w / z,
      vh = geo.vb.h / z;
    const cx = c?.x ?? geo.vb.x + geo.vb.w / 2;
    const cy = c?.y ?? geo.vb.y + geo.vb.h / 2;
    const ccx = clampC(cx, vw, geo.vb.x, geo.vb.x + geo.vb.w);
    const ccy = clampC(cy, vh, geo.vb.y, geo.vb.y + geo.vb.h);
    return { vw, vh, vx: ccx - vw / 2, vy: ccy - vh / 2, ccx, ccy };
  };

  const userPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg || !svg.getScreenCTM) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  /** zoom anchored on the client point: the world point under it stays under it */
  const zoomToAt = (clientX: number, clientY: number, z2: number) => {
    if (!geo) return;
    const p = userPoint(clientX, clientY);
    if (!p) return;
    const v0 = viewOf(zoom, center);
    if (!v0) return;
    const fx = (p.x - v0.vx) / v0.vw,
      fy = (p.y - v0.vy) / v0.vh;
    const vw2 = geo.vb.w / z2,
      vh2 = geo.vb.h / z2;
    setZoom(z2);
    setCenter({ x: p.x - (fx - 0.5) * vw2, y: p.y - (fy - 0.5) * vh2 });
  };

  const zoomBy = (f: number) => {
    const svg = svgRef.current;
    if (!svg) {
      setZoom((z) => clamp(z * f, 1, MAX_ZOOM));
      return;
    }
    const r = svg.getBoundingClientRect();
    zoomToAt(r.left + r.width / 2, r.top + r.height / 2, clamp(zoom * f, 1, MAX_ZOOM));
  };

  const resetView = () => {
    setZoom(1);
    setCenter(null);
  };

  // wheel zoom (non-passive): cursor-anchored, page does not scroll while zooming
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      zoomToAt(e.clientX, e.clientY, clamp(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, MAX_ZOOM));
    };
    svg.addEventListener("wheel", h, { passive: false });
    return () => svg.removeEventListener("wheel", h);
  });

  // fullscreen: lock page scroll + close with ESC
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  if (!geo || !outline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-warning" />
        <p className="max-w-sm">
          {drivers.length === 0
            ? "Nessun pilota visibile: riattiva almeno una traiettoria dalla legenda."
            : "Circuito non ricostruibile: i campioni di posizione di questo giro sono insufficienti o hanno lacune troppo ampie. Nessuna geometria viene inventata."}
        </p>
      </div>
    );
  }

  const v = viewOf(zoom, center)!;
  const u = geo.unit / Math.sqrt(zoom);
  const dashU = (dash: string | undefined) =>
    dash
      ? dash
          .split(/[\s,]+/)
          .map((x) => (Number(x) * u * 1.2).toFixed(0))
          .join(" ")
      : undefined;

  const screenScale = () => {
    const svg = svgRef.current;
    const r = svg?.getBoundingClientRect?.();
    if (!svg || !r || r.width === 0) return null;
    const a = userPoint(r.left, r.top);
    const b = userPoint(r.right, r.bottom);
    if (!a || !b) return null;
    return { sx: Math.abs(b.x - a.x) / r.width, sy: Math.abs(b.y - a.y) / r.height };
  };

  const toggleFull = () => {
    ptrs.current.clear();
    gest.current = null;
    drag.current = null;
    setInspect(null);
    setFull((f) => !f);
  };

  const pickOnPath = (
    entry: { d: MapDriver; pts: PosSample[] },
    clientX: number,
    clientY: number,
  ) => {
    const p = userPoint(clientX, clientY);
    if (!p) return;
    let best: PosSample | null = null;
    let bestDist = Infinity;
    for (const s of entry.pts) {
      const dist = (s.x - p.x) ** 2 + (s.y + p.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    if (!best) return;
    const tol = (geo.unit * 6) ** 2;
    if (bestDist > tol) return; // click too far from this trajectory
    const tel = telemetryAt(entry.d.lap.tel, best.t);
    setInspect({
      key: entry.d.label + best.t.toFixed(3),
      label: entry.d.label,
      color: entry.d.color,
      t: best.t,
      speed: tel?.s.speed ?? null,
      throttle: tel?.s.throttle ?? null,
      brake: tel?.s.brake ?? null,
      gear: tel?.s.gear ?? null,
      drsOpen: tel?.s.drsOpen ?? null,
    });
  };

  const dismiss = () => setInspect(null);

  const endPtr = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) gest.current = null;
    if (ptrs.current.size === 0) drag.current = null;
  };

  const pill = (active: boolean) =>
    `inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] backdrop-blur ${
      active
        ? "border-primary/60 bg-primary/15 text-foreground"
        : "border-border bg-secondary/90 text-muted-foreground hover:text-foreground"
    }`;

  const body = (isFull: boolean) => (
    <>
      <svg
        ref={svgRef}
        viewBox={`${v.vx} ${v.vy} ${v.vw} ${v.vh}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: zoom > 1 || isFull ? "none" : "pan-y" }}
        onPointerDown={(e) => {
          svgRef.current?.setPointerCapture?.(e.pointerId);
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (ptrs.current.size === 2) {
            // pinch begins: two fingers on the map
            drag.current = null;
            const two = [...ptrs.current.values()];
            gest.current = {
              d0: Math.hypot(two[0]!.x - two[1]!.x, two[0]!.y - two[1]!.y),
              z0: zoom,
            };
          } else if (ptrs.current.size === 1) {
            const s = screenScale();
            drag.current = s
              ? { x: e.clientX, y: e.clientY, cx: v.ccx, cy: v.ccy, sx: s.sx, sy: s.sy }
              : null;
            if (!(e.target as Element).classList?.contains("cursor-pointer")) dismiss();
          }
        }}
        onPointerMove={(e) => {
          const pt = ptrs.current.get(e.pointerId);
          if (pt) {
            pt.x = e.clientX;
            pt.y = e.clientY;
          }
          if (gest.current && ptrs.current.size >= 2) {
            const two = [...ptrs.current.values()];
            const a = two[0]!;
            const b = two[1]!;
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const g = gest.current;
            if (g.d0 > 0 && dist > 0)
              zoomToAt((a.x + b.x) / 2, (a.y + b.y) / 2, clamp((g.z0 * dist) / g.d0, 1, MAX_ZOOM));
            return;
          }
          if (!drag.current) return;
          setCenter({
            x: drag.current.cx - (e.clientX - drag.current.x) * drag.current.sx,
            y: drag.current.cy - (e.clientY - drag.current.y) * drag.current.sy,
          });
        }}
        onPointerUp={endPtr}
        onPointerCancel={endPtr}
      >
        {/* circuit ribbon: dark rim + asphalt, constant width (rendering choice, no data invention) */}
        <path
          d={geo.d}
          fill="none"
          stroke="var(--color-grid)"
          strokeWidth={u * 3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={geo.d}
          fill="none"
          stroke="var(--color-track)"
          strokeWidth={u * 2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* trajectories: reference lap thicker; progressive mode draws up to the replay time */}
        {showTrails &&
          paths.map(({ d, segs, pts, full: fullD }, i) => {
            const w = u * (d.reference ? 1.25 : 0.85);
            const solidD = progressive ? trailPath(segs, Math.min(time, d.lap.duration)) : fullD;
            return (
              <g key={d.label + i}>
                {progressive && (
                  <path
                    d={fullD}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={w * 0.55}
                    strokeDasharray={dashU(d.dash)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={0.22}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      pickOnPath(paths[i]!, e.clientX, e.clientY);
                    }}
                  />
                )}
                {solidD && (
                  <>
                    <path
                      d={solidD}
                      fill="none"
                      stroke="var(--color-background)"
                      strokeWidth={w + u * 0.45}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={0.85}
                      className="pointer-events-none"
                    />
                    <path
                      d={solidD}
                      fill="none"
                      stroke={d.color}
                      strokeWidth={w}
                      strokeDasharray={dashU(d.dash)}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={d.reference ? 1 : 0.9}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickOnPath(paths[i]!, e.clientX, e.clientY);
                      }}
                    />
                  </>
                )}
              </g>
            );
          })}
        {/* sampled points (optional): raw /location samples on top of the lines, no interpolation */}
        {showPts &&
          paths.map(({ d, pts }) => (
            <g key={"pts-" + d.label} className="pointer-events-none">
              {pts.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={-p.y}
                  r={u * 0.34}
                  fill={d.color}
                  stroke="var(--color-background)"
                  strokeWidth={u * 0.12}
                />
              ))}
            </g>
          ))}
        {/* lap start marker (first in-lap sample, not assumed origin) */}
        <circle
          cx={outline.pts[0]!.x}
          cy={-outline.pts[0]!.y}
          r={u * 0.9}
          fill="var(--color-track)"
          stroke="var(--color-grid)"
          strokeWidth={u * 0.2}
        />
        {drivers.map((d, i) => {
          const p = positionAt(d.lap.pos, Math.min(time, d.lap.duration));
          if (!p) return null;
          return (
            <g key={d.number + "-" + i} className="pointer-events-none">
              <circle cx={p.x} cy={-p.y} r={u * 3.2} fill={d.color} opacity={0.18} />
              <circle
                cx={p.x}
                cy={-p.y}
                r={u * 1.6}
                fill={d.color}
                stroke="var(--color-background)"
                strokeWidth={u * 0.4}
              />
              <text
                x={p.x + u * 2.4}
                y={-p.y - u * 2.0 + i * u * 4.5}
                fill={d.color}
                fontSize={u * 3.4}
                fontFamily="var(--font-mono)"
                fontWeight={700}
                paintOrder="stroke"
                stroke="var(--color-background)"
                strokeWidth={u * 0.8}
              >
                {d.number} {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {/* view controls */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          {
            icon: ZoomIn,
            label: "Zoom avanti",
            fn: () => {
              dismiss();
              zoomBy(1.35);
            },
          },
          {
            icon: ZoomOut,
            label: "Zoom indietro",
            fn: () => {
              dismiss();
              zoomBy(1 / 1.35);
            },
          },
          {
            icon: LocateFixed,
            label: "Ripristina vista (tutto il circuito)",
            fn: () => {
              dismiss();
              resetView();
            },
          },
          {
            icon: isFull ? Minimize : Maximize,
            label: isFull ? "Chiudi schermo intero (ESC)" : "Schermo intero: circuito ingrandito",
            fn: toggleFull,
          },
        ].map(({ icon: I, label, fn }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            onClick={fn}
            className="rounded border border-border bg-secondary/90 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
          >
            <I className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      {/* display options (solo con le traiettorie attive) */}
      {showTrails && (
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          <button
            aria-pressed={progressive}
            title="Disegna le traiettorie fino all'istante della riproduzione"
            onClick={() => setProgressive((p) => !p)}
            className={pill(progressive)}
          >
            <Route className="h-3 w-3" />
            <span className="hidden sm:inline">Traiettoria progressiva</span>
          </button>
          <button
            aria-pressed={showPts}
            title="Mostra i campioni grezzi di /location"
            onClick={() => setShowPts((p) => !p)}
            className={pill(showPts)}
          >
            <CircleDot className="h-3 w-3" />
            <span className="hidden sm:inline">Punti campionati</span>
          </button>
        </div>
      )}
      {inspect && (
        <div
          role="dialog"
          aria-label={`Telemetria al punto scelto: ${inspect.label}`}
          className="absolute bottom-8 right-2 z-10 w-52 rounded border border-border bg-card p-2 font-mono text-[11px] shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-bold" style={{ color: inspect.color }}>
              {inspect.label}
            </span>
            <button
              aria-label="Chiudi ispezione"
              title="Chiudi"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
            <span>t giro</span>
            <span className="text-right text-foreground">{inspect.t.toFixed(2)} s</span>
            <span>Velocità</span>
            <span className="text-right text-foreground">
              {inspect.speed === null ? "n/d" : `${inspect.speed} km/h`}
            </span>
            <span>Acceleratore</span>
            <span className="text-right text-foreground">
              {inspect.throttle === null ? "n/d" : `${inspect.throttle}%`}
            </span>
            <span>Freno</span>
            <span className="text-right text-foreground">
              {inspect.brake === null ? "n/d" : inspect.brake ? "ON" : "OFF"}
            </span>
            <span>Marcia</span>
            <span className="text-right text-foreground">{inspect.gear ?? "n/d"}</span>
            <span>DRS</span>
            <span className="text-right text-foreground">
              {inspect.drsOpen === null ? "n/d" : inspect.drsOpen ? "APERTO" : "chiuso"}
            </span>
          </div>
          {onPickTime && (
            <button
              onClick={() => {
                onPickTime(inspect.t);
                dismiss();
              }}
              className="mt-1.5 w-full rounded bg-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
            >
              Vai a questo istante
            </button>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-muted-foreground">
        <span className="hidden sm:inline">
          Rotellina/pinch = zoom sulla curva · trascina = sposta ·{" "}
        </span>
        {showTrails
          ? "clic su una traiettoria = valori · ● inizio giro"
          : "traiettorie disattive · ● inizio giro"}
      </div>
    </>
  );

  return (
    <>
      {!full && <div className="relative h-full w-full">{body(false)}</div>}
      {full && (
        <div className="fixed inset-0 z-50 bg-background p-1 sm:p-2">
          <div className="relative h-full w-full">{body(true)}</div>
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 font-mono text-[10px] text-muted-foreground">
            schermo intero · ESC per uscire
          </div>
        </div>
      )}
    </>
  );
}
