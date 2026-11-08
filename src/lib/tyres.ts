// Tyre helpers: map a stint/compound to a display label + colour, and join
// OpenF1 /stints rows onto the per-lap records. Archives carry the same
// optional per-lap fields (compound, tyreAge) so the UI needs no source split.
import type { Lap, Stint } from "./openf1";

const COMPOUNDS: Record<string, { label: string; color: string }> = {
  SOFT: { label: "morbido", color: "#e8002d" },
  MEDIUM: { label: "medio", color: "#ffd12e" },
  HARD: { label: "duro", color: "#e8e8e8" },
  INTERMEDIATE: { label: "intermedio", color: "#00c46a" },
  WET: { label: "bagnato", color: "#478ef7" },
};
const UNKNOWNS = new Set(["", "0", "UNKNOWN", "TEST_UNKNOWN"]);

/** Display info for a compound value, or null when the compound is unknown. */
export function tyreInfo(compound: string | null | undefined) {
  const c = compound?.trim().toUpperCase() ?? "";
  if (UNKNOWNS.has(c)) return null;
  return COMPOUNDS[c] ?? { label: c.toLowerCase(), color: "#9aa0a6" }; // e.g. "C3" from future feeds
}

/** Merge stints into laps: adds `compound` and `tyreAge` (laps) per lap, in place of nothing. */
export function withTyres(laps: Lap[], stints: Stint[]): Lap[] {
  const byDriver = new Map<number, Stint[]>();
  for (const s of stints) {
    if (typeof s?.driver_number !== "number") continue;
    const list = byDriver.get(s.driver_number) ?? [];
    list.push(s);
    byDriver.set(s.driver_number, list);
  }
  return laps.map((lap) => {
    const stint = byDriver
      .get(lap.driver_number)
      ?.find(
        (s) =>
          Number.isFinite(s.lap_start) &&
          Number.isFinite(s.lap_end) &&
          lap.lap_number >= s.lap_start &&
          lap.lap_number <= s.lap_end,
      );
    const compound = stint?.compound ?? null;
    const age0 = stint?.tyre_age_at_start;
    const start0 = stint?.lap_start;
    const age =
      typeof age0 === "number" &&
      Number.isFinite(age0) &&
      typeof start0 === "number" &&
      Number.isFinite(start0)
        ? age0 + (lap.lap_number - start0)
        : null;
    return { ...lap, compound, tyreAge: age };
  });
}
