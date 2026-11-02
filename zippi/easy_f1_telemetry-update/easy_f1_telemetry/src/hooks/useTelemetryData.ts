import { useQueries, useQuery } from "@tanstack/react-query";
import { getSource } from "@/services/dataSource";
import type { Selection } from "@/components/f1/HistoricalPicker";
import type { LapData } from "@/lib/telemetry";
import { useAppStore } from "@/store/appStore";

/**
 * Source-aware react-query bindings: every key includes the active source, so
 * switching "Dati Locali" ⇄ "OpenF1" never reuses another source's cache.
 */
export function useTelemetryData() {
  const source = useAppStore((s) => s.source);
  const revision = useAppStore((s) => s.revision);
  const year = useAppStore((s) => s.year);
  const meetingKey = useAppStore((s) => s.meetingKey);
  const sessionKey = useAppStore((s) => s.sessionKey);

  const svc = getSource(source);

  const meetingsQ = useQuery({
    queryKey: ["meetings", source, year, revision],
    queryFn: () => (year === null ? Promise.resolve([]) : svc.meetings(year)),
    enabled: year !== null,
    retry: false,
    staleTime: Infinity,
  });
  const sessionsQ = useQuery({
    queryKey: ["sessions", source, meetingKey, revision],
    queryFn: () => (meetingKey === null ? Promise.resolve([]) : svc.sessions(meetingKey)),
    enabled: meetingKey !== null,
    retry: false,
    staleTime: Infinity,
  });
  const driversQ = useQuery({
    queryKey: ["drivers", source, sessionKey, revision],
    queryFn: () => (sessionKey === null ? Promise.resolve([]) : svc.drivers(sessionKey)),
    enabled: sessionKey !== null,
    retry: false,
    staleTime: Infinity,
  });
  const lapsQ = useQuery({
    queryKey: ["laps", source, sessionKey, revision],
    queryFn: () => (sessionKey === null ? Promise.resolve([]) : svc.laps(sessionKey)),
    enabled: sessionKey !== null,
    retry: false,
    staleTime: Infinity,
  });

  return { svc, meetingsQ, sessionsQ, driversQ, lapsQ };
}

/** One cached query per (session, driver, lap): loaded laps are reused. */
export function useLapQueries(entries: Selection[]) {
  const source = useAppStore((s) => s.source);
  const revision = useAppStore((s) => s.revision);
  const svc = getSource(source);
  return useQueries({
    queries: entries.map((e) => ({
      queryKey: ["lapdata", source, e.session, e.d, e.lap, e.session < 0 ? revision : 0],
      retry: false,
      staleTime: Infinity,
      queryFn: (): Promise<LapData> => svc.lapData(e),
    })),
  });
}
