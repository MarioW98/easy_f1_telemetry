import type { DataSource } from "./dataSource";
import type { Driver, Lap, Meeting, Session } from "@/lib/openf1";
import type { LapData } from "@/lib/telemetry";
import type { Selection } from "@/components/f1/HistoricalPicker";
import {
  archiveDrivers,
  archiveLapData,
  archiveLaps,
  archiveMeetings,
  archiveSessions,
} from "@/lib/history";
import { availableHistoricalYears } from "@/lib/history";
import { cachedRepoSessions } from "./repoArchives";

/**
 * Local archives: sessions imported from file (ArchiveImporter) plus sessions
 * available for download from the repository manifest (not yet installed).
 * Installed sessions always have negative keys, disjoint from OpenF1 keys.
 */
export const localArchiveSource: DataSource = {
  id: "local",
  label: "Dati Locali",

  years(): number[] {
    const installed = availableHistoricalYears();
    const downloadable = [...new Set(cachedRepoSessions().map((s) => s.year))];
    return [...new Set([...installed, ...downloadable])].sort((a, b) => b - a);
  },

  meetings(year: number): Promise<Meeting[]> {
    return archiveMeetings(year);
  },

  sessions(meetingKey: number): Promise<Session[]> {
    return archiveSessions(meetingKey);
  },

  drivers(sessionKey: number): Promise<Driver[]> {
    return archiveDrivers(sessionKey);
  },

  laps(sessionKey: number): Promise<Lap[]> {
    return archiveLaps(sessionKey);
  },

  lapData(entry: Selection): Promise<LapData> {
    return archiveLapData(entry.session, entry.d, entry.lap);
  },
};
