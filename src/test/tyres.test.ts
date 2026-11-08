import { describe, expect, it } from "vitest";
import { parseArchive } from "@/lib/history";
import { tyreInfo, withTyres } from "@/lib/tyres";
import type { Lap, Stint } from "@/lib/openf1";

const stint = (over: Partial<Stint>): Stint => ({
  driver_number: 1,
  lap_start: 1,
  lap_end: 10,
  stint_number: 1,
  compound: "MEDIUM",
  tyre_age_at_start: 0,
  ...over,
});
const lap = (over: Partial<Lap>): Lap => ({
  driver_number: 1,
  lap_number: 1,
  date_start: "2024-09-01T14:00:00Z",
  lap_duration: 80,
  is_pit_out_lap: false,
  ...over,
});

describe("tyreInfo", () => {
  it("maps the F1 compounds to Italian labels and standard colours", () => {
    expect(tyreInfo("SOFT")).toEqual({ label: "morbido", color: "#e8002d" });
    expect(tyreInfo("MEDIUM")?.label).toBe("medio");
    expect(tyreInfo("HARD")?.label).toBe("duro");
    expect(tyreInfo("INTERMEDIATE")?.label).toBe("intermedio");
    expect(tyreInfo("WET")?.label).toBe("bagnato");
  });
  it("treats unknown markers as no data and keeps other feeds readable", () => {
    expect(tyreInfo(null)).toBeNull();
    expect(tyreInfo(undefined)).toBeNull();
    expect(tyreInfo("unknown")).toBeNull();
    expect(tyreInfo("TEST_UNKNOWN")).toBeNull();
    expect(tyreInfo("0")).toBeNull();
    expect(tyreInfo("c3")).toEqual({ label: "c3", color: "#9aa0a6" });
  });
});

describe("withTyres", () => {
  const stints: Stint[] = [
    stint({
      driver_number: 1,
      lap_start: 1,
      lap_end: 12,
      compound: "MEDIUM",
      tyre_age_at_start: 0,
    }),
    stint({
      driver_number: 1,
      lap_start: 13,
      lap_end: 30,
      stint_number: 2,
      compound: "HARD",
      tyre_age_at_start: 12,
    }),
    stint({ driver_number: 16, lap_start: 5, lap_end: 9, compound: "SOFT", tyre_age_at_start: 3 }),
  ];
  it("joins the compound and the tyre age of the matching stint", () => {
    const out = withTyres(
      [lap({ lap_number: 1 }), lap({ lap_number: 12 }), lap({ lap_number: 20 })],
      stints,
    );
    expect(out[0]?.compound).toBe("MEDIUM");
    expect(out[0]?.tyreAge).toBe(0);
    expect(out[1]?.compound).toBe("MEDIUM");
    expect(out[2]?.compound).toBe("HARD");
    expect(out[2]?.tyreAge).toBe(19); // 12 at stint start + (20 - 13)
  });
  it("keeps unknown compound markers for the display layer and skips bad stints", () => {
    const out = withTyres(
      [lap({ lap_number: 31 }), lap({ driver_number: 16, lap_number: 6 }), lap({ lap_number: 5 })],
      [stint({ compound: "TEST_UNKNOWN", lap_start: 1, lap_end: 10 }), ...stints.slice(2)],
    );
    expect(out[0]?.compound).toBeNull();
    expect(out[1]?.compound).toBe("SOFT");
    expect(out[1]?.tyreAge).toBe(4);
    expect(out[2]?.compound).toBe("TEST_UNKNOWN"); // tyreInfo maps it to n/d
  });
  it("ignores malformed stints and never mutates the input laps", () => {
    const input = [lap({ lap_number: 2 })];
    const out = withTyres(input, [
      stint({ lap_start: Number.NaN, lap_end: 5 }),
      stint({ lap_start: 1, lap_end: 3, tyre_age_at_start: Number.NaN }),
    ]);
    expect(out[0]?.compound).toBe("MEDIUM");
    expect(out[0]?.tyreAge).toBeNull();
    expect(input[0]?.compound).toBeUndefined();
  });
});

describe("archive schema with optional tyre fields", () => {
  const base = {
    format: "f1-telemetry-lab/v1",
    source: "FastF1",
    year: 2021,
    event: "Italian Grand Prix",
    circuit: "Monza",
    session: "Race",
    date: "2021-09-12T14:00:00Z",
    drivers: [
      {
        driver_number: 16,
        name_acronym: "LEC",
        full_name: "Charles Leclerc",
        team_name: "Ferrari",
        team_colour: "ed1c24",
      },
    ],
    laps: [
      {
        driver: 16,
        lapNumber: 12,
        startMs: 0,
        duration: 80.161,
        durationOfficial: true,
        tel: [
          { t: 0, speed: 300, throttle: 100, brake: 0, rpm: 11000, gear: 8, drs: 12, drsOpen: 1 },
        ],
        pos: [],
      },
    ],
  };
  it("accepts archives with tyre fields and keeps them through parsing", () => {
    const a = parseArchive({
      ...base,
      laps: [{ ...base.laps[0], compound: "SOFT", tyreAge: 7 }],
    });
    expect(a.laps[0]?.compound).toBe("SOFT");
    expect(a.laps[0]?.tyreAge).toBe(7);
  });
  it("still accepts archives without tyre fields (backwards compatible)", () => {
    expect(parseArchive(base).laps[0]?.compound).toBeUndefined();
  });
  it("rejects malformed tyre values", () => {
    expect(() => parseArchive({ ...base, laps: [{ ...base.laps[0], tyreAge: -1 }] })).toThrow();
    expect(() =>
      parseArchive({ ...base, laps: [{ ...base.laps[0], compound: "x".repeat(30) }] }),
    ).toThrow();
  });
});
