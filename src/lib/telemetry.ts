import type { CarData, Lap, Location } from "./openf1";

export interface TelSample {
  t: number; // seconds from lap start
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  rpm: number | null;
  gear: number | null;
  drs: number | null;
  drsOpen: number | null;
}
export interface PosSample {
  t: number;
  x: number;
  y: number;
}

export interface LapData {
  driver: number;
  lapNumber: number;
  startMs: number;
  duration: number; // seconds
  durationOfficial: boolean;
  tel: TelSample[];
  pos: PosSample[];
  dist: number[]; // cumulative distance (m) aligned with tel, integrated from speed
  coverage: { tel: number; pos: number; maxTelGap: number; maxPosGap: number };
  /** Tyre compound used on this lap, when known (stints join or archive field). */
  compound?: string | null;
  /** Age of the tyre in laps at this lap, when known. */
  tyreAge?: number | null;
}

export const MARGIN_S = 1.5; // extra fetched around lap boundaries for edge interpolation
export const MAX_POS_GAP = 1.5; // s: don't interpolate position across larger gaps
export const MAX_TEL_STALE = 1.0; // s: readout considered missing beyond this

export function lapWindow(
  lap: Lap,
  laps: Lap[],
): { startMs: number; endMs: number; official: boolean } | null {
  if (!lap.date_start) return null;
  const startMs = Date.parse(lap.date_start);
  if (lap.lap_duration)
    return { startMs, endMs: startMs + lap.lap_duration * 1000, official: true };
  const next = laps.find(
    (l) => l.driver_number === lap.driver_number && l.lap_number === lap.lap_number + 1,
  );
  if (next?.date_start) return { startMs, endMs: Date.parse(next.date_start), official: false };
  return null;
}

function dedupe<T extends { date: string }>(arr: T[]): (T & { ms: number })[] {
  const seen = new Set<number>();
  const out: (T & { ms: number })[] = [];
  for (const s of arr) {
    const ms = Date.parse(s.date);
    if (Number.isNaN(ms) || seen.has(ms)) continue;
    seen.add(ms);
    out.push({ ...s, ms });
  }
  return out.sort((a, b) => a.ms - b.ms); // time order only, never geometric
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function maxGap(ts: number[], dur: number) {
  let g = ts.length ? Math.max(ts[0]!, 0) : dur;
  for (let i = 1; i < ts.length; i++) g = Math.max(g, ts[i]! - ts[i - 1]!);
  if (ts.length) g = Math.max(g, dur - ts[ts.length - 1]!);
  return g;
}

export function buildLapData(
  driver: number,
  lapNumber: number,
  win: { startMs: number; endMs: number; official: boolean },
  car: CarData[],
  loc: Location[],
): LapData {
  const duration = (win.endMs - win.startMs) / 1000;
  const toT = (ms: number) => (ms - win.startMs) / 1000;
  const tel: TelSample[] = dedupe(car)
    .map((c) => {
      const brakeRaw = c.brake as unknown;
      const brake = typeof brakeRaw === "boolean" ? (brakeRaw ? 100 : 0) : num(brakeRaw);
      const drs = num(c.drs);
      return {
        t: toT(c.ms),
        speed: num(c.speed),
        throttle: num(c.throttle),
        brake: brake === null ? null : brake > 0 ? 1 : 0,
        rpm: num(c.rpm),
        gear: num(c.n_gear),
        drs,
        drsOpen: drs === null ? null : drs >= 10 ? 1 : 0, // 10/12/14 = open per OpenF1 docs
      };
    })
    .filter((s) => s.t >= -MARGIN_S && s.t <= duration + MARGIN_S);
  const pos: PosSample[] = dedupe(loc)
    .filter((l) => num(l.x) !== null && num(l.y) !== null && !(l.x === 0 && l.y === 0))
    .map((l) => ({ t: toT(l.ms), x: l.x as number, y: l.y as number }))
    .filter((s) => s.t >= -MARGIN_S && s.t <= duration + MARGIN_S);

  // distance by integrating speed (trapezoid), only across gaps <= 1s
  const dist: number[] = [];
  let d = 0;
  for (let i = 0; i < tel.length; i++) {
    if (i > 0) {
      const a = tel[i - 1]!,
        b = tel[i]!;
      const dt = b.t - a.t;
      if (a.speed !== null && b.speed !== null && dt <= 1)
        d += ((a.speed + b.speed) / 2 / 3.6) * dt;
      else if (a.speed !== null && dt <= 1) d += (a.speed / 3.6) * dt;
    }
    dist.push(d);
  }
  const inTel = tel.filter((s) => s.t >= 0 && s.t <= duration).map((s) => s.t);
  const inPos = pos.filter((s) => s.t >= 0 && s.t <= duration).map((s) => s.t);
  return {
    driver,
    lapNumber,
    startMs: win.startMs,
    duration,
    durationOfficial: win.official,
    tel,
    pos,
    dist,
    coverage: {
      // nominal rates: car_data ≈ 3.7 Hz, location ≈ 3.7 Hz
      tel: Math.min(1, inTel.length / (duration * 3.7)),
      pos: Math.min(1, inPos.length / (duration * 3.7)),
      maxTelGap: maxGap(inTel, duration),
      maxPosGap: maxGap(inPos, duration),
    },
  };
}

function lowerIdx<T extends { t: number }>(arr: T[], t: number): number {
  let lo = 0,
    hi = arr.length - 1,
    ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m]!.t <= t) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

/** Interpolated position, or null when no bracketing samples within MAX_POS_GAP. */
export function positionAt(
  pos: PosSample[],
  t: number,
): { x: number; y: number; interpolated: boolean } | null {
  const i = lowerIdx(pos, t);
  if (i < 0) return null;
  const a = pos[i]!,
    b = pos[i + 1]!;
  if (!b) return t - a.t <= 0.5 ? { x: a.x, y: a.y, interpolated: false } : null;
  const gap = b.t - a.t;
  if (gap > MAX_POS_GAP) return t - a.t <= 0.5 ? { x: a.x, y: a.y, interpolated: false } : null;
  const f = gap > 0 ? (t - a.t) / gap : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, interpolated: true };
}

/** Last telemetry sample (no interpolation), null if stale. */
export function telemetryAt(tel: TelSample[], t: number): { s: TelSample; idx: number } | null {
  const i = lowerIdx(tel, t);
  if (i < 0) return null;
  if (t - tel[i]!.t > MAX_TEL_STALE) return null;
  return { s: tel[i]!, idx: i };
}

export function distanceAt(lap: LapData, t: number): number | null {
  const i = lowerIdx(lap.tel, t);
  if (i < 0 || !lap.tel[i + 1]!) return null;
  const a = lap.tel[i]!,
    b = lap.tel[i + 1]!;
  if (b.t - a.t > 1) return null;
  const f = (t - a.t) / (b.t - a.t || 1);
  return lap.dist[i]! + (lap.dist[i + 1]! - lap.dist[i]!) * f;
}

/** Time at which `lap` covered distance d (from integrated speed), null if not reached. */
export function timeAtDistance(lap: LapData, d: number): number | null {
  const ds = lap.dist;
  if (!ds.length || d > ds[ds.length - 1]!) return null;
  let lo = 0,
    hi = ds.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ds[m]! < d) lo = m + 1;
    else hi = m;
  }
  if (lo === 0) return lap.tel[0]!.t;
  const a = lo - 1,
    f = (d - ds[a]!) / (ds[lo]! - ds[a]! || 1);
  return lap.tel[a]!.t + (lap.tel[lo]!.t - lap.tel[a]!.t) * f;
}

/**
 * Estimated gap of B vs A at A's elapsed time t, at equal distance from lap start.
 * Distances are rebased at t=0 so both laps start from 0m. Positive = B behind.
 */
export function estimatedDelta(a: LapData, b: LapData, t: number): number | null {
  const a0 = distanceAt(a, 0),
    b0 = distanceAt(b, 0);
  const da = distanceAt(a, t);
  if (a0 === null || b0 === null || da === null) return null;
  const tb = timeAtDistance(b, da - a0 + b0);
  return tb === null ? null : tb - t;
}

export function formatLapTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(3).padStart(6, "0")}` : r.toFixed(3);
}

export function teamColor(hex: string | null | undefined, fallback: string) {
  return hex && /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : fallback;
}

const FALLBACKS = ["#e10600", "#38bdf8", "#facc15", "#a3e635"];
function lighten(hex: string, f = 0.5) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * f);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}
function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function close(a: string, b: string) {
  const x = rgb(a),
    y = rgb(b);
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!) < 60;
}
/** Team colour, made distinct from earlier slots by lightening (or palette fallback). */
export function distinctColors(teamHexes: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  teamHexes.forEach((h, i) => {
    let c = teamColor(h, FALLBACKS[i]!);
    for (const f of [0.45, 0.7, -1]) {
      if (!out.some((o) => close(o, c))) break;
      c =
        f < 0
          ? (FALLBACKS.find((p) => !out.some((o) => close(o, p))) ?? FALLBACKS[i]!)
          : lighten(teamColor(h, FALLBACKS[i]!), f);
    }
    out.push(c);
  });
  return out;
}
