import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Eye,
  EyeOff,
  Plus,
} from "lucide-react";
import { ApiError, type Driver } from "@/lib/openf1";
import {
  distinctColors,
  estimatedDelta,
  formatLapTime,
  telemetryAt,
  type LapData,
} from "@/lib/telemetry";
import { TrackMap } from "@/components/f1/TrackMap";
import { tyreInfo } from "@/lib/tyres";
import { SERIES, TelemetryCharts, type SeriesKey } from "@/components/f1/TelemetryCharts";
import { usePlayback } from "@/hooks/use-playback";
import { useTelemetryData, useLapQueries } from "@/hooks/useTelemetryData";
import { Button } from "@/components/ui/button";
import { HistoricalPicker, type Selection } from "@/components/f1/HistoricalPicker";
import { ArchiveManager } from "@/components/f1/ArchiveManager";
import { SourceSwitcher } from "@/components/f1/SourceSwitcher";
import { entryKey } from "@/lib/history";
import { ArchiveImporter } from "@/components/f1/ArchiveImporter";
import { fetchRepoManifestFresh, REPO_MANIFEST_QUERY_KEY } from "@/services/repoArchives";
import { openF1Source } from "@/services/openf1Source";
import { localArchiveSource } from "@/services/localArchiveSource";
import { useAppStore } from "@/store/appStore";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "F1 Telemetry Lab — Analisi telemetria storica Formula 1" },
      {
        name: "description",
        content:
          "Confronta fino a quattro giri di Formula 1 sullo stesso circuito, anche di annate differenti: OpenF1 dal 2023 e archivi FastF1 2018–2026.",
      },
      { property: "og:title", content: "F1 Telemetry Lab" },
      {
        property: "og:description",
        content:
          "Telemetria reale F1 con riproduzione sincronizzata e confronto tra piloti e annate, inclusi archivi FastF1 2018–2026.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const DASHES = [undefined, "6 3", "2 2", "9 3 2 3"];
const DASH_LABEL = ["continua", "tratteggiata", "punteggiata", "tratto-punto"];

function errMsg(e: unknown) {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Errore sconosciuto";
}

function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const rl = error instanceof ApiError && error.kind === "rate_limit";
  return (
    <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      <span>
        {rl ? "Limite API raggiunto. " : ""}
        {errMsg(error)}
      </span>
      <Button
        variant="ghost"
        onClick={onRetry}
        className="ml-1 inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 hover:bg-accent"
      >
        <RefreshCw className="h-3 w-3" /> Riprova
      </Button>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  // ---- global state (Zustand) ----
  const source = useAppStore((s) => s.source);
  const year = useAppStore((s) => s.year);
  const meeting = useAppStore((s) => s.meetingKey);
  const session = useAppStore((s) => s.sessionKey);
  const slots = useAppStore((s) => s.slots);
  const selections = useAppStore((s) => s.selections);
  const req = useAppStore((s) => s.req);
  const hidden = useAppStore((s) => s.hidden);
  const visible = useAppStore((s) => s.visible);
  const focus = useAppStore((s) => s.focus);
  const revision = useAppStore((s) => s.revision);
  const setYear = useAppStore((s) => s.setYear);
  const setMeeting = useAppStore((s) => s.setMeeting);
  const setSession = useAppStore((s) => s.setSession);
  const addSlot = useAppStore((s) => s.addSlot);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const setSelection = useAppStore((s) => s.setSelection);
  const load = useAppStore((s) => s.load);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const toggleSeries = useAppStore((s) => s.toggleSeries);
  const setFocus = useAppStore((s) => s.setFocus);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  // ---- source-aware data ----
  const { meetingsQ, sessionsQ, driversQ, lapsQ } = useTelemetryData();
  // repository archives manifest (enables "downloadable" years in local mode)
  const manifestQ = useQuery({
    queryKey: REPO_MANIFEST_QUERY_KEY,
    queryFn: fetchRepoManifestFresh,
    enabled: source === "local",
    staleTime: Infinity,
    retry: false,
  });

  // default year after switching source (or first visit, or when the manifest arrives)
  useEffect(() => {
    const st = useAppStore.getState();
    if (st.year !== null) return;
    if (st.source === "openf1") {
      st.setYear(2024);
      return;
    }
    const years = localArchiveSource.years();
    if (years.length) st.setYear(years[0]!);
  }, [source, manifestQ.isSuccess]);

  const isLocal = source === "local";
  const selectableYears = useMemo(
    () => (isLocal ? localArchiveSource.years() : openF1Source.years()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLocal, revision, manifestQ.data],
  );
  const hasLocalContent = selectableYears.length > 0;

  const now = Date.now();
  const meetings = useMemo(
    () =>
      (meetingsQ.data ?? [])
        .filter((m) => Date.parse(m.date_start) < now)
        .sort((a, b) => a.date_start.localeCompare(b.date_start)),
    [meetingsQ.data, now],
  );
  const sessions = useMemo(
    () =>
      (sessionsQ.data ?? [])
        .filter((s) => !s.is_cancelled && Date.parse(s.date_end) < now)
        .sort((a, b) => a.date_start.localeCompare(b.date_start)),
    [sessionsQ.data, now],
  );
  const drivers = useMemo(() => {
    const m = new Map<number, Driver>();
    for (const d of driversQ.data ?? []) m.set(d.driver_number, d);
    return [...m.values()].sort((a, b) => a.driver_number - b.driver_number);
  }, [driversQ.data]);
  const laps = lapsQ.data ?? [];
  const referenceMeeting = meetings.find((m) => m.meeting_key === meeting);
  const sessionName = sessions.find((s) => s.session_key === session)?.session_name ?? "";

  // One cached query per (session, driver, lap): already loaded laps are reused, only new ones are fetched.
  const lapQs = useLapQueries(req?.entries ?? []);
  const fetching = lapQs.some((q) => q.isFetching);
  const lapErrors = lapQs
    .map((q, i) => (q.error ? { q, e: req?.entries[i] } : null))
    .filter(Boolean) as { q: (typeof lapQs)[number]; e: Selection }[];
  const loadedKey = lapQs.map((q) => q.dataUpdatedAt).join(",");
  const LAPS = useMemo(() => lapQs.map((q) => q.data ?? null), [loadedKey, req, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const dInfo = (e: Selection) => e.info;
  const colors = useMemo(
    () => distinctColors((req?.entries ?? []).map((e) => dInfo(e)?.team_colour)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [req, drivers],
  );

  // all loaded entries, with identity, regardless of visibility
  const loaded = useMemo(
    () =>
      (req?.entries ?? [])
        .map((e, i) => {
          const lap = LAPS[i];
          if (!lap) return null;
          const info = dInfo(e);
          return {
            key: entryKey(e),
            idx: i,
            lap,
            color: colors[i] ?? "var(--color-primary)",
            dash: DASHES[i],
            label: `${info.name_acronym} ${e.year}`,
            info,
            year: e.year,
          };
        })
        .filter(Boolean) as {
        key: string;
        idx: number;
        lap: LapData;
        color: string;
        dash: string | undefined;
        label: string;
        info: Driver | undefined;
        year: number;
      }[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [req, LAPS, colors, drivers],
  );
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const shown = useMemo(() => loaded.filter((l) => !hiddenSet.has(l.key)), [loaded, hiddenSet]);

  const duration = Math.max(0, ...loaded.map((l) => l.lap.duration));
  const pb = usePlayback(duration);
  useEffect(() => {
    pb.reset();
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartDrivers = useMemo(
    () =>
      shown
        .filter((l) => l.lap.tel.length)
        .map((l) => ({ lap: l.lap, color: l.color, label: l.label, dash: l.dash })),
    [shown],
  );
  const mapDrivers = useMemo(
    () =>
      shown.map((l) => ({
        lap: l.lap,
        color: l.color,
        label: l.label,
        number: l.lap.driver,
        dash: l.dash,
        reference: l.idx === 0,
      })),
    [shown],
  );

  const t = pb.time;
  const ref0 = loaded[0] ?? null;
  const curRef = ref0 ? telemetryAt(ref0.lap.tel, t) : null;
  const stepSample = (dir: 1 | -1) => {
    if (!ref0) return;
    pb.setPlaying(false);
    const inLap = ref0.lap.tel.filter((s) => s.t >= 0 && s.t <= duration);
    const next =
      dir > 0
        ? inLap.find((s) => s.t > t + 1e-6)
        : [...inLap].reverse().find((s) => s.t < t - 1e-6);
    pb.seek(next ? next.t : dir > 0 ? duration : 0);
  };

  const loading =
    meetingsQ.isFetching ||
    sessionsQ.isFetching ||
    driversQ.isFetching ||
    lapsQ.isFetching ||
    fetching;
  const filled = slots
    .flatMap((s) => (selections[s.id] ? [selections[s.id]] : []))
    .filter((s): s is Selection => s !== null && s !== undefined);
  const canLoad = session !== null && filled.length > 0;
  const hasData = loaded.some((l) => l.lap.tel.length || l.lap.pos.length);
  const onArchiveInstalled = (summary: { years: number[] }, installedYear: number) => {
    queryClient.removeQueries({
      predicate: (q) => {
        const k = q.queryKey;
        if (k[0] === "lapdata") return typeof k[2] === "number" && k[2] < 0;
        return (
          ["meetings", "sessions", "drivers", "laps"].includes(String(k[0])) &&
          typeof k[2] === "number" &&
          k[2] < 2023
        );
      },
    });
    bumpRevision();
    setYear(installedYear);
  };
  // files imported manually are local data: make sure the switcher reflects it
  const onFileImported = (summary: { years: number[] }) => {
    useAppStore.getState().setSource("local");
    onArchiveInstalled(summary, Math.max(...summary.years));
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="mr-3 flex w-full items-center gap-2 sm:w-auto">
          <div className="h-4 w-1 bg-primary" />
          <h1 className="text-sm font-bold uppercase tracking-[0.15em]">F1 Telemetry Lab</h1>
        </div>
        <select
          aria-label="Stagione"
          className="f1-select"
          value={year ?? ""}
          onChange={(e) => setYear(e.target.value ? +e.target.value : null)}
        >
          {year === null && <option value="">Anno…</option>}
          {selectableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          aria-label="Gran Premio"
          className="f1-select min-w-0 flex-1 sm:w-56 sm:flex-none"
          value={meeting ?? ""}
          disabled={!meetings.length}
          onChange={(e) => setMeeting(e.target.value ? +e.target.value : null)}
        >
          <option value="">
            {meetingsQ.isFetching
              ? "Caricamento eventi…"
              : meetings.length
                ? "Seleziona evento"
                : "Nessun evento disponibile"}
          </option>
          {meetings.map((m) => (
            <option key={m.meeting_key} value={m.meeting_key}>
              {m.meeting_name} · {m.circuit_short_name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sessione"
          className="f1-select w-full sm:w-40"
          value={session ?? ""}
          disabled={!sessions.length}
          onChange={(e) => setSession(e.target.value ? +e.target.value : null)}
        >
          <option value="">
            {sessionsQ.isFetching
              ? "Caricamento…"
              : meeting
                ? sessions.length
                  ? "Seleziona sessione"
                  : "Nessuna sessione"
                : "Sessione"}
          </option>
          {sessions.map((s) => (
            <option key={s.session_key} value={s.session_key}>
              {s.session_name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 font-mono sm:ml-auto text-[11px] text-muted-foreground">
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> caricamento dati…
            </>
          ) : (
            <>
              <Activity className="h-3.5 w-3.5 text-success" /> pronto
            </>
          )}
        </div>
        <SourceSwitcher />
        {isLocal && <ArchiveManager onInstalled={onArchiveInstalled} />}
        <ArchiveImporter onImported={onFileImported} />
        {[meetingsQ, sessionsQ, driversQ, lapsQ].map((q, i) =>
          q.error ? <ErrorBox key={i} error={q.error} onRetry={() => q.refetch()} /> : null,
        )}
      </header>

      {/* Source hints */}
      {isLocal && selectableYears.length === 0 && !manifestQ.isFetching && (
        <p className="border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">
          Elenco archivi non disponibile (manifest vuoto o offline): apri «Archivi» e premi
          «Ricarica elenco», importa un file, oppure passa a «OpenF1 Live» (2023+).
        </p>
      )}
      {isLocal &&
        selectableYears.length > 0 &&
        year !== null &&
        meetingsQ.isSuccess &&
        meetings.length === 0 && (
          <p className="border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">
            Nessun evento negli archivi per quest'anno: scegli un altro anno, scarica le sessioni da
            «Archivi» o prova con «OpenF1 Live».
          </p>
        )}

      {/* Driver slots */}
      <section className="flex flex-wrap items-end gap-2 border-b border-border px-3 py-2">
        {referenceMeeting &&
          session !== null &&
          slots.map((s, i) => (
            <HistoricalPicker
              key={`${session}-${s.id}`}
              label={`Pilota ${i + 1}${i === 0 ? " (riferimento)" : ""}`}
              reference={referenceMeeting}
              initialSession={session}
              initialName={sessionName}
              years={selectableYears}
              revision={revision}
              onSelect={(value) => setSelection(s.id, value)}
              onRemove={slots.length > 1 ? () => removeSlot(s.id) : undefined}
            />
          ))}
        {slots.length < 4 && (
          <Button
            variant="ghost"
            disabled={!drivers.length}
            onClick={addSlot}
            className="inline-flex h-9 items-center gap-1 rounded border border-dashed sm:h-[1.875rem] border-border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Aggiungi pilota
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={!canLoad || fetching}
          onClick={() => load(filled)}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded bg-primary sm:h-[1.875rem] sm:flex-none px-3 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Carica analisi
        </Button>
        {driversQ.isFetching || lapsQ.isFetching ? (
          <span className="text-xs text-muted-foreground">Caricamento piloti e giri…</span>
        ) : null}
        {session &&
        !driversQ.isFetching &&
        !lapsQ.isFetching &&
        (drivers.length === 0 || laps.length === 0) &&
        !driversQ.error &&
        !lapsQ.error ? (
          <span className="text-xs text-warning">
            Nessun pilota o giro disponibile per questa sessione.
            {!isLocal && hasLocalContent
              ? " Prova con «Dati Locali» se hai archivi installati."
              : ""}
          </span>
        ) : null}
      </section>

      {loaded.some((l) => l.year !== loaded[0]?.year) && (
        <p className="border-b border-border px-3 py-1 text-xs text-warning">
          Stesso circuito, annate diverse: configurazione, condizioni e coordinate possono variare.
          Le posizioni non sono riallineate artificialmente.
        </p>
      )}
      {/* Interactive legend */}
      {loaded.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
          <span className="f1-label mr-1">Legenda</span>
          {loaded.map((l) => {
            const off = hiddenSet.has(l.key);
            return (
              <Button
                variant="ghost"
                key={l.key}
                title={off ? "Mostra" : "Nascondi temporaneamente"}
                onClick={() => toggleHidden(l.key)}
                className={`inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs ${off ? "opacity-40" : ""}`}
              >
                <svg width="22" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="22"
                    y2="4"
                    stroke={l.color}
                    strokeWidth="2.5"
                    strokeDasharray={l.dash}
                  />
                </svg>
                <span className="font-mono font-bold" style={{ color: l.color }}>
                  {l.lap.driver}
                </span>
                <span>
                  {l.info?.full_name ?? l.label} · {l.year}
                </span>
                <span className="text-muted-foreground">
                  {l.info?.team_name ?? ""} · G{l.lap.lapNumber} · {DASH_LABEL[l.idx]}
                </span>
                {off ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            );
          })}
        </section>
      )}

      {/* Main */}
      {!req ? (
        <EmptyState
          text={
            session
              ? "Seleziona da 1 a 4 piloti con il rispettivo giro, poi premi «Carica analisi»."
              : isLocal && !hasLocalContent
                ? "Nessun archivio locale: apri «Archivi» per scaricare le sessioni dal repository, importa un file, oppure passa a «OpenF1 Live»."
                : "Seleziona stagione, Gran Premio e sessione per iniziare. OpenF1 dal 2023; archivi FastF1 2018–2026 dal repository o importati."
          }
        />
      ) : loaded.length === 0 && fetching ? (
        <EmptyState text="Caricamento telemetria e posizioni dei giri selezionati…" spinner />
      ) : loaded.length === 0 && lapErrors.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <ErrorBox
            error={lapErrors[0]?.q.error}
            onRetry={() => lapErrors.forEach((x) => x.q.refetch())}
          />
        </div>
      ) : loaded.length && !hasData ? (
        <EmptyState text="Nessun dato di telemetria o posizione per i giri selezionati." warn />
      ) : loaded.length ? (
        <main className="grid flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[1fr_300px]">
          <div className="flex min-w-0 flex-col">
            <div className="f1-panel h-[300px] shrink-0 overflow-hidden touch-pan-y sm:h-[420px] xl:h-[540px]">
              <TrackMap
                drivers={mapDrivers}
                time={t}
                onPickTime={(x) => {
                  pb.setPlaying(false);
                  pb.seek(x);
                }}
              />
            </div>
            {/* Telemetry */}
            <div className="f1-panel mt-2 flex flex-col p-2">
              <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1">
                <span className="f1-label mr-2 w-full sm:w-auto">
                  Telemetria · asse X = secondi dall'inizio di ciascun giro
                </span>
                {SERIES.map((s) => (
                  <Button
                    variant="ghost"
                    key={s.key}
                    onClick={() => toggleSeries(s.key)}
                    className={`inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] sm:px-1.5 sm:py-0.5 sm:text-[10px] ${visible[s.key] ? "text-foreground" : "text-muted-foreground line-through"}`}
                  >
                    {visible[s.key] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {s.label}
                  </Button>
                ))}
                {focus && (
                  <Button
                    variant="ghost"
                    onClick={() => setFocus(null)}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" /> Ripristina grafici
                  </Button>
                )}
              </div>
              <div>
                {chartDrivers.length ? (
                  <TelemetryCharts
                    drivers={chartDrivers}
                    duration={duration}
                    time={t}
                    onSeek={(x) => {
                      pb.setPlaying(false);
                      pb.seek(x);
                    }}
                    visible={visible}
                    focus={focus && visible[focus] ? focus : null}
                    onFocus={setFocus}
                  />
                ) : (
                  <p className="p-4 text-muted-foreground">
                    {loaded.length && shown.length === 0
                      ? "Tutti i piloti sono nascosti: riattivali dalla legenda."
                      : "Nessun campione /car_data per i giri visibili."}
                  </p>
                )}
              </div>
            </div>
            {/* Playback — ultimo elemento della colonna: resta fisso in basso durante lo scroll */}
            <div className="f1-panel sticky bottom-0 z-30 mt-2 flex shrink-0 flex-wrap items-center gap-2 px-2 py-1.5 shadow-lg">
              <IconBtn label="Riavvia" onClick={pb.reset}>
                <RotateCcw className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Campione precedente" onClick={() => stepSample(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </IconBtn>
              <Button
                variant="ghost"
                aria-label={pb.playing ? "Pausa" : "Riproduci"}
                onClick={pb.toggle}
                className="rounded bg-primary p-2 text-primary-foreground sm:p-1.5 hover:bg-primary/90"
              >
                {pb.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <IconBtn label="Campione successivo" onClick={() => stepSample(1)}>
                <ChevronRight className="h-4 w-4" />
              </IconBtn>
              <input
                aria-label="Tempo del giro"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={t}
                onChange={(e) => pb.seek(+e.target.value)}
                className="order-first h-6 w-full basis-full accent-primary sm:order-none sm:h-auto sm:min-w-[160px] sm:flex-1 sm:basis-auto"
              />
              <span className="font-mono text-xs tabular-nums">
                {t.toFixed(2)} / {duration.toFixed(2)} s
              </span>
              <div className="flex overflow-hidden rounded border border-border">
                {[0.25, 0.5, 1, 2].map((r) => (
                  <Button
                    variant="ghost"
                    key={r}
                    onClick={() => pb.setRate(r)}
                    className={`px-2.5 py-1 font-mono text-[11px] sm:px-2 sm:py-0.5 ${pb.rate === r ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                  >
                    {r}x
                  </Button>
                ))}
              </div>
              <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                {pb.playing ? "▶ in riproduzione" : "❚❚ in pausa"} · campione{" "}
                {curRef ? curRef.idx + 1 : "—"}/{ref0?.lap.tel.length ?? 0}
              </span>
            </div>
          </div>

          {/* Side readouts */}
          <aside className="grid content-start gap-2 sm:grid-cols-2 xl:flex xl:flex-col">
            {lapErrors.map((x, i) => (
              <ErrorBox key={i} error={x.q.error} onRetry={() => x.q.refetch()} />
            ))}
            {fetching && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> caricamento giri aggiuntivi…
              </div>
            )}
            {loaded.map((l) => (
              <Readout
                key={l.key}
                lap={l.lap}
                t={t}
                color={l.color}
                driver={l.info}
                year={l.year}
              />
            ))}
            {loaded.length > 1 && ref0 && (
              <div className="f1-panel p-2 sm:col-span-2">
                <div className="f1-label mb-1">Confronto vs {ref0.label} (riferimento)</div>
                <table className="w-full font-mono text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-normal">Pilota</th>
                      <th className="text-right font-normal">Giro</th>
                      <th className="text-right font-normal">Δ fin.</th>
                      <th className="text-right font-normal">Gap ora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.map((l) => {
                      const isRef = l === ref0;
                      const fin = isRef
                        ? null
                        : ref0.lap.durationOfficial && l.lap.durationOfficial
                          ? l.lap.duration - ref0.lap.duration
                          : undefined;
                      const gap = isRef
                        ? null
                        : t <= Math.min(ref0.lap.duration, l.lap.duration)
                          ? estimatedDelta(ref0.lap, l.lap, t)
                          : null;
                      const sg = (x: number, d: number) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
                      return (
                        <tr key={l.key} style={{ color: l.color }}>
                          <td>{l.label}</td>
                          <td className="text-right">{formatLapTime(l.lap.duration)}</td>
                          <td className="text-right">
                            {isRef
                              ? "rif."
                              : fin === undefined
                                ? "n/d"
                                : fin === null
                                  ? "—"
                                  : sg(fin, 3)}
                          </td>
                          <td className="text-right">
                            {isRef ? "—" : gap === null ? "n/d" : sg(gap, 2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                  I grafici allineano i giri sul tempo trascorso dall'inizio di ciascun giro: allo
                  stesso istante le auto possono trovarsi in punti diversi della pista. Il gap
                  stimato confronta i tempi a pari distanza, ricavata integrando la velocità: è
                  un'approssimazione, non un dato ufficiale. Δ fin. è n/d se una durata non è
                  ufficiale.
                </p>
              </div>
            )}
          </aside>
        </main>
      ) : null}
      <footer className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        Dati: OpenF1 dal 2023 · FastF1 2018–2026 da archivi del repository o importati · non
        ufficiale · frequenza variabile; posizione interpolata tra campioni ≤1,5 s.
      </footer>
    </div>
  );
}

function Readout({
  lap,
  t,
  color,
  driver,
  year,
}: {
  lap: LapData;
  t: number;
  color: string;
  driver?: Driver | undefined;
  year: number;
}) {
  const tt = Math.min(t, lap.duration);
  const cur = telemetryAt(lap.tel, tt)?.s;
  const tyre = tyreInfo(lap.compound);
  const v = (x: number | null | undefined, u = "") =>
    x === null || x === undefined ? "n/d" : `${x}${u}`;
  const cov = lap.coverage;
  const poor = cov.tel < 0.7 || cov.pos < 0.7 || cov.maxTelGap > 2 || cov.maxPosGap > 2;
  return (
    <div className="f1-panel p-2" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-sm font-bold" style={{ color }}>
          {lap.driver} {driver?.name_acronym} · {year}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          G{lap.lapNumber} · {formatLapTime(lap.duration)}
          {lap.durationOfficial ? "" : "*"}
        </span>
      </div>
      <div className="mb-1 font-mono text-2xl font-bold sm:text-3xl tabular-nums">
        {v(cur?.speed)}
        <span className="ml-1 text-xs text-muted-foreground">km/h</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Row k="Trascorso" v={`${tt.toFixed(2)} s${t > lap.duration ? " (fine)" : ""}`} />
        <Row k="Marcia" v={v(cur?.gear)} />
        <Row k="Acceleratore" v={v(cur?.throttle, "%")} />
        <Row
          k="Freno"
          v={cur?.brake === null || cur?.brake === undefined ? "n/d" : cur.brake ? "ON" : "OFF"}
        />
        <Row k="RPM" v={v(cur?.rpm)} />
        <Row
          k="DRS"
          v={
            cur?.drs === null || cur?.drs === undefined
              ? "n/d"
              : cur.drsOpen
                ? "APERTO"
                : cur.drs === 8
                  ? "abilitabile"
                  : "chiuso"
          }
        />
        <Row
          k="Gomme"
          v={
            tyre ? (
              <span className="flex items-center justify-end gap-1">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full border border-border"
                  style={{ background: tyre.color }}
                />
                {tyre.label}
                {lap.tyreAge !== null && lap.tyreAge !== undefined
                  ? ` · età ${lap.tyreAge} ${lap.tyreAge === 1 ? "giro" : "giri"}`
                  : ""}
              </span>
            ) : (
              "n/d"
            )
          }
        />
      </div>
      <div className={`mt-1.5 text-[10px] ${poor ? "text-warning" : "text-muted-foreground"}`}>
        Copertura: telemetria {(cov.tel * 100).toFixed(0)}% · posizione {(cov.pos * 100).toFixed(0)}
        % · lacuna max {Math.max(cov.maxTelGap, cov.maxPosGap).toFixed(1)} s
        {poor ? " — dati incompleti" : ""}
        {lap.durationOfficial ? "" : " · *durata da inizio giro successivo"}
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-2 py-0.5 text-xs">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-mono tabular-nums">{v}</span>
  </div>
);
const IconBtn = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button
    variant="ghost"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="rounded border border-border bg-secondary p-2 text-muted-foreground hover:text-foreground sm:p-1.5"
  >
    {children}
  </Button>
);
function EmptyState({ text, spinner, warn }: { text: string; spinner?: boolean; warn?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
      {spinner ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      ) : warn ? (
        <AlertTriangle className="h-6 w-6 text-warning" />
      ) : (
        <Activity className="h-6 w-6" />
      )}
      <p className="max-w-md">{text}</p>
    </div>
  );
}
