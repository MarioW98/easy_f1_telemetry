import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleDot,
  Eye,
  EyeOff,
  Maximize2,
  Spline,
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

/**
 * Splits chronological samples where two consecutive ones are more than
 * MAX_POS_GAP apart. Across such temporal holes nothing is ever drawn:
 * segments stay disconnected (no artificial links), matching positionAt.
 */
export function splitAtGaps(pts: PosSample[]): PosSample[][] {
  const segs: PosSample[][] = [];
  let cur: PosSample[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.t - cur[cur.length - 1]!.t > MAX_POS_GAP) {
      if (cur.length > 1) segs.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/** One SVG "d" per driver: disconnected subpaths joined by M commands. */
const joinSegs = (segs: PosSample[][]): string =>
  segs
    .map((seg) =>
      seg.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)},${(-p.y).toFixed(0)}`).join(" "),
    )
    .join(" ");

/**
 * Trajectory grown up to replay time `time`: recorded samples with t <= time
 * plus (at most) the interpolated tip inside the current segment — never
 * across a gap. Samples only, no geometry from telemetry.
 */
export function trailPath(segs: PosSample[][], time: number): string {
  let out = "";
  for (const seg of segs) {
    if (seg[0]!.t > time) break; // segments are chronological
    let last = 0;
    while (last + 1 < seg.length && seg[last + 1]!.t <= time) last++;
    out += joinSegs([seg.slice(0, last + 1)]);
    const a = seg[last]!;
    const b = seg[last + 1];
    if (b && b.t > time && time > a.t) {
      const f = (time - a.t) / (b.t - a.t);
      out += ` L${(a.x + (b.x - a.x) * f).toFixed(0)},${(-(a.y + (b.y - a.y) * f)).toFixed(0)}`;
    }
    out += " ";
  }
  return out.trim();
}

/** Original location samples as tiny dots (opt-in). Memoised so the replay
    tick does not re-render thousands of circles: it refreshes only when the
    drivers, their visibility or the zoom change. */
const PointsLayer = memo(function PointsLayer({
  entries,
  u,
}: {
  entries: { key: string; color: string; pts: PosSample[] }[];
  u: number;
}) {
  if (!entries.length) return null;
  return (
    <g className="pointer-events-none" shapeRendering="optimizeSpeed">
      {entries.map((e) =>
        e.pts.map((p, i) => (
          <circle
            key={`${e.key}-${i}`}
            cx={p.x}
            cy={-p.y}
            r={u * 0.32}
            fill={e.color}
            fillOpacity={0.85}
          />
        )),
      )}
    </g>
  );
});

interface TrajEntry {
  d: MapDriver;
  pts: PosSample[];
  segments: PosSample[][];
  full: string;
}

export function TrackMap({
  drivers,
  time,
  onPickTime,
}: {
  drivers: MapDriver[];
  time: number;
  onPickTime?: (t: number) => void;
}) {
  // Outline: the first driver with enough in-lap samples, kept in time order,
  // split at temporal gaps like every other trajectory.
  const outline = useMemo(() => {
    for (const d of drivers) {
      const pts = d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration);
      if (pts.length >= MIN_OUTLINE_POINTS && d.lap.coverage.maxPosGap < 5)
        return {
          segs: splitAtGaps(pts),
          count: pts.length,
          first: pts[0]!,
          from: d.label,
        };
    }
    return null;
  }, [drivers]);

  const geo = useMemo(() => {
    if (!outline) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const seg of outline.segs) {
      for (const p of seg) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    const w = maxX - minX,
      h = maxY - minY;
    const pad = Math.max(w, h) * 0.06;
    // y is flipped (OpenF1 y grows upward); uniform scale keeps proportions
    const vb = { x: minX - pad, y: -maxY - pad, w: w + pad * 2, h: h + pad * 2 };
    return { vb, d: joinSegs(outline.segs), unit: Math.max(w, h) / 100 };
  }, [outline]);

  // Per-driver trajectories: chronological XY samples only, split at gaps,
  // each in its driver colour, all on the same coordinate system.
  const paths = useMemo(
    () =>
      drivers
        .map((d) => {
          const pts = d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration);
          if (pts.length < 2) return null;
          const segments = splitAtGaps(pts);
          if (!segments.length) return null;
          return { d, pts, segments, full: joinSegs(segments) };
        })
        .filter(Boolean) as TrajEntry[],
    [drivers],
  );

  // Trajectory visibility (map only — the telemetry charts are untouched).
  const [showTrajs, setShowTrajs] = useState(true);
  const [showPoints, setShowPoints] = useState(false);
  const [hiddenTraj, setHiddenTraj] = useState<Set<string>>(new Set());
  const toggleTraj = (label: string) =>
    setHiddenTraj((s) => {
      const n = new Set(s);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });

  const visiblePaths = useMemo(
    () => paths.filter((e) => !hiddenTraj.has(e.d.label)),
    [paths, hiddenTraj],
  );
  const visibleDrivers = useMemo(
    () => drivers.filter((d) => !hiddenTraj.has(d.label)),
    [drivers, hiddenTraj],
  );
  const pointEntries = useMemo(
    () =>
      showPoints ? visiblePaths.map((e) => ({ key: e.d.label, color: e.d.color, pts: e.pts })) : [],
    [showPoints, visiblePaths],
  );

  // Growing portion of each trajectory at the current replay time.
  const trails = useMemo(
    () =>
      showTrajs
        ? visiblePaths.map((e) => ({
            key: e.d.label,
            color: e.d.color,
            reference: e.d.reference === true,
            done: time >= e.d.lap.duration,
            d: time < e.d.lap.duration ? trailPath(e.segments, time) : null,
          }))
        : [],
    [showTrajs, visiblePaths, time],
  );

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // A zoom minimo il circuito è interamente visibile: nessun pan possibile, quindi
  // il tocco deve scorrere la pagina (niente touch-action none né drag). Il pan
  // residuo viene azzerato così che uno zoom successivo riparta dal centro.
  const pannable = zoom > 1;
  useEffect(() => {
    if (!pannable) setPan((p) => (p.x === 0 && p.y === 0 ? p : { x: 0, y: 0 }));
  }, [pannable]);

  if (!geo || !outline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-warning" />
        <p className="max-w-sm">
          Circuito non ricostruibile: i campioni di posizione di questo giro sono insufficienti o
          hanno lacune troppo ampie. Nessuna geometria viene inventata.
        </p>
      </div>
    );
  }

  const vw = geo.vb.w / zoom,
    vh = geo.vb.h / zoom;
  const vx = geo.vb.x + (geo.vb.w - vw) / 2 + (pannable ? pan.x : 0);
  const vy = geo.vb.y + (geo.vb.h - vh) / 2 + (pannable ? pan.y : 0);
  const u = geo.unit / Math.sqrt(zoom);

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

  const pickOnPath = (entry: TrajEntry, clientX: number, clientY: number) => {
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

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        className={`h-full w-full ${pannable ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
        onPointerDown={(e) => {
          // a zoom minimo non si cattura il tocco: la pagina deve scorrere liberamente
          if (!pannable) {
            dismiss();
            return;
          }
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          if (!(e.target as Element).classList?.contains("cursor-pointer")) dismiss();
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerMove={(e) => {
          if (!pannable || !drag.current || !svgRef.current) return;
          const r = svgRef.current.getBoundingClientRect();
          const s = Math.max(vw / r.width, vh / r.height);
          setPan({
            x: drag.current.px - (e.clientX - drag.current.x) * s,
            y: drag.current.py - (e.clientY - drag.current.y) * s,
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => {
          dismiss();
          setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        <path
          d={geo.d}
          fill="none"
          stroke="var(--color-grid)"
          strokeWidth={u * 2.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={geo.d}
          fill="none"
          stroke="var(--color-track)"
          strokeWidth={u * 0.7}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* complete trajectories: faint while the replay still has to reach their end */}
        {showTrajs &&
          visiblePaths.map(({ d, full }, i) => (
            <path
              key={d.label + i}
              d={full}
              fill="none"
              stroke={d.color}
              strokeWidth={u * (d.reference ? 1.1 : 0.65)}
              strokeDasharray={d.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={time < d.lap.duration ? 0.45 : d.reference ? 1 : 0.8}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                pickOnPath(visiblePaths[i]!, e.clientX, e.clientY);
              }}
            />
          ))}
        {/* original samples, one tiny dot each (opt-in) */}
        <PointsLayer entries={pointEntries} u={u} />
        {/* progressive trajectories: recorded samples only, up to the replay time */}
        {trails.map((tr, i) =>
          tr.d ? (
            <path
              key={tr.key + "-trail-" + i}
              d={tr.d}
              fill="none"
              stroke={tr.color}
              strokeWidth={u * (tr.reference ? 1.35 : 0.9)}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.95}
            />
          ) : null,
        )}
        {/* lap start marker (first in-lap sample, not assumed origin) */}
        <circle
          cx={outline.first.x}
          cy={-outline.first.y}
          r={u * 0.9}
          fill="var(--color-primary)"
        />
        {visibleDrivers.map((d, i) => {
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
      {/* per-driver trajectory visibility (map only) */}
      <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
        {drivers.map((d) => {
          const hid = hiddenTraj.has(d.label);
          return (
            <button
              key={d.label}
              type="button"
              aria-pressed={!hid}
              title={
                hid
                  ? `Mostra la traiettoria di ${d.label}`
                  : `Nascondi la traiettoria di ${d.label}`
              }
              onClick={() => toggleTraj(d.label)}
              className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] backdrop-blur-sm transition-colors ${
                hid
                  ? "border-border bg-card/60 text-muted-foreground"
                  : "border-border bg-card/85 text-foreground hover:border-primary/40"
              }`}
            >
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ background: d.color, opacity: hid ? 0.4 : 1 }}
              />
              <span style={{ color: hid ? undefined : d.color }}>
                {d.number} {d.label}
              </span>
              {hid ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          );
        })}
      </div>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          {
            id: "trajs",
            icon: Spline,
            label: showTrajs ? "Nascondi traiettorie" : "Mostra traiettorie",
            on: showTrajs,
            fn: () => {
              dismiss();
              setShowTrajs((v) => !v);
            },
          },
          {
            id: "points",
            icon: CircleDot,
            label: showPoints ? "Nascondi punti campione" : "Mostra punti campione",
            on: showPoints,
            fn: () => {
              dismiss();
              setShowPoints((v) => !v);
            },
          },
          {
            id: "zin",
            icon: ZoomIn,
            label: "Zoom avanti",
            on: false,
            fn: () => {
              dismiss();
              setZoom((z) => Math.min(8, z * 1.3));
            },
          },
          {
            id: "zout",
            icon: ZoomOut,
            label: "Zoom indietro",
            on: false,
            fn: () => {
              dismiss();
              setZoom((z) => Math.max(1, z / 1.3));
            },
          },
          {
            id: "reset",
            icon: Maximize2,
            label: "Ripristina vista",
            on: false,
            fn: () => {
              dismiss();
              setZoom(1);
              setPan({ x: 0, y: 0 });
            },
          },
        ].map(({ id, icon: I, label, on, fn }) => (
          <button
            key={id}
            aria-label={label}
            title={label}
            aria-pressed={on}
            onClick={fn}
            className={`rounded border p-1.5 ${
              on
                ? "border-primary/40 bg-primary/15 text-foreground"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <I className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
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
        Tracciato da {outline.count} campioni ({outline.from}) · ● = inizio giro · lacune &gt; 1,5 s
        spezzate, nessun collegamento inventato · clic su una traiettoria per i valori
      </div>
    </div>
  );
}
