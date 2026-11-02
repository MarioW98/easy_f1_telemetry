import type { Selection } from "@/components/f1/HistoricalPicker";
import type { Driver, Lap, Meeting, Session } from "@/lib/openf1";
import type { LapData } from "@/lib/telemetry";
import type { SourceKind } from "@/store/appStore";
import { localArchiveSource } from "./localArchiveSource";
import { openF1Source } from "./openf1Source";

/**
 * Data source abstraction (see the implementation plan): each source knows how
 * to list years/meetings/sessions/drivers/laps and fetch one lap of telemetry.
 * `src/hooks/useTelemetryData.ts` picks the implementation from the store.
 */
export interface DataSource {
  readonly id: SourceKind;
  readonly label: string;
  /** Selectable years for this source (descending). */
  years(): number[];
  meetings(year: number): Promise<Meeting[]>;
  sessions(meetingKey: number): Promise<Session[]>;
  drivers(sessionKey: number): Promise<Driver[]>;
  laps(sessionKey: number): Promise<Lap[]>;
  lapData(entry: Selection): Promise<LapData>;
}

/** The implementation matching the data source currently selected in the store. */
export function getSource(id: SourceKind): DataSource {
  return id === "local" ? localArchiveSource : openF1Source;
}
