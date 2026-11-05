import { MAX_POS_GAP, type PosSample } from "./telemetry";

/**
 * Pure geometry helpers for the trajectory map. Every function works on the RAW
 * /location X,Y samples: no rescaling, no rotation, no offset, no invented
 * geometry. The only transformation ever applied is the Y flip for SVG (SVG y
 * grows downward, OpenF1 y grows upward), which preserves distances 1:1.
 *
 * These functions are pure and unit-tested in src/test/trackGeometry.test.ts.
 */

/** Axis-aligned bounds in raw /location coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** SVG viewBox in map space (y already flipped for SVG). */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SanitizeStats {
  /** usable in-lap samples */
  kept: number;
  /** NaN / ±Infinity in t, x or y */
  nonFinite: number;
  /** repeated timestamp (first occurrence kept) */
  duplicate: number;
  /** t outside the lap window [0, duration] */
  outOfLap: number;
}

export interface Sanitized {
  pts: PosSample[];
  stats: SanitizeStats;
}

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Clean a lap's raw position samples for drawing:
 * 1. chronological order by t (stable — never geometric),
 * 2. drop non-finite coordinates (counted),
 * 3. drop samples outside the lap window [0, duration] (counted),
 * 4. drop duplicate timestamps (first kept, counted).
 * Coordinates are never altered or reordered geometrically.
 */
export function sanitizePos(raw: PosSample[], duration: number): Sanitized {
  const stats: SanitizeStats = { kept: 0, nonFinite: 0, duplicate: 0, outOfLap: 0 };
  const pass1: { p: PosSample; i: number }[] = [];
  raw.forEach((p, i) => {
    if (!isFiniteNum(p.t) || !isFiniteNum(p.x) || !isFiniteNum(p.y)) {
      stats.nonFinite += 1;
      return;
    }
    if (p.t < 0 || p.t > duration) {
      stats.outOfLap += 1;
      return;
    }
    pass1.push({ p, i });
  });
  // stable sort by t only (input is normally already sorted; never geometric)
  pass1.sort((a, b) => a.p.t - b.p.t || a.i - b.i);
  const pts: PosSample[] = [];
  let prev: number | null = null;
  for (const { p } of pass1) {
    if (prev !== null && p.t === prev) {
      stats.duplicate += 1;
      continue;
    }
    prev = p.t;
    pts.push(p);
  }
  stats.kept = pts.length;
  return { pts, stats };
}

/** Union bounds over every given series; null when no finite point exists. */
export function computeBounds(series: PosSample[][]): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pts of series) {
    for (const p of pts) {
      if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  )
    return null;
  return { minX, minY, maxX, maxY };
}

const PAD_FRAC = 0.05; // ≥ stroke allowance at every realistic panel size

/**
 * viewBox that contains the WHOLE bounds on all four sides, whatever the sign
 * of the coordinates or the aspect ratio (long/narrow, near-circular, extreme
 * x/y differences). The y axis is flipped (map y = -raw y). A degenerate or
 * non-finite bounds falls back to a finite, non-zero box, and the padding is
 * scaled to the larger dimension so strokes never clip at the edges.
 */
export function viewBoxFor(b: Bounds | null, padFrac: number = PAD_FRAC): ViewBox | null {
  if (!b) return null;
  const { minX, minY, maxX, maxY } = b;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h, 1e-9); // never zero → never divide by zero
  const pad = maxDim * Math.max(padFrac, 0);
  return {
    x: minX - pad,
    y: -(maxY + pad), // y flip
    w: Math.max(w, 0) + pad * 2,
    h: Math.max(h, 0) + pad * 2,
  };
}

/**
 * Visible window for a zoom level (zoom = 1 → the whole viewBox, "FIT").
 * The window stays inside the viewBox: at fit zoom the centre is the viewBox
 * centre, when zoomed the centre is clamped so no empty void beyond the pad
 * can be shown. Pure equivalent of the old in-component viewOf.
 */
export function fitWindow(
  vb: ViewBox,
  zoom: number,
  center: { x: number; y: number } | null,
): { vx: number; vy: number; vw: number; vh: number; cx: number; cy: number } {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const vw = vb.w / z;
  const vh = vb.h / z;
  const clamp = (c: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, c));
  const cx0 = center && Number.isFinite(center.x) ? center.x : vb.x + vb.w / 2;
  const cy0 = center && Number.isFinite(center.y) ? center.y : vb.y + vb.h / 2;
  const cx = vw >= vb.w ? vb.x + vb.w / 2 : clamp(cx0, vb.x + vw / 2, vb.x + vb.w - vw / 2);
  const cy = vh >= vb.h ? vb.y + vb.h / 2 : clamp(cy0, vb.y + vh / 2, vb.y + vb.h - vh / 2);
  return { vx: cx - vw / 2, vy: cy - vh / 2, vw, vh, cx, cy };
}

/**
 * Split samples into continuous segments: a temporal hole larger than `gap`
 * starts a new segment. Segments with a single sample are dropped (no invented
 * link across a gap, no fake geometry from isolated points).
 */
export function splitAtGaps(pts: PosSample[], gap: number = MAX_POS_GAP): PosSample[][] {
  return splitAtGapsDetailed(pts, gap).segs;
}

/** Same as splitAtGaps but also reports how many isolated samples were dropped. */
export function splitAtGapsDetailed(
  pts: PosSample[],
  gap: number = MAX_POS_GAP,
): { segs: PosSample[][]; isolated: number } {
  const segs: PosSample[][] = [];
  let cur: PosSample[] = [];
  let isolated = 0;
  for (const p of pts) {
    if (cur.length === 0 || p.t - cur[cur.length - 1]!.t <= gap) cur.push(p);
    else {
      if (cur.length >= 2) segs.push(cur);
      else isolated += cur.length;
      cur = [p];
    }
  }
  if (cur.length >= 2) segs.push(cur);
  else isolated += cur.length;
  return { segs, isolated };
}

/** Largest temporal hole between consecutive samples (0 for < 2 samples). */
export function maxTimeGap(pts: PosSample[]): number {
  let g = 0;
  for (let i = 1; i < pts.length; i++) g = Math.max(g, pts[i]!.t - pts[i - 1]!.t);
  return g;
}

/**
 * Number formatter for path data: fixed precision, trailing zeros trimmed.
 * With dec = 2 (≈ centimetre if units are decimetres) the geometry is intact —
 * the old Math.round() destroyed sub-unit detail and made lines jagged when
 * zoomed. Returns e.g. "10" for 10.00, "10.5" for 10.50, "-0.02" for -0.02.
 */
export function fmtCoord(v: number, dec = 2): string {
  if (!Number.isFinite(v)) return "0";
  let s = v.toFixed(dec);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * SVG path of the segments drawn up to instant `upTo` (y already flipped, as
 * in the viewBox). Each segment is its own sub-path starting with M: gaps
 * never get an artificial connection and the path is never closed with Z.
 * The tip is interpolated only INSIDE the current segment and never beyond the
 * last recorded sample.
 */
export function trailPath(segs: PosSample[][], upTo: number, dec = 2): string {
  const n = (v: number) => fmtCoord(v, dec);
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

/** A driver entry for space grouping (anything exposing a lap). */
export interface SpaceAwareLap {
  coordsSpace?: string;
}

/**
 * Group drivers by coordinate reference system. OpenF1 laps carry
 * `openf1:<session_key>` (set by openf1Source), local archives carry
 * `local:<year>:<event>:<circuit>:<session>:<date>` (set by history.ts).
 * Laps without metadata all fall into the same legacy key: the map can only
 * overlay them when they provably share one frame — different keys are NEVER
 * merged into one bounding box (no rescaling/rotation/translation is applied).
 */
export function groupByCoordinateSpace<T>(drivers: T[]): { key: string; drivers: T[] }[] {
  const out: { key: string; drivers: T[] }[] = [];
  const index = new Map<string, { key: string; drivers: T[] }>();
  drivers.forEach((d, i) => {
    const lap = (d as { lap?: SpaceAwareLap } | null)?.lap;
    const key =
      lap && typeof lap.coordsSpace === "string" && lap.coordsSpace
        ? lap.coordsSpace
        : "sconosciuto";
    let g = index.get(key);
    if (!g) {
      g = { key, drivers: [] };
      index.set(key, g);
      out.push(g);
    }
    g.drivers.push(d);
    void i;
  });
  return out;
}
