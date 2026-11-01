import { useMemo, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut, AlertTriangle } from "lucide-react";
import type { LapData } from "@/lib/telemetry";
import { positionAt } from "@/lib/telemetry";

export interface MapDriver { lap: LapData; color: string; label: string; number: number }

const MIN_OUTLINE_POINTS = 60;

export function TrackMap({ drivers, time }: { drivers: MapDriver[]; time: number }) {
  // Outline: the first driver with enough in-lap samples, kept in time order.
  const outline = useMemo(() => {
    for (const d of drivers) {
      const pts = d.lap.pos.filter((p) => p.t >= 0 && p.t <= d.lap.duration);
      if (pts.length >= MIN_OUTLINE_POINTS && d.lap.coverage.maxPosGap < 5) return { pts, from: d.label };
    }
    return null;
  }, [drivers]);

  const geo = useMemo(() => {
    if (!outline) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of outline.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX, h = maxY - minY;
    const pad = Math.max(w, h) * 0.06;
    // y is flipped (OpenF1 y grows upward); uniform scale keeps proportions
    const vb = { x: minX - pad, y: -maxY - pad, w: w + pad * 2, h: h + pad * 2 };
    const d = outline.pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)},${(-p.y).toFixed(0)}`).join(" ");
    return { vb, d, unit: Math.max(w, h) / 100 };
  }, [outline]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!geo || !outline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-warning" />
        <p className="max-w-sm">
          Circuito non ricostruibile: i campioni di posizione di questo giro sono insufficienti o hanno lacune troppo ampie.
          Nessuna geometria viene inventata.
        </p>
      </div>
    );
  }

  const vw = geo.vb.w / zoom, vh = geo.vb.h / zoom;
  const vx = geo.vb.x + (geo.vb.w - vw) / 2 + pan.x;
  const vy = geo.vb.y + (geo.vb.h - vh) / 2 + pan.y;
  const u = geo.unit / Math.sqrt(zoom);

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
        }}
        onPointerMove={(e) => {
          if (!drag.current || !svgRef.current) return;
          const r = svgRef.current.getBoundingClientRect();
          const s = Math.max(vw / r.width, vh / r.height);
          setPan({ x: drag.current.px - (e.clientX - drag.current.x) * s, y: drag.current.py - (e.clientY - drag.current.y) * s });
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
      >
        <path d={geo.d} fill="none" stroke="var(--color-grid)" strokeWidth={u * 2.6} strokeLinejoin="round" strokeLinecap="round" />
        <path d={geo.d} fill="none" stroke="var(--color-track)" strokeWidth={u * 0.7} strokeLinejoin="round" strokeLinecap="round" />
        {/* lap start marker (first in-lap sample, not assumed origin) */}
        <circle cx={outline.pts[0]!.x} cy={-outline.pts[0]!.y} r={u * 0.9} fill="var(--color-primary)" />
        {drivers.map((d, i) => {
          const p = positionAt(d.lap.pos, Math.min(time, d.lap.duration));
          if (!p) return null;
          return (
            <g key={d.number + "-" + i}>
              <circle cx={p.x} cy={-p.y} r={u * 3.2} fill={d.color} opacity={0.18} />
              <circle cx={p.x} cy={-p.y} r={u * 1.6} fill={d.color} stroke="var(--color-background)" strokeWidth={u * 0.4} />
              <text
                x={p.x + u * 2.4} y={-p.y - u * 2.0 + i * u * 4.5}
                fill={d.color} fontSize={u * 3.4} fontFamily="var(--font-mono)" fontWeight={700}
                paintOrder="stroke" stroke="var(--color-background)" strokeWidth={u * 0.8}
              >
                {d.number} {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          { icon: ZoomIn, label: "Zoom avanti", fn: () => setZoom((z) => Math.min(8, z * 1.3)) },
          { icon: ZoomOut, label: "Zoom indietro", fn: () => setZoom((z) => Math.max(1, z / 1.3)) },
          { icon: Maximize2, label: "Ripristina vista", fn: () => { setZoom(1); setPan({ x: 0, y: 0 }); } },
        ].map(({ icon: I, label, fn }) => (
          <button key={label} aria-label={label} title={label} onClick={fn}
            className="rounded border border-border bg-secondary p-1.5 text-muted-foreground hover:text-foreground">
            <I className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-muted-foreground">
        Tracciato da {outline.pts.length} campioni /location ({outline.from}) · ● rosso = inizio giro
      </div>
    </div>
  );
}
