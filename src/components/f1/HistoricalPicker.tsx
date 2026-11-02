import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSource } from "@/services/dataSource";
import { sameCircuit } from "@/lib/history";
import type { Driver, Lap, Meeting } from "@/lib/openf1";
import { formatLapTime } from "@/lib/telemetry";
import { useAppStore } from "@/store/appStore";

export type Selection = {
  session: number;
  year: number;
  d: number;
  lap: number;
  info: Driver;
  laps: Lap[];
};
export function HistoricalPicker({
  label,
  reference,
  initialSession,
  initialName,
  years,
  onSelect,
  onRemove,
  revision,
}: {
  label: string;
  reference: Meeting;
  initialSession: number;
  initialName: string;
  years: number[];
  onSelect: (value: Selection | null) => void;
  onRemove?: (() => void) | undefined;
  revision: number;
}) {
  const source = useAppStore((s) => s.source);
  const svc = getSource(source);
  const [year, setYear] = useState(reference.year);
  const [session, setSession] = useState<number | null>(initialSession);
  const [driver, setDriver] = useState<number | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const mq = useQuery({
    queryKey: ["meetings", source, year, revision],
    queryFn: () => svc.meetings(year),
    staleTime: Infinity,
    retry: false,
  });
  const meetings = (mq.data ?? []).filter(
    (m) => sameCircuit(reference, m) && Date.parse(m.date_start) < Date.now(),
  );
  const [event, setEvent] = useState<number | null>(reference.meeting_key);
  useEffect(() => {
    setEvent(
      meetings.find((m) => m.meeting_name === reference.meeting_name)?.meeting_key ??
        meetings[0]?.meeting_key ??
        null,
    );
  }, [mq.data, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const sq = useQuery({
    queryKey: ["sessions", source, event, revision],
    queryFn: () => (event === null ? Promise.resolve([]) : svc.sessions(event)),
    enabled: event !== null,
    staleTime: Infinity,
    retry: false,
  });
  const sessions = (sq.data ?? []).filter(
    (s) => !s.is_cancelled && Date.parse(s.date_end) < Date.now(),
  );
  useEffect(() => {
    setDriver(null);
    setLap(null);
    onSelect(null);
    setSession(
      sessions.find((s) => s.session_name === initialName)?.session_key ??
        sessions[0]?.session_key ??
        null,
    );
  }, [sq.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const dq = useQuery({
    queryKey: ["drivers", source, session, revision],
    queryFn: () => (session === null ? Promise.resolve([]) : svc.drivers(session)),
    enabled: session !== null,
    staleTime: Infinity,
    retry: false,
  });
  const lq = useQuery({
    queryKey: ["laps", source, session, revision],
    queryFn: () => (session === null ? Promise.resolve([]) : svc.laps(session)),
    enabled: session !== null,
    staleTime: Infinity,
    retry: false,
  });
  const drivers = useMemo(
    () =>
      [...new Map((dq.data ?? []).map((d) => [d.driver_number, d])).values()].sort(
        (a, b) => a.driver_number - b.driver_number,
      ),
    [dq.data],
  );
  const laps = (lq.data ?? [])
    .filter((l) => l.driver_number === driver && l.date_start)
    .sort((a, b) => a.lap_number - b.lap_number);
  const best = laps
    .filter((l) => l.lap_duration !== null)
    .sort((a, b) => (a.lap_duration ?? Infinity) - (b.lap_duration ?? Infinity))[0];
  useEffect(() => {
    if (driver !== null && lap === null && best) setLap(best.lap_number);
  }, [driver, lap, best]);
  const info = drivers.find((d) => d.driver_number === driver);
  useEffect(() => {
    onSelect(
      session !== null &&
        driver !== null &&
        lap !== null &&
        info &&
        lq.data &&
        laps.some((l) => l.lap_number === lap)
        ? { session, year, d: driver, lap, info, laps: lq.data }
        : null,
    );
  }, [session, year, driver, lap, info, lq.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => {
    setDriver(null);
    setLap(null);
    onSelect(null);
  };
  const error = mq.error ?? sq.error ?? dq.error ?? lq.error;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:max-w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="f1-label">{label}</span>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={`Rimuovi ${label}`}
            onClick={onRemove}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-1 sm:grid-cols-[80px_140px]">
        <select
          className="f1-select"
          aria-label={`Anno ${label}`}
          value={year}
          onChange={(e) => {
            setYear(+e.target.value);
            setEvent(null);
            setSession(null);
            reset();
          }}
        >
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select
          className="f1-select"
          aria-label={`Sessione ${label}`}
          value={session ?? ""}
          disabled={!sessions.length}
          onChange={(e) => {
            setSession(e.target.value ? +e.target.value : null);
            reset();
          }}
        >
          <option value="">
            {mq.isFetching || sq.isFetching ? "Caricamento…" : "Non disponibile"}
          </option>
          {sessions.map((s) => (
            <option key={s.session_key} value={s.session_key}>
              {s.session_name}
            </option>
          ))}
        </select>
      </div>
      {meetings.length > 1 && (
        <select
          className="f1-select"
          aria-label={`Evento ${label}`}
          value={event ?? ""}
          onChange={(e) => {
            setEvent(+e.target.value);
            setSession(null);
            reset();
          }}
        >
          {meetings.map((m) => (
            <option key={m.meeting_key} value={m.meeting_key}>
              {m.meeting_name}
            </option>
          ))}
        </select>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-1 sm:grid-cols-[minmax(0,140px)_80px]">
        <select
          className="f1-select"
          aria-label={label}
          value={driver ?? ""}
          disabled={!drivers.length || session === null}
          onChange={(e) => {
            setDriver(e.target.value ? +e.target.value : null);
            setLap(null);
            onSelect(null);
          }}
        >
          <option value="">Pilota</option>
          {drivers.map((d) => (
            <option key={d.driver_number} value={d.driver_number}>
              {d.driver_number} {d.name_acronym} · {d.team_name}
            </option>
          ))}
        </select>
        <select
          className="f1-select"
          aria-label={`Giro ${label}`}
          value={lap ?? ""}
          disabled={!laps.length}
          onChange={(e) => setLap(e.target.value ? +e.target.value : null)}
        >
          <option value="">Giro</option>
          {laps.map((l) => (
            <option key={l.lap_number} value={l.lap_number}>
              G{l.lap_number} · {formatLapTime(l.lap_duration)}
              {l.lap_number === best?.lap_number ? " ★" : ""}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-destructive">
          {error instanceof Error ? error.message : "Errore dati"}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              mq.refetch();
              sq.refetch();
              dq.refetch();
              lq.refetch();
            }}
          >
            Riprova
          </Button>
        </span>
      )}
      {!mq.isFetching && !meetings.length && (
        <span className="max-w-xs text-xs text-warning">
          {year < 2023
            ? "Circuito assente dagli archivi locali di quest'anno."
            : "Circuito non disponibile in questa annata."}
        </span>
      )}
    </div>
  );
}
