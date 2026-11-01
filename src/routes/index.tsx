import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ChevronLeft, ChevronRight, Loader2, Pause, Play, RefreshCw, RotateCcw, Eye, EyeOff, Plus, X, Maximize2, Minimize2,
} from "lucide-react";
import { ApiError, type Driver, type Lap } from "@/lib/openf1";
import {
  distinctColors, estimatedDelta, formatLapTime, telemetryAt, type LapData,
} from "@/lib/telemetry";
import { TrackMap } from "@/components/f1/TrackMap";
import { SERIES, TelemetryCharts, type SeriesKey } from "@/components/f1/TelemetryCharts";
import { usePlayback } from "@/hooks/use-playback";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { HistoricalPicker, type Selection } from "@/components/f1/HistoricalPicker";
import { dataApi, entryKey, availableHistoricalYears } from "@/lib/history";
import { ArchiveImporter } from "@/components/f1/ArchiveImporter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "F1 Telemetry Lab — Analisi telemetria storica Formula 1" },
      { name: "description", content: "Confronta fino a quattro giri di Formula 1 sullo stesso circuito, anche di annate differenti: OpenF1 dal 2023 e archivi FastF1 2018–2022." },
      { property: "og:title", content: "F1 Telemetry Lab" },
      { property: "og:description", content: "Telemetria reale F1 con riproduzione sincronizzata e confronto tra piloti e annate, inclusi archivi FastF1 2018–2022." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const CURRENT_YEAR = 2026;
const YEARS = Array.from({ length: CURRENT_YEAR - 2018 + 1 }, (_, i) => CURRENT_YEAR - i);
const MAX_DRIVERS = 4;
const DASHES = [undefined, "6 3", "2 2", "9 3 2 3"];
const DASH_LABEL = ["continua", "tratteggiata", "punteggiata", "tratto-punto"];
const MAP_MIN = 140;
const TEL_MIN = 200;

function errMsg(e: unknown) {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Errore sconosciuto";
}

function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const rl = error instanceof ApiError && error.kind === "rate_limit";
  return (
    <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span>{rl ? "Limite API raggiunto. " : ""}{errMsg(error)}</span>
      <Button variant="ghost" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 hover:bg-accent">
        <RefreshCw className="h-3 w-3" /> Riprova
      </Button>
    </div>
  );
}

type Slot = { id: number; d: number | null; lap: number | null };
type Entry = Selection;
type Request = { entries: Entry[] };
let slotSeq = 1;

function Dashboard() {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(0);
  const [selections, setSelections] = useState<Record<number, Selection | null>>({});
  const historicalYears = availableHistoricalYears();
  const selectableYears = YEARS.filter((y) => y >= 2023 || historicalYears.includes(y));
  const [year, setYear] = useState(2024);
  const [meeting, setMeeting] = useState<number | null>(null);
  const [session, setSession] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[]>([{ id: 0, d: null, lap: null }]);
  const [req, setReq] = useState<Request | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ speed: true, throttle: true, brake: true, rpm: true, gear: true, drsOpen: true });
  const [focus, setFocus] = useState<SeriesKey | null>(null);
  const isMobile = useIsMobile();

  const meetingsQ = useQuery({ queryKey: ["meetings", year, revision], queryFn: () => dataApi.meetings(year), retry: false, staleTime: Infinity });
  const sessionsQ = useQuery({ queryKey: ["sessions", meeting, revision], queryFn: () => meeting === null ? Promise.resolve([]) : dataApi.sessions(meeting), enabled: meeting !== null, retry: false, staleTime: Infinity });
  const driversQ = useQuery({ queryKey: ["drivers", session, revision], queryFn: () => session === null ? Promise.resolve([]) : dataApi.drivers(session), enabled: session !== null, retry: false, staleTime: Infinity });
  const lapsQ = useQuery({ queryKey: ["laps", session, revision], queryFn: () => session === null ? Promise.resolve([]) : dataApi.laps(session), enabled: session !== null, retry: false, staleTime: Infinity });

  const now = Date.now();
  const meetings = useMemo(() => (meetingsQ.data ?? []).filter((m) => Date.parse(m.date_start) < now).sort((a, b) => a.date_start.localeCompare(b.date_start)), [meetingsQ.data, now]);
  const sessions = useMemo(() => (sessionsQ.data ?? []).filter((s) => !s.is_cancelled && Date.parse(s.date_end) < now).sort((a, b) => a.date_start.localeCompare(b.date_start)), [sessionsQ.data, now]);
  const drivers = useMemo(() => {
    const m = new Map<number, Driver>();
    for (const d of driversQ.data ?? []) m.set(d.driver_number, d);
    return [...m.values()].sort((a, b) => a.driver_number - b.driver_number);
  }, [driversQ.data]);
  const laps = lapsQ.data ?? [];
  const referenceMeeting = meetings.find((m) => m.meeting_key === meeting);
  const sessionName = sessions.find((s) => s.session_key === session)?.session_name ?? "";
  useEffect(() => { setMeeting(null); }, [year]);
  useEffect(() => { setSession(null); }, [meeting]);
  useEffect(() => { setSlots([{ id: slotSeq++, d: null, lap: null }]); setSelections({}); setReq(null); }, [session]);

  // One cached query per (session, driver, lap): already loaded laps are reused, only new ones are fetched.
  const lapQs = useQueries({
    queries: (req?.entries ?? []).map((e) => ({
      queryKey: ["lapdata", e.session, e.d, e.lap, e.session < 0 ? revision : 0],
      retry: false,
      staleTime: Infinity,
      queryFn: (): Promise<LapData> => dataApi.lapData(e.session, e.d, e.lap, e.laps),
    })),
  });
  const fetching = lapQs.some((q) => q.isFetching);
  const lapErrors = lapQs.map((q, i) => (q.error ? { q, e: req?.entries[i] } : null)).filter(Boolean) as { q: (typeof lapQs)[number]; e: Entry }[];
  const loadedKey = lapQs.map((q) => q.dataUpdatedAt).join(",");
  const LAPS = useMemo(() => lapQs.map((q) => q.data ?? null), [loadedKey, req, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const dInfo = (e: Entry) => e.info;
  const colors = useMemo(() => distinctColors((req?.entries ?? []).map((e) => dInfo(e)?.team_colour)), [req, drivers]); // eslint-disable-line react-hooks/exhaustive-deps

  // all loaded entries, with identity, regardless of visibility
  const loaded = useMemo(() => (req?.entries ?? []).map((e, i) => {
    const lap = LAPS[i];
    if (!lap) return null;
    const info = dInfo(e);
    return { key: entryKey(e), idx: i, lap, color: colors[i] ?? "var(--color-primary)", dash: DASHES[i], label: `${info.name_acronym} ${e.year}`, info, year: e.year };
  }).filter(Boolean) as { key: string; idx: number; lap: LapData; color: string; dash: string | undefined; label: string; info: Driver | undefined; year: number }[], [req, LAPS, colors, drivers]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => loaded.filter((l) => !hidden.has(l.key)), [loaded, hidden]);

  const duration = Math.max(0, ...loaded.map((l) => l.lap.duration));
  const pb = usePlayback(duration);
  useEffect(() => { pb.reset(); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartDrivers = useMemo(() => shown.filter((l) => l.lap.tel.length).map((l) => ({ lap: l.lap, color: l.color, label: l.label, dash: l.dash })), [shown]);
  const mapDrivers = useMemo(() => shown.map((l) => ({ lap: l.lap, color: l.color, label: l.label, number: l.lap.driver })), [shown]);

  const t = pb.time;
  const ref0 = loaded[0] ?? null;
  const curRef = ref0 ? telemetryAt(ref0.lap.tel, t) : null;
  const stepSample = (dir: 1 | -1) => {
    if (!ref0) return;
    pb.setPlaying(false);
    const inLap = ref0.lap.tel.filter((s) => s.t >= 0 && s.t <= duration);
    const next = dir > 0 ? inLap.find((s) => s.t > t + 1e-6) : [...inLap].reverse().find((s) => s.t < t - 1e-6);
    pb.seek(next ? next.t : dir > 0 ? duration : 0);
  };

  // ---- resizable split between circuit and telemetry ----
  const colRef = useRef<HTMLDivElement>(null);
  const telRef = useRef<HTMLDivElement>(null);
  const [colH, setColH] = useState(800);
  const [telH, setTelH] = useState(400);
  const [mapH, setMapH] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (colRef.current) setColH(colRef.current.clientHeight);
      if (telRef.current) setTelH(telRef.current.clientHeight);
    });
    if (colRef.current) ro.observe(colRef.current);
    if (telRef.current) ro.observe(telRef.current);
    return () => ro.disconnect();
  });
  const PLAYBAR = 48;
  const mapMax = Math.max(MAP_MIN, colH - PLAYBAR - TEL_MIN);
  const mapHeight = isMobile ? (expanded ? 160 : 300) : expanded ? MAP_MIN : Math.min(mapMax, Math.max(MAP_MIN, mapH ?? Math.round(colH * 0.48)));
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = mapHeight;
    setExpanded(false);
    const move = (ev: PointerEvent) => setMapH(Math.min(mapMax, Math.max(MAP_MIN, h0 + ev.clientY - y0)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const baseChartsH = SERIES.filter((s) => visible[s.key]).reduce((a, s) => a + s.h + 1, 0) + 20;
  const scale = isMobile ? 1 : Math.min(4, Math.max(1, (telH - 40) / baseChartsH));

  const loading = meetingsQ.isFetching || sessionsQ.isFetching || driversQ.isFetching || lapsQ.isFetching || fetching;
  const filled = slots.flatMap((s) => selections[s.id] ? [selections[s.id]] : []).filter((s): s is Selection => s !== null && s !== undefined);
  const canLoad = session !== null && filled.length > 0;
  const hasData = loaded.some((l) => l.lap.tel.length || l.lap.pos.length);

  return (
    <div className="flex min-h-screen flex-col md:h-screen md:min-h-[640px] bg-background text-foreground">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="mr-3 flex w-full items-center gap-2 sm:w-auto">
          <div className="h-4 w-1 bg-primary" />
          <h1 className="text-sm font-bold uppercase tracking-[0.15em]">F1 Telemetry Lab</h1>
        </div>
        <select aria-label="Stagione" className="f1-select" value={year} onChange={(e) => setYear(+e.target.value)}>
          {selectableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label="Gran Premio" className="f1-select min-w-0 flex-1 sm:w-56 sm:flex-none" value={meeting ?? ""} disabled={!meetings.length} onChange={(e) => setMeeting(e.target.value ? +e.target.value : null)}>
          <option value="">{meetingsQ.isFetching ? "Caricamento eventi…" : meetings.length ? "Seleziona evento" : "Nessun evento disponibile"}</option>
          {meetings.map((m) => <option key={m.meeting_key} value={m.meeting_key}>{m.meeting_name} · {m.circuit_short_name}</option>)}
        </select>
        <select aria-label="Sessione" className="f1-select w-full sm:w-40" value={session ?? ""} disabled={!sessions.length} onChange={(e) => setSession(e.target.value ? +e.target.value : null)}>
          <option value="">{sessionsQ.isFetching ? "Caricamento…" : meeting ? (sessions.length ? "Seleziona sessione" : "Nessuna sessione") : "Sessione"}</option>
          {sessions.map((s) => <option key={s.session_key} value={s.session_key}>{s.session_name}</option>)}
        </select>
        <div className="flex items-center gap-2 font-mono sm:ml-auto text-[11px] text-muted-foreground">
          {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> caricamento dati…</> : <><Activity className="h-3.5 w-3.5 text-success" /> pronto</>}
        </div>
        <ArchiveImporter onImported={(summary) => {
          setReq(null); setSelections({}); setSession(null); setMeeting(null);
          queryClient.removeQueries({ predicate: (q) => ["lapdata", "drivers", "laps", "sessions", "meetings"].includes(String(q.queryKey[0])) && typeof q.queryKey[1] === "number" && q.queryKey[1] < 2023 });
          setRevision((r) => r + 1);
          setYear(Math.max(...summary.years));
        }} />
        {[meetingsQ, sessionsQ, driversQ, lapsQ].map((q, i) => q.error ? <ErrorBox key={i} error={q.error} onRetry={() => q.refetch()} /> : null)}
      </header>

      {/* Driver slots */}
      <section className="flex flex-wrap items-end gap-2 border-b border-border px-3 py-2">
        {referenceMeeting && session !== null && slots.map((s, i) => (
          <HistoricalPicker key={`${session}-${s.id}`} label={`Pilota ${i + 1}${i === 0 ? " (riferimento)" : ""}`}
            reference={referenceMeeting} initialSession={session} initialName={sessionName} years={selectableYears} revision={revision}
            onSelect={(value) => setSelections((old) => ({ ...old, [s.id]: value }))}
            onRemove={slots.length > 1 ? () => { setSlots((old) => old.filter((o) => o.id !== s.id)); setSelections((old) => { const next = { ...old }; delete next[s.id]; return next; }); } : undefined} />
        ))}
        {slots.length < MAX_DRIVERS && (
          <Button variant="ghost" disabled={!drivers.length} onClick={() => setSlots((ss) => [...ss, { id: slotSeq++, d: null, lap: null }])}
            className="inline-flex h-9 items-center gap-1 rounded border border-dashed sm:h-[1.875rem] border-border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Aggiungi pilota
          </Button>
        )}
        <Button variant="ghost"
          disabled={!canLoad || fetching}
          onClick={() => {
            const next: Request = { entries: filled };
            if (JSON.stringify(next) === JSON.stringify(req)) lapErrors.forEach((x) => x.q.refetch()); else setReq(next);
          }}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded bg-primary sm:h-[1.875rem] sm:flex-none px-3 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Carica analisi
        </Button>
        {driversQ.isFetching || lapsQ.isFetching ? <span className="text-xs text-muted-foreground">Caricamento piloti e giri…</span> : null}
        {session && !driversQ.isFetching && !lapsQ.isFetching && (drivers.length === 0 || laps.length === 0) && !driversQ.error && !lapsQ.error ? (
          <span className="text-xs text-warning">Nessun pilota o giro disponibile per questa sessione.</span>
        ) : null}
      </section>

      {loaded.some((l) => l.year !== loaded[0]?.year) && <p className="border-b border-border px-3 py-1 text-xs text-warning">Stesso circuito, annate diverse: configurazione, condizioni e coordinate possono variare. Le posizioni non sono riallineate artificialmente.</p>}
      {/* Interactive legend */}
      {loaded.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
          <span className="f1-label mr-1">Legenda</span>
          {loaded.map((l) => {
            const off = hidden.has(l.key);
            return (
              <Button variant="ghost" key={l.key} title={off ? "Mostra" : "Nascondi temporaneamente"}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(l.key)) n.delete(l.key); else n.add(l.key); return n; })}
                className={`inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs ${off ? "opacity-40" : ""}`}>
                <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={l.color} strokeWidth="2.5" strokeDasharray={l.dash} /></svg>
                <span className="font-mono font-bold" style={{ color: l.color }}>{l.lap.driver}</span>
                <span>{l.info?.full_name ?? l.label} · {l.year}</span>
                <span className="text-muted-foreground">{l.info?.team_name ?? ""} · G{l.lap.lapNumber} · {DASH_LABEL[l.idx]}</span>
                {off ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            );
          })}
        </section>
      )}

      {/* Main */}
      {!req ? (
        <EmptyState text={session ? "Seleziona da 1 a 4 piloti con il rispettivo giro, poi premi «Carica analisi»." : "Seleziona stagione, Gran Premio e sessione per iniziare. OpenF1 dal 2023; archivi FastF1 importabili dal 2018 al 2022."} />
      ) : loaded.length === 0 && fetching ? (
        <EmptyState text="Caricamento telemetria e posizioni dei giri selezionati…" spinner />
      ) : loaded.length === 0 && lapErrors.length ? (
        <div className="flex flex-1 items-center justify-center p-6"><ErrorBox error={lapErrors[0]?.q.error} onRetry={() => lapErrors.forEach((x) => x.q.refetch())} /></div>
      ) : loaded.length && !hasData ? (
        <EmptyState text="Nessun dato di telemetria o posizione per i giri selezionati." warn />
      ) : loaded.length ? (
        <main className="grid flex-1 md:min-h-0 grid-cols-1 gap-2 p-2 xl:grid-cols-[1fr_280px]">
          <div ref={colRef} className="flex min-h-0 min-w-0 flex-col">
            <div className="f1-panel shrink-0 overflow-hidden touch-pan-y transition-[height] duration-150" style={{ height: mapHeight }}>
              <TrackMap drivers={mapDrivers} time={t} />
            </div>
            {/* Drag divider */}
            <div role="separator" aria-orientation="horizontal" aria-label="Ridimensiona circuito / telemetria" title="Trascina per ridimensionare"
              onPointerDown={startDrag} onDoubleClick={() => { setExpanded(false); setMapH(null); }}
              className="group hidden h-3 shrink-0 md:flex cursor-row-resize items-center justify-center">
              <div className="h-1 w-16 rounded-full bg-border group-hover:bg-primary" />
            </div>
            {/* Playback */}
            <div className="f1-panel sticky bottom-0 z-30 mt-2 flex shrink-0 flex-wrap items-center gap-2 px-2 py-1.5 shadow-lg md:static md:mt-0 md:shadow-none">
              <IconBtn label="Riavvia" onClick={pb.reset}><RotateCcw className="h-4 w-4" /></IconBtn>
              <IconBtn label="Campione precedente" onClick={() => stepSample(-1)}><ChevronLeft className="h-4 w-4" /></IconBtn>
              <Button variant="ghost" aria-label={pb.playing ? "Pausa" : "Riproduci"} onClick={pb.toggle} className="rounded bg-primary p-2 text-primary-foreground sm:p-1.5 hover:bg-primary/90">
                {pb.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <IconBtn label="Campione successivo" onClick={() => stepSample(1)}><ChevronRight className="h-4 w-4" /></IconBtn>
              <input aria-label="Tempo del giro" type="range" min={0} max={duration} step={0.01} value={t}
                onChange={(e) => pb.seek(+e.target.value)} className="order-first h-6 w-full basis-full accent-primary sm:order-none sm:h-auto sm:min-w-[160px] sm:flex-1 sm:basis-auto" />
              <span className="font-mono text-xs tabular-nums">{t.toFixed(2)} / {duration.toFixed(2)} s</span>
              <div className="flex overflow-hidden rounded border border-border">
                {[0.25, 0.5, 1, 2].map((r) => (
                  <Button variant="ghost" key={r} onClick={() => pb.setRate(r)}
                    className={`px-2.5 py-1 font-mono text-[11px] sm:px-2 sm:py-0.5 ${pb.rate === r ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                    {r}x
                  </Button>
                ))}
              </div>
              <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                {pb.playing ? "▶ in riproduzione" : "❚❚ in pausa"} · campione {curRef ? curRef.idx + 1 : "—"}/{ref0?.lap.tel.length ?? 0}
              </span>
            </div>
            {/* Telemetry */}
            <div className="f1-panel mt-2 flex flex-col p-2 md:min-h-0 md:flex-1">
              <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1">
                <span className="f1-label mr-2 w-full sm:w-auto">Telemetria · asse X = secondi dall'inizio di ciascun giro</span>
                {SERIES.map((s) => (
                  <Button variant="ghost" key={s.key} onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
                    className={`inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] sm:px-1.5 sm:py-0.5 sm:text-[10px] ${visible[s.key] ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {visible[s.key] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}{s.label}
                  </Button>
                ))}
                <Button variant="ghost" onClick={() => setExpanded((x) => !x)}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-[11px] hover:text-foreground">
                  {expanded ? <><Minimize2 className="h-3 w-3" /> Layout normale</> : <><Maximize2 className="h-3 w-3" /> Espandi telemetria</>}
                </Button>
                {(expanded || mapH !== null || focus) && (
                  <Button variant="ghost" onClick={() => { setExpanded(false); setMapH(null); setFocus(null); }}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                    <RotateCcw className="h-3 w-3" /> Ripristina
                  </Button>
                )}
              </div>
              <div ref={telRef} className="md:min-h-0 md:flex-1 md:overflow-y-auto">
                {chartDrivers.length ? (
                  <TelemetryCharts drivers={chartDrivers} duration={duration} time={t} onSeek={(x) => { pb.setPlaying(false); pb.seek(x); }}
                    visible={visible} scale={scale} focus={focus && visible[focus] ? focus : null} onFocus={setFocus} />
                ) : <p className="p-4 text-muted-foreground">{loaded.length && shown.length === 0 ? "Tutti i piloti sono nascosti: riattivali dalla legenda." : "Nessun campione /car_data per i giri visibili."}</p>}
              </div>
            </div>
          </div>

          {/* Side readouts */}
          <aside className="grid content-start gap-2 sm:grid-cols-2 md:min-h-0 md:overflow-y-auto xl:flex xl:flex-col">
            {lapErrors.map((x, i) => (
              <ErrorBox key={i} error={x.q.error} onRetry={() => x.q.refetch()} />
            ))}
            {fetching && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> caricamento giri aggiuntivi…</div>}
            {loaded.map((l) => (
              <Readout key={l.key} lap={l.lap} t={t} color={l.color} driver={l.info} year={l.year} />
            ))}
            {loaded.length > 1 && ref0 && (
              <div className="f1-panel p-2 sm:col-span-2">
                <div className="f1-label mb-1">Confronto vs {ref0.label} (riferimento)</div>
                <table className="w-full font-mono text-[11px] tabular-nums">
                  <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Pilota</th><th className="text-right font-normal">Giro</th><th className="text-right font-normal">Δ fin.</th><th className="text-right font-normal">Gap ora</th></tr></thead>
                  <tbody>
                    {loaded.map((l) => {
                      const isRef = l === ref0;
                      const fin = isRef ? null : ref0.lap.durationOfficial && l.lap.durationOfficial ? l.lap.duration - ref0.lap.duration : undefined;
                      const gap = isRef ? null : t <= Math.min(ref0.lap.duration, l.lap.duration) ? estimatedDelta(ref0.lap, l.lap, t) : null;
                      const sg = (x: number, d: number) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
                      return (
                        <tr key={l.key} style={{ color: l.color }}>
                          <td>{l.label}</td>
                          <td className="text-right">{formatLapTime(l.lap.duration)}</td>
                          <td className="text-right">{isRef ? "rif." : fin === undefined ? "n/d" : fin === null ? "—" : sg(fin, 3)}</td>
                          <td className="text-right">{isRef ? "—" : gap === null ? "n/d" : sg(gap, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                  I grafici allineano i giri sul tempo trascorso dall'inizio di ciascun giro: allo stesso istante le auto possono trovarsi in punti diversi della pista.
                  Il gap stimato confronta i tempi a pari distanza, ricavata integrando la velocità: è un'approssimazione, non un dato ufficiale. Δ fin. è n/d se una durata non è ufficiale.
                </p>
              </div>
            )}
          </aside>
        </main>
      ) : null}
      <footer className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        Dati: OpenF1 dal 2023 · FastF1 2018–2022 da archivi importati · non ufficiale · frequenza variabile; posizione interpolata tra campioni ≤1,5 s.
      </footer>
    </div>
  );
}

function Readout({ lap, t, color, driver, year }: { lap: LapData; t: number; color: string; driver?: Driver | undefined; year: number }) {
  const tt = Math.min(t, lap.duration);
  const cur = telemetryAt(lap.tel, tt)?.s;
  const v = (x: number | null | undefined, u = "") => (x === null || x === undefined ? "n/d" : `${x}${u}`);
  const cov = lap.coverage;
  const poor = cov.tel < 0.7 || cov.pos < 0.7 || cov.maxTelGap > 2 || cov.maxPosGap > 2;
  return (
    <div className="f1-panel p-2" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-sm font-bold" style={{ color }}>{lap.driver} {driver?.name_acronym} · {year}</span>
        <span className="font-mono text-[11px] text-muted-foreground">G{lap.lapNumber} · {formatLapTime(lap.duration)}{lap.durationOfficial ? "" : "*"}</span>
      </div>
      <div className="mb-1 font-mono text-2xl font-bold sm:text-3xl tabular-nums">{v(cur?.speed)}<span className="ml-1 text-xs text-muted-foreground">km/h</span></div>
      <div className="grid grid-cols-2 gap-x-3">
        <Row k="Trascorso" v={`${tt.toFixed(2)} s${t > lap.duration ? " (fine)" : ""}`} />
        <Row k="Marcia" v={v(cur?.gear)} />
        <Row k="Acceleratore" v={v(cur?.throttle, "%")} />
        <Row k="Freno" v={cur?.brake === null || cur?.brake === undefined ? "n/d" : cur.brake ? "ON" : "OFF"} />
        <Row k="RPM" v={v(cur?.rpm)} />
        <Row k="DRS" v={cur?.drs === null || cur?.drs === undefined ? "n/d" : cur.drsOpen ? "APERTO" : cur.drs === 8 ? "abilitabile" : "chiuso"} />
      </div>
      <div className={`mt-1.5 text-[10px] ${poor ? "text-warning" : "text-muted-foreground"}`}>
        Copertura: telemetria {(cov.tel * 100).toFixed(0)}% · posizione {(cov.pos * 100).toFixed(0)}% · lacuna max {Math.max(cov.maxTelGap, cov.maxPosGap).toFixed(1)} s
        {poor ? " — dati incompleti" : ""}{lap.durationOfficial ? "" : " · *durata da inizio giro successivo"}
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-2 py-0.5 text-xs"><span className="text-muted-foreground">{k}</span><span className="font-mono tabular-nums">{v}</span></div>
);
const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <Button variant="ghost" aria-label={label} title={label} onClick={onClick} className="rounded border border-border bg-secondary p-2 text-muted-foreground hover:text-foreground sm:p-1.5">{children}</Button>
);
function EmptyState({ text, spinner, warn }: { text: string; spinner?: boolean; warn?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
      {spinner ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : warn ? <AlertTriangle className="h-6 w-6 text-warning" /> : <Activity className="h-6 w-6" />}
      <p className="max-w-md">{text}</p>
    </div>
  );
}
