import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bug,
  CircleDot,
  LocateFixed,
  Maximize,
  Minimize,
  Route as RouteIcon,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LapData, PosSample } from "@/lib/telemetry";
import { MAX_POS_GAP, positionAt, telemetryAt } from "@/lib/telemetry";
import {
  computeBounds,
  fitWindow,
  groupByCoordinateSpace,
  maxTimeGap,
  sanitizePos,
  splitAtGaps,
  splitAtGapsDetailed,
  trailPath,
  viewBoxFor,
  type Bounds,
  type SanitizeStats,
} from "@/lib/trackGeometry";

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

const MIN_OUTLINE_POINTS = 60; // samples needed for a usable neutral reference line
const MAX_ZOOM = 14;
const FALLBACK_PANEL_W = 640; // px estimate before the ResizeObserver fires (≈ f1-panel)
/** stroke widths in CSS px (independent of any unit↔metre assumption) */
const LINE_PX = 2.8; // main trajectories (spec: ~2.5–3.5 px)
const REFERENCE_PX = 3.4; // z-emphasis for the first lap
const HALO_PX = 1.6; // contrast outline under each line
const REF_LINE_PX = 1.6; // neutral reference trajectory
const SAMPLE_R_PX = 3; // sampled-points markers
const HIT_PX = 18; // invisible tap target around each trajectory

type DebugRow = {
  label: string;
  color: string;
  space: string;
  stats: SanitizeStats;
  drawable: boolean;
  segs: number;
  isolated: number;
  tStart: number | null;
  tEnd: number | null;
  maxGap: number | null;
  bb: Bounds | null;
  notes: string[];
};

/** One map panel = ONE coordinate system (all drivers overlapped 1:1, no transforms). */
function MapCanvas({
  drivers,
  time,
  onPickTime,
  showTrails,
  spaceKey,
}: {
  drivers: MapDriver[];
  time: number;
  onPickTime?: (t: number) => void;
  showTrails: boolean;
  spaceKey: string;
}) {
  // Per-driver in-lap samples, cleaned and kept in strict time order.
  const cleaned = useMemo(
    () => drivers.map((d) => ({ d, ...sanitizePos(d.lap.pos, d.lap.duration) })),
    [drivers],
  );
  const drawable = useMemo(() => cleaned.filter((c) => c.pts.length >= 2), [cleaned]);

  // Bounding box = union of ALL drawable trajectories (never one driver only).
  const bounds = useMemo(() => computeBounds(drawable.map((c) => c.pts)), [drawable]);
  const vb = useMemo(() => viewBoxFor(bounds), [bounds]);

  // Neutral reference line: a well-covered lap, clearly labelled as a reference
  // trajectory — NOT the real track border (OpenF1 publishes no track geometry).
  const ref = useMemo(() => {
    for (const c of cleaned)
      if (c.pts.length >= MIN_OUTLINE_POINTS && c.d.lap.coverage.maxPosGap < 5) return c;
    return null;
  }, [cleaned]);
  const refD = useMemo(() => (ref ? trailPath(splitAtGaps(ref.pts), Infinity) : ""), [ref]);
  const startPt: PosSample | null = ref?.pts[0] ?? drawable[0]?.pts[0] ?? null;

  // Per-driver segments + full paths (gaps → separate M sub-paths, never a link).
  const paths = useMemo(
    () =>
      drawable.map((c) => {
        const det = splitAtGapsDetailed(c.pts);
        return {
          d: c.d,
          pts: c.pts,
          segs: det.segs,
          isolated: det.isolated,
          full: trailPath(det.segs, Infinity),
        };
      }),
    [drawable],
  );

  // ---- diagnostics (Debug geometria) ----------------------------------------
  const debugRows: DebugRow[] = useMemo(
    () =>
      cleaned.map((c) => {
        const det = splitAtGapsDetailed(c.pts);
        const notes: string[] = [];
        if (c.stats.nonFinite)
          notes.push(`${c.stats.nonFinite} campioni con coordinate non finite`);
        if (c.stats.outOfLap) notes.push(`${c.stats.outOfLap} fuori dall'intervallo del giro`);
        if (c.stats.duplicate) notes.push(`${c.stats.duplicate} timestamp duplicati`);
        if (det.isolated)
          notes.push(`${det.isolated} campioni isolati (lacuna > ${MAX_POS_GAP} s)`);
        if (c.pts.length < 2) notes.push("meno di 2 campioni validi: traiettoria non disegnabile");
        if (c.d.lap.coverage.maxPosGap >= 5) notes.push("maxPosGap ≥ 5 s: esclusa dal riferimento");
        return {
          label: c.d.label,
          color: c.d.color,
          space: c.d.lap.coordsSpace ?? "sconosciuto",
          stats: c.stats,
          drawable: c.pts.length >= 2,
          segs: det.segs.length,
          isolated: det.isolated,
          tStart: c.pts[0]?.t ?? null,
          tEnd: c.pts[c.pts.length - 1]?.t ?? null,
          maxGap: c.pts.length >= 2 ? maxTimeGap(c.pts) : null,
          bb: computeBounds([c.pts]),
          notes,
        };
      }),
    [cleaned],
  );

  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [progressive, setProgressive] = useState(false);
  const [showPts, setShowPts] = useState(false);
  const [debug, setDebug] = useState(false);
  const [full, setFull] = useState(false);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    s: number;
  } | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<{ d0: number; z0: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Container size: the SVG viewBox + preserveAspectRatio="xMidYMid meet" keeps
  // the whole circuit framed at any size; the observer feeds the pixel metrics
  // (strokes, dashes, markers) so they stay constant on screen while resizing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New trajectory group (different drivers/frame) → recompute the initial fit:
  // no stale centre or zoom carried over from the previous data.
  useEffect(() => {
    setZoom(1);
    setCenter(null);
    setInspect(null);
  }, [vb]);

  // current clamped viewport window (viewBox coords, y already flipped)
  const view = vb ? fitWindow(vb, zoom, center) : null;
  // world units per CSS pixel ("meet": uniform scale = max of the two ratios)
  const scale =
    view && size ? Math.max(view.vw / size.w, view.vh / size.h) : vb ? vb.w / FALLBACK_PANEL_W : 1;
  const dashU = (dash: string | undefined) =>
    dash
      ? dash
          .split(/[\s,]+/)
          .map((x) => (Number(x) * scale).toFixed(2))
          .join(" ")
      : undefined;

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
    if (!vb || !view) return;
    const p = userPoint(clientX, clientY);
    if (!p) return;
    const fx = (p.x - view.vx) / view.vw,
      fy = (p.y - view.vy) / view.vh;
    setZoom(z2);
    setCenter({ x: p.x - (fx - 0.5) * (vb.w / z2), y: p.y - (fy - 0.5) * (vb.h / z2) });
  };

  const zoomBy = (f: number) => {
    const svg = svgRef.current;
    const z2 = Math.min(MAX_ZOOM, Math.max(1, zoom * f));
    if (!svg) {
      setZoom(z2);
      return;
    }
    const r = svg.getBoundingClientRect();
    zoomToAt(r.left + r.width / 2, r.top + r.height / 2, z2);
  };

  // FIT/RESET: recompute the initial framing with the whole circuit on screen.
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
      zoomToAt(
        e.clientX,
        e.clientY,
        Math.min(MAX_ZOOM, Math.max(1, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))),
      );
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
    const tol = (12 * scale) ** 2; // ≈ 12 CSS px from the clicked point
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

  const toggleFull = () => {
    ptrs.current.clear();
    gest.current = null;
    drag.current = null;
    setInspect(null);
    setFull((f) => !f);
  };

  const pill = (active: boolean) =>
    `inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] backdrop-blur ${
      active
        ? "border-primary/60 bg-primary/15 text-foreground"
        : "border-border bg-secondary/90 text-muted-foreground hover:text-foreground"
    }`;

  const debugPanel = (
    <div className="max-h-[65vh] w-[21rem] max-w-[calc(100vw-2rem)] shrink overflow-auto rounded border border-border bg-card/95 p-2 font-mono text-[10px] leading-relaxed shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider">Debug geometria</span>
        <button
          aria-label="Chiudi debug"
          onClick={() => setDebug(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="text-muted-foreground">
        <div>
          spazio coordinate: <span className="text-foreground">{spaceKey}</span>
        </div>
        {vb ? (
          <>
            <div>
              viewBox:{" "}
              <span className="text-foreground">
                {vb.w.toFixed(1)} × {vb.h.toFixed(1)} u
              </span>{" "}
              (pad 5% per lato)
            </div>
            <div>
              pannello:{" "}
              <span className="text-foreground">
                {size ? `${Math.round(size.w)}×${Math.round(size.h)} px` : "n/d"}
              </span>{" "}
              · scala {scale.toFixed(2)} u/px · zoom {zoom.toFixed(2)}×
            </div>
          </>
        ) : (
          <div>viewBox: n/d (nessun dato tracciabile)</div>
        )}
        {bounds && (
          <div>
            bbox dati: X [{bounds.minX.toFixed(1)} … {bounds.maxX.toFixed(1)}] · Y [
            {bounds.minY.toFixed(1)} … {bounds.maxY.toFixed(1)}]
          </div>
        )}
      </div>
      <div className="mt-1 space-y-1.5">
        {debugRows.map((r, i) => (
          <div key={i} className="rounded border border-border/60 p-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold" style={{ color: r.color }}>
                {r.label}
                {!r.drawable && <span className="text-warning"> · SCARTATO</span>}
              </span>
              <span className="text-muted-foreground">{r.space}</span>
            </div>
            <div className="text-muted-foreground">
              campioni validi: <span className="text-foreground">{r.stats.kept}</span>
              {r.stats.nonFinite + r.stats.duplicate + r.stats.outOfLap > 0 && (
                <span className="text-warning">
                  {" "}
                  (−{r.stats.nonFinite} non finiti, −{r.stats.outOfLap} fuori giro, −
                  {r.stats.duplicate} dup.)
                </span>
              )}
            </div>
            <div className="text-muted-foreground">
              segmenti SVG: <span className="text-foreground">{r.segs}</span>
              {r.isolated > 0 && (
                <span className="text-warning"> · {r.isolated} campioni isolati scartati</span>
              )}
              {" · t giro: "}
              <span className="text-foreground">
                {r.tStart === null ? "n/d" : `${r.tStart.toFixed(2)}→${r.tEnd!.toFixed(2)} s`}
              </span>
            </div>
            <div className="text-muted-foreground">
              lacuna max:{" "}
              <span className="text-foreground">
                {r.maxGap === null ? "n/d" : `${r.maxGap.toFixed(2)} s`}
              </span>
              {r.maxGap !== null && r.maxGap > MAX_POS_GAP && (
                <span className="text-warning"> (&gt; {MAX_POS_GAP} s → segmenti separati)</span>
              )}
            </div>
            <div className="text-muted-foreground">
              bbox:{" "}
              <span className="text-foreground">
                {r.bb
                  ? `X[${r.bb.minX.toFixed(0)}…${r.bb.maxX.toFixed(0)}] Y[${r.bb.minY.toFixed(0)}…${r.bb.maxY.toFixed(0)}]`
                  : "n/d"}
              </span>
            </div>
            {r.notes.length > 0 && (
              <div className="text-warning">
                {r.notes.map((n, j) => (
                  <div key={j}>· {n}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 text-muted-foreground">
        lacuna massima ammessa dentro un segmento: {MAX_POS_GAP} s (campionamento /location ≈ 3,7
        Hz) · nessuna coordinata viene traslata, ruotata o riscalata
      </div>
    </div>
  );

  const body = (isFull: boolean) => (
    <>
      {view && vb ? (
        <svg
          ref={svgRef}
          viewBox={`${view.vx} ${view.vy} ${view.vw} ${view.vh}`}
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
              drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, s: scale };
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
                zoomToAt(
                  (a.x + b.x) / 2,
                  (a.y + b.y) / 2,
                  Math.min(MAX_ZOOM, Math.max(1, (g.z0 * dist) / g.d0)),
                );
              return;
            }
            if (!drag.current) return;
            setCenter({
              x: drag.current.cx - (e.clientX - drag.current.x) * drag.current.s,
              y: drag.current.cy - (e.clientY - drag.current.y) * drag.current.s,
            });
          }}
          onPointerUp={endPtr}
          onPointerCancel={endPtr}
        >
          {/* neutral reference trajectory: a well-covered lap drawn thin and grey,
              BELOW every trajectory. It is explicitly a reference lap, not the
              real track border — OpenF1 publishes no independent track geometry. */}
          {refD && (
            <path
              d={refD}
              fill="none"
              stroke="var(--color-muted-foreground)"
              strokeWidth={REF_LINE_PX}
              opacity={0.55}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
              className="pointer-events-none"
            />
          )}
          {/* trajectories: real /location X/Y only. Solid lines use CSS-px strokes
              (vector-effect); dashed lines scale the pattern to the same screen
              size. Contrast halo underneath keeps every colour readable. The
              reference lap is drawn LAST (on top): coincident trajectories are
              never offset — colours, patterns, sample points and the legend
              visibility toggles tell them apart. */}
          {showTrails &&
            [...paths]
              .sort((a, b) => Number(a.d.reference ?? false) - Number(b.d.reference ?? false))
              .map(({ d, segs, pts, full: fullD }) => {
                const w = d.reference ? REFERENCE_PX : LINE_PX;
                const dashed = !!d.dash;
                const solidD = progressive
                  ? trailPath(segs, Math.min(time, d.lap.duration))
                  : fullD;
                return (
                  <g key={d.label}>
                    {/* modalità progressiva = SOLO la porzione già percorsa;
                      il percorso completo si vede con la modalità disattivata */}
                    {solidD && (
                      <>
                        <path
                          d={solidD}
                          fill="none"
                          stroke="var(--color-background)"
                          strokeWidth={dashed ? (w + HALO_PX) * scale : w + HALO_PX}
                          strokeDasharray={dashU(d.dash)}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={0.9}
                          className="pointer-events-none"
                        />
                        <path
                          d={solidD}
                          fill="none"
                          stroke={d.color}
                          strokeWidth={dashed ? w * scale : w}
                          strokeDasharray={dashU(d.dash)}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          opacity={d.reference ? 1 : 0.95}
                          vectorEffect={dashed ? undefined : "non-scaling-stroke"}
                          className="pointer-events-none"
                        />
                      </>
                    )}
                    {/* invisible wide hit area: a 3 px line is not tappable */}
                    <path
                      d={solidD || fullD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={HIT_PX * scale}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickOnPath({ d, pts }, e.clientX, e.clientY);
                      }}
                    />
                  </g>
                );
              })}
          {/* sampled points (optional): raw /location samples on top of the lines,
              never interpolated points */}
          {showPts &&
            paths.map(({ d, pts }) => (
              <g key={"pts-" + d.label} className="pointer-events-none">
                {pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={-p.y}
                    r={SAMPLE_R_PX * scale}
                    fill={d.color}
                    stroke="var(--color-background)"
                    strokeWidth={scale}
                  />
                ))}
              </g>
            ))}
          {/* lap start marker (first kept sample, not an assumed origin) */}
          {startPt && (
            <circle
              cx={startPt.x}
              cy={-startPt.y}
              r={4.5 * scale}
              fill="var(--color-track)"
              stroke="var(--color-grid)"
              strokeWidth={scale}
            />
          )}
          {drivers.map((d, i) => {
            const p = positionAt(d.lap.pos, Math.min(time, d.lap.duration));
            if (!p) return null;
            const r = 5 * scale; // punto auto: ~5 px sullo schermo a qualsiasi zoom
            return (
              <g key={d.number + "-" + i} className="pointer-events-none">
                <circle cx={p.x} cy={-p.y} r={r * 2} fill={d.color} opacity={0.18} />
                <circle
                  cx={p.x}
                  cy={-p.y}
                  r={r}
                  fill={d.color}
                  stroke="var(--color-background)"
                  strokeWidth={1.5 * scale}
                />
                <text
                  x={p.x + r + 3 * scale}
                  y={-p.y - r - 3 * scale + i * 18 * scale}
                  fill={d.color}
                  fontSize={11.5 * scale}
                  fontFamily="var(--font-mono)"
                  fontWeight={700}
                  paintOrder="stroke"
                  stroke="var(--color-background)"
                  strokeWidth={3 * scale}
                >
                  {d.number} {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <p className="max-w-sm">
            {drivers.length === 0
              ? "Nessun pilota visibile: riattiva almeno una traiettoria dalla legenda."
              : "Circuito non ricostruibile: nessun pilota visibile ha abbastanza campioni di posizione validi. Nessuna geometria viene inventata: apri «Debug geometria» per vedere cosa è stato scartato e perché."}
          </p>
        </div>
      )}
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
            label: "FIT: adatta tutto il circuito alla vista",
            fn: () => {
              dismiss();
              resetView();
            },
          },
          {
            icon: isFull ? Minimize : Maximize,
            label: isFull ? "Chiudi schermo intero (ESC)" : "Schermo intero",
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
      {/* display options */}
      <div className="absolute left-2 top-2 z-20 flex max-h-[calc(100%-1rem)] flex-col items-start gap-1 overflow-visible">
        {showTrails && (
          <>
            <button
              aria-pressed={progressive}
              title="Disegna le traiettorie fino all'istante della riproduzione"
              onClick={() => setProgressive((p) => !p)}
              className={pill(progressive)}
            >
              <RouteIcon className="h-3 w-3" />
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
          </>
        )}
        <button
          aria-pressed={debug}
          title="Statistiche dei campioni, segmenti, bounding box e spazio di coordinate"
          onClick={() => setDebug((v) => !v)}
          className={pill(debug)}
        >
          <Bug className="h-3 w-3" />
          <span className="hidden sm:inline">Debug geometria</span>
        </button>
        {/* nel flusso della colonna: non copre mai i comandi sopra né la mappa sotto */}
        {debug && debugPanel}
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
      <div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-5rem)] font-mono text-[10px] text-muted-foreground">
        {showTrails
          ? ref
            ? `Linea grigia sottile = traiettoria di riferimento (giro di ${ref.d.label}), NON il bordo della pista · ● inizio giro · clic su una traiettoria per i valori`
            : "Nessuna traiettoria di riferimento disponibile (campioni insufficienti) · ● inizio giro"
          : "Traiettorie disattive · ● inizio giro"}
      </div>
    </>
  );

  return (
    <>
      {!full && (
        <div ref={wrapRef} className="relative h-full w-full">
          {body(false)}
        </div>
      )}
      {full && (
        <div className="fixed inset-0 z-50 bg-background p-1 sm:p-2">
          <div ref={wrapRef} className="relative h-full w-full">
            {body(true)}
          </div>
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 font-mono text-[10px] text-muted-foreground">
            schermo intero · ESC per uscire
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Trajectory map. All drivers that share one coordinate frame are overlapped
 * 1:1 on a single fitted map; frames that differ (different OpenF1 session,
 * different archive) are NEVER merged into one bounding box and never
 * rescaled/rotated/translated to fake alignment — they are shown as separate
 * panels with a clear warning instead.
 */
export function TrackMap({
  drivers,
  time,
  onPickTime,
  showTrails = true,
}: {
  drivers: MapDriver[];
  time: number;
  onPickTime?: (t: number) => void;
  /** true = linee reali sul circuito; false = solo riferimento + punti posizione */
  showTrails?: boolean;
}) {
  const groups = useMemo(() => groupByCoordinateSpace(drivers), [drivers]);

  if (groups.length <= 1) {
    const g = groups[0];
    return (
      <MapCanvas
        key={g?.key ?? "sconosciuto"}
        drivers={g?.drivers ?? []}
        time={time}
        onPickTime={onPickTime}
        showTrails={showTrails}
        spaceKey={g?.key ?? "sconosciuto"}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-1 p-1">
      <div className="flex shrink-0 items-start gap-2 rounded border border-warning/60 bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          I piloti appartengono a <b>sistemi di coordinate diversi</b> (
          {groups.map((g) => g.key).join(" · ")}): i frame non sono garantiti sovrapponibili, quindi
          non vengono uniti nello stesso riquadro né riscalati artificialmente. Ogni sistema è
          mostrato in un pannello separato, alle sue coordinate originali.
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.key} className="relative min-h-56 min-w-0">
            <MapCanvas
              key={g.key}
              drivers={g.drivers}
              time={time}
              onPickTime={onPickTime}
              showTrails={showTrails}
              spaceKey={g.key}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
