import { describe, expect, it } from "vitest";
import { dataApi, entryKey, importArchive, parseArchive, sameCircuit } from "@/lib/history";
const meeting = {
  meeting_key: 1,
  meeting_name: "Italian Grand Prix",
  country_name: "Italy",
  circuit_short_name: "Monza",
  date_start: "2024-09-01",
  year: 2024,
  circuit_key: 39,
};
describe("cross-year comparison", () => {
  it("allows the same circuit in different seasons", () => {
    expect(sameCircuit(meeting, { ...meeting, year: 2023, meeting_key: 2 })).toBe(true);
  });
  it("rejects a different circuit even in the same country", () => {
    expect(sameCircuit(meeting, { ...meeting, circuit_short_name: "Imola", circuit_key: 6 })).toBe(
      false,
    );
  });
  it("keeps the same driver and lap distinct across sessions", () => {
    expect(entryKey({ session: 1, d: 1, lap: 10 })).not.toBe(
      entryKey({ session: 2, d: 1, lap: 10 }),
    );
  });
});
const archive = {
  format: "f1-telemetry-lab/v1",
  source: "FastF1",
  year: 2022,
  event: "Italian Grand Prix",
  circuit: "Monza",
  session: "Qualifying",
  date: "2022-09-10T14:00:00Z",
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
describe("historical archive", () => {
  it("accepts measured telemetry from 2018 through 2022", () => {
    expect(parseArchive({ ...archive, year: 2018 }).year).toBe(2018);
    expect(parseArchive(archive).laps[0]?.duration).toBe(80.161);
  });
  it("does not pretend pre-2018 telemetry is available", () => {
    expect(() => parseArchive({ ...archive, year: 2017 })).toThrow();
  });
  it("rejects timing-only data without telemetry", () => {
    expect(() => parseArchive({ ...archive, laps: [{ ...archive.laps[0], tel: [] }] })).toThrow();
  });
  it("rejects telemetry entirely outside the lap", () => {
    expect(() =>
      parseArchive({
        ...archive,
        laps: [{ ...archive.laps[0], tel: [{ ...archive.laps[0]?.tel[0], t: -1 }] }],
      }),
    ).toThrow();
  });
  it("matches imported Monza to the OpenF1 circuit", async () => {
    const { key } = importArchive(archive);
    const imported = (await dataApi.meetings(2022)).find((m) => m.meeting_key === key);
    expect(imported && sameCircuit(meeting, imported)).toBe(true);
  });
  it("reads replacement samples after reimporting the same archive", async () => {
    const { key } = importArchive(archive);
    const replacement = {
      ...archive,
      laps: [{ ...archive.laps[0], tel: [{ ...archive.laps[0]?.tel[0], speed: 250 }] }],
    };
    expect(importArchive(replacement).key).toBe(key);
    expect((await dataApi.lapData(key, 16, 12, [])).tel[0]?.speed).toBe(250);
  });
});
