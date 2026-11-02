import { beforeEach, describe, expect, it } from "vitest";
import { getSource } from "@/services/dataSource";
import { openF1Source } from "@/services/openf1Source";
import { localArchiveSource } from "@/services/localArchiveSource";
import { parseRepoManifest, repoSessionUrl } from "@/services/repoArchives";
import {
  importArchive,
  archiveMeetings,
  archiveSessions,
  archiveDrivers,
  archiveLaps,
} from "@/lib/history";
import { useAppStore } from "@/store/appStore";

// ---- synthetic v1 session (schema-identical to a FastF1 compact export) -----
const N = 40;
function samples(duration: number, speedBase: number) {
  const tel = [],
    pos = [];
  for (let i = 0; i < N; i++) {
    const t = -0.5 + (duration + 1) * (i / (N - 1));
    const frac = i / (N - 1);
    tel.push({
      t,
      speed: Math.round(speedBase + 150 * Math.sin(Math.PI * frac)),
      throttle: Math.round(100 * Math.cos(Math.PI * frac)),
      brake: frac > 0.9 ? 1 : 0,
      rpm: 9000,
      gear: 8,
      drs: frac > 0.2 ? 12 : 1,
      drsOpen: frac > 0.2 ? 1 : 0,
    });
    // closed-loop oval: valid coordinates, never (0,0)
    pos.push({
      t,
      x: 3000 * Math.cos(2 * Math.PI * frac) + 5000,
      y: 2000 * Math.sin(2 * Math.PI * frac) + 5000,
    });
  }
  return { tel, pos };
}
const D = 80;
const session = {
  format: "f1-telemetry-lab/v1",
  source: "FastF1",
  year: 2021,
  event: "Italian Grand Prix",
  circuit: "Monza",
  session: "Race",
  date: "2021-09-12T15:00:00Z",
  drivers: [
    {
      driver_number: 16,
      name_acronym: "LEC",
      full_name: "Charles Leclerc",
      team_name: "Ferrari",
      team_colour: "ed1c24",
    },
    {
      driver_number: 44,
      name_acronym: "HAM",
      full_name: "Lewis Hamilton",
      team_name: "Mercedes",
      team_colour: "00d2be",
    },
  ],
  laps: [
    {
      driver: 16,
      lapNumber: 1,
      startMs: 0,
      duration: D,
      durationOfficial: true,
      ...samples(D, 260),
    },
    {
      driver: 44,
      lapNumber: 1,
      startMs: 0,
      duration: D + 2,
      durationOfficial: true,
      ...samples(D + 2, 255),
    },
  ],
};

beforeEach(() => {
  useAppStore.setState({ source: "local" });
});

describe("data sources", () => {
  it("OpenF1 covers only 2023 and later, descending", () => {
    expect(openF1Source.years()).toEqual([2026, 2025, 2024, 2023]);
  });

  it("local source lists installed archive years", () => {
    importArchive(session);
    expect(localArchiveSource.years()).toContain(2021);
  });

  it("routes the store source to the matching implementation", () => {
    expect(getSource("openf1").id).toBe("openf1");
    expect(getSource("local").id).toBe("local");
    useAppStore.setState({ source: "local" });
    expect(getSource(useAppStore.getState().source).label).toBe("Dati Locali");
  });

  it("reads meetings, sessions, drivers and laps from an installed archive", async () => {
    const { key } = importArchive(session);
    const meetings = await archiveMeetings(2021);
    const meeting = meetings.find((m) => m.meeting_key === key);
    expect(meeting?.meeting_name).toBe("Italian Grand Prix");
    const sessions = await archiveSessions(key);
    expect(sessions.map((s) => s.session_name)).toContain("Race");
    const sessionKey = sessions[0]!.session_key;
    const drivers = await archiveDrivers(sessionKey);
    expect(drivers.map((d) => d.driver_number).sort()).toEqual([16, 44]);
    const laps = await archiveLaps(sessionKey);
    expect(laps.length).toBe(2);
  });

  it("returns LapData with telemetry and positions from the archive", async () => {
    const { key } = importArchive(session);
    const lap = await localArchiveSource.lapData({
      session: key,
      year: 2021,
      d: 16,
      lap: 1,
      info: session.drivers[0]!,
      laps: [],
    });
    expect(lap.driver).toBe(16);
    expect(lap.duration).toBeCloseTo(D, 5);
    expect(lap.tel.length).toBe(N);
    expect(lap.pos.length).toBe(N);
    expect(lap.tel.every((s) => s.speed !== null)).toBe(true);
  });
});

describe("repo manifest", () => {
  it("parses a valid manifest", () => {
    const manifest = parseRepoManifest({
      generated: "2026-01-01T00:00:00Z",
      sessions: [
        {
          year: 2021,
          event: "Italian Grand Prix",
          circuit: "Monza",
          session: "Race",
          date: "2021-09-12T15:00:00Z",
          file: "2021/14-italian-grand-prix-race.json",
          bytes: 1234,
          drivers: 20,
          laps: 20,
        },
      ],
    });
    expect(manifest.sessions[0]?.file).toBe("2021/14-italian-grand-prix-race.json");
  });

  it("rejects entries with a path traversal or wrong shape", () => {
    expect(() =>
      parseRepoManifest({
        sessions: [
          {
            year: 2021,
            event: "x",
            circuit: "x",
            session: "x",
            date: "x",
            file: "../evil.json",
            bytes: 1,
          },
        ],
      }),
    ).toThrow();
    expect(() => parseRepoManifest({ sessions: "tutti" })).toThrow();
  });

  it("builds base-aware download URLs", () => {
    expect(repoSessionUrl("2021/a.json")).toBe("/data/archives/2021/a.json");
  });
});
