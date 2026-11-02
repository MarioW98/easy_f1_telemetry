import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, FolderDown, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { explainImportError, type ImportProgress, type ImportSummary } from "@/lib/archive-import";
import { installedArchiveIdentities } from "@/lib/history";
import {
  downloadRepoSession,
  fetchRepoManifestFresh,
  formatMB,
  isRepoSessionInstalled,
  REPO_MANIFEST_QUERY_KEY,
  type RepoSession,
} from "@/services/repoArchives";

/**
 * Browser for the archives committed in this repository
 * (public/data/archives/<year>/<session>.json, listed by manifest.json).
 * Each entry is a small per-session JSON (compact mode: fastest lap per
 * driver); downloading one installs it among the local sessions immediately.
 */
export function ArchiveManager({
  onInstalled,
}: {
  onInstalled: (summary: ImportSummary, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mq = useQuery({
    queryKey: REPO_MANIFEST_QUERY_KEY,
    queryFn: fetchRepoManifestFresh,
    staleTime: Infinity,
    retry: false,
  });

  const sessions = [...(mq.data?.sessions ?? [])].sort(
    (a, b) => b.year - a.year || a.date.localeCompare(b.date),
  );
  const years = [...new Set(sessions.map((s) => s.year))];
  const installed = installedArchiveIdentities();

  const download = async (meta: RepoSession) => {
    if (busy) return;
    setBusy(meta.file);
    setError(null);
    setProgress({ percent: 0, label: "Preparazione…" });
    try {
      const summary = await downloadRepoSession(meta, setProgress);
      onInstalled(summary, meta.year);
    } catch (e) {
      setError(`${meta.event} · ${meta.session}: ${explainImportError(e)}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const downloadYear = async (year: number, list: RepoSession[]) => {
    for (const meta of list) {
      if (busy || isRepoSessionInstalled(meta, installed)) continue;
      await download(meta);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="inline-flex h-9 items-center gap-1.5 rounded border border-border bg-secondary px-2.5 text-xs font-medium hover:text-foreground sm:h-[1.875rem]"
        >
          <FolderDown className="h-3.5 w-3.5" /> Archivi
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Archivi telemetria nel repository</DialogTitle>
          <DialogDescription>
            Sessioni FastF1 2018–2026 compilate dal workflow «Update F1 Archives» (modalità
            compatta: giro più veloce per pilota). Scarica una sessione per installarla tra i dati
            locali; nulla viene scaricato finché non lo chiedi.
          </DialogDescription>
        </DialogHeader>

        {mq.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lettura manifest…
          </div>
        ) : mq.error ? (
          <div className="flex items-start gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Manifest non disponibile: {explainImportError(mq.error)}</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col gap-3 py-4 text-sm text-muted-foreground">
            <span>
              Nessun archivio pubblicato nel repository. Esegui il workflow GitHub Actions «Update
              F1 Archives» per generare le sessioni di un anno, oppure importa un file locale dal
              pulsante «Importa archivio».
            </span>
            <Button variant="outline" onClick={() => void mq.refetch()} className="w-fit">
              <RefreshCw className="h-3.5 w-3.5" /> Ricarica elenco
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {years.map((year) => {
              const list = sessions.filter((s) => s.year === year);
              const allInstalled = list.every((s) => isRepoSessionInstalled(s, installed));
              return (
                <section key={year} className="flex flex-col gap-1.5">
                  <header className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{year}</h3>
                    <Button
                      variant="ghost"
                      disabled={busy !== null || allInstalled}
                      onClick={() => void downloadYear(year, list)}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px]"
                    >
                      <Download className="h-3 w-3" /> Scarica tutte
                    </Button>
                  </header>
                  <ul className="flex flex-col gap-1">
                    {list.map((meta) => {
                      const done = isRepoSessionInstalled(meta, installed);
                      const isBusy = busy === meta.file;
                      return (
                        <li
                          key={meta.file}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border px-2 py-1.5 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {meta.event} · {meta.session}
                          </span>
                          <time className="font-mono text-[10px] text-muted-foreground">
                            {meta.date.slice(0, 10)}
                          </time>
                          <span
                            className="font-mono text-[10px] text-muted-foreground"
                            title={
                              meta.bytes > 8 * 1024 * 1024
                                ? "File grande: il download potrebbe richiedere qualche istante"
                                : undefined
                            }
                          >
                            {formatMB(meta.bytes)}
                            {meta.laps !== undefined ? ` · ${meta.laps} giri` : ""}
                          </span>
                          {done ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <Check className="h-3.5 w-3.5" /> installata
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => void download(meta)}
                              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}{" "}
                              Scarica
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {progress && busy && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <progress className="h-2 flex-1 accent-primary" max={100} value={progress.percent} />
              <span className="font-mono">{progress.percent}%</span>
            </div>
            <span>{progress.label}</span>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
