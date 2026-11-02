import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Maximize2, ZoomIn, ZoomOut, X } from "lucide-react";
import type { LapData } from "@/lib/telemetry";
import { positionAt, telemetryAt } from "@/lib/telemetry";

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

export function TrackMap({
  drivers,
  time,
  onPickTime,
}: {
  drivers: MapDriver[];
  time: number;
  onPickTime?: (t: number) => void;
}) {
  // Outline: the first driver with enough in-lap samples, kept in time order.
  const outline = useMemo(() => {
    for (const d of drivers) {
      const pts = d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration);
      if (pts.length >= MIN_OUTLINE_POINTS && d.lap.coverage.maxPosGap < 5)
        return { pts, from: d.label };
    }
    return null;
  }, [drivers]);

  const geo = useMemo(() => {
    if (!outline) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of outline.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX,
      h = maxY - minY;
    const pad = Math.max(w, h) * 0.06;
    // y is flipped (OpenF1 y grows upward); uniform scale keeps proportions
    const vb = { x: minX - pad, y: -maxY - pad, w: w + pad * 2, h: h + pad * 2 };
    const d = outline.pts
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)},${(-p.y).toFixed(0)}`)
      .join(" ");
    return { vb, d, unit: Math.max(w, h) / 100 };
  }, [outline]);

  // Per-driver trajectory paths (clickable).
  const paths = useMemo(
    () =>
      drivers
        .map((d) => {
          const pts = d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration);
          if (pts.length < 2) return null;
          return {
            d,
            path: pts
              .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)},${(-p.y).toFixed(0)}`)
              .join(" "),
            pts,
          };
        })
        .filter(Boolean) as {
        d: MapDriver;
        path: string;
        pts: { t: number; x: number; y: number }[];
      }[],
    [drivers],
  );

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
  const vx = geo.vb.x + (geo.vb.w - vw) / 2 + pan.x;
  const vy = geo.vb.y + (geo.vb.h - vh) / 2 + pan.y;
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

  const pickOnPath = (
    entry: { d: MapDriver; pts: { t: number; x: number; y: number }[] },
    clientX: number,
    clientY: number,
  ) => {
    const p = userPoint(clientX, clientY);
    if (!p) return;
    let best: { t: number; x: number; y: number } | null = null;
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
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          if (!(e.target as Element).classList?.contains("cursor-pointer")) dismiss();
        }}
        onPointerMove={(e) => {
          if (!drag.current || !svgRef.current) return;
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
        {/* per-driver trajectories: reference lap thicker and fully opaque */}
        {paths.map(({ d, path }, i) => (
          <path
            key={d.label + i}
            d={path}
            fill="none"
            stroke={d.color}
            strokeWidth={u * (d.reference ? 1.1 : 0.65)}
            strokeDasharray={d.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={d.reference ? 1 : 0.8}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              pickOnPath(paths[i]!, e.clientX, e.clientY);
            }}
          />
        ))}
        {/* lap start marker (first in-lap sample, not assumed origin) */}
        <circle
          cx={outline.pts[0]!.x}
          cy={-outline.pts[0]!.y}
          r={u * 0.9}
          fill="var(--color-primary)"
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
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          {
            icon: ZoomIn,
            label: "Zoom avanti",
            fn: () => {
              dismiss();
              setZoom((z) => Math.min(8, z * 1.3));
            },
          },
          {
            icon: ZoomOut,
            label: "Zoom indietro",
            fn: () => {
              dismiss();
              setZoom((z) => Math.max(1, z / 1.3));
            },
          },
          {
            icon: Maximize2,
            label: "Ripristina vista",
            fn: () => {
              dismiss();
              setZoom(1);
              setPan({ x: 0, y: 0 });
            },
          },
        ].map(({ icon: I, label, fn }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            onClick={fn}
            className="rounded border border-border bg-secondary p-1.5 text-muted-foreground hover:text-foreground"
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
        Tracciato da {outline.pts.length} campioni ({outline.from}) · ● = inizio giro · clic su una
        traiettoria per i valori
      </div>
    </div>
  );
}
