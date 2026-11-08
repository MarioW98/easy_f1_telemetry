import type { DataSource } from "./dataSource";
import { CURRENT_YEAR } from "./years";
import type { Driver, Lap, Meeting, Session, Stint } from "@/lib/openf1";
import type { LapData } from "@/lib/telemetry";
import type { Selection } from "@/components/f1/HistoricalPicker";
import { api } from "@/lib/openf1";
import { buildLapData, lapWindow } from "@/lib/telemetry";
import { withTyres } from "@/lib/tyres";

const MARGIN_S = 1.5; // extra fetched around lap boundaries, same as OpenF1 pipeline

/** OpenF1 public API (2023-today): no auth, free tier ≈ 3 req/s (client queues). */
export const openF1Source: DataSource = {
  id: "openf1",
  label: "OpenF1 Live",

  years(): number[] {
    return Array.from({ length: CURRENT_YEAR - 2023 + 1 }, (_, i) => CURRENT_YEAR - i);
  },

  meetings(year: number): Promise<Meeting[]> {
    return api.meetings(year);
  },

  sessions(meetingKey: number): Promise<Session[]> {
    return api.sessions(meetingKey);
  },

  drivers(sessionKey: number): Promise<Driver[]> {
    return api.drivers(sessionKey);
  },

  async laps(sessionKey: number): Promise<Lap[]> {
    // Tyre data must never break the lap list: if /stints fails, laps load without compound.
    const [laps, stints] = await Promise.all([
      api.laps(sessionKey),
      api.stints(sessionKey).catch(() => [] as Stint[]),
    ]);
    return withTyres(laps, stints);
  },

  async lapData(entry: Selection): Promise<LapData> {
    const lap = entry.laps.find((l) => l.driver_number === entry.d && l.lap_number === entry.lap);
    const win = lap ? lapWindow(lap, entry.laps) : null;
    if (!win) throw new Error("Il giro non ha un intervallo temporale definito.");
    const from = new Date(win.startMs - MARGIN_S * 1000).toISOString();
    const to = new Date(win.endMs + MARGIN_S * 1000).toISOString();
    const [car, loc] = await Promise.all([
      api.carData(entry.session, entry.d, from, to),
      api.location(entry.session, entry.d, from, to),
    ]);
    const data = buildLapData(entry.d, entry.lap, win, car, loc);
    if (lap) {
      data.compound = lap.compound ?? null;
      data.tyreAge = lap.tyreAge ?? null;
    }
    return data;
  },
};
