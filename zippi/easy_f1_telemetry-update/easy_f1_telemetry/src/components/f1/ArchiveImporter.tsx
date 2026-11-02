import { useRef, useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  explainImportError,
  importArchiveFile,
  type ImportProgress,
  type ImportSummary,
} from "@/lib/archive-import";
export function ArchiveImporter({ onImported }: { onImported: (summary: ImportSummary) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>({ percent: 0, label: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const load = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    setMessage(`${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    try {
      const summary = await importArchiveFile(file, setProgress);
      setMessage(
        `${file.name} · ${(summary.bytes / 1024 / 1024).toFixed(2)} MB · ${summary.sessions} sessioni · anni ${summary.years.join(", ")} · modalità ${summary.mode === "full" ? "completa" : summary.mode === "compact" ? "compatta" : summary.mode} · disponibili fino alla chiusura della pagina`,
      );
      onImported(summary);
    } catch (e) {
      setError(true);
      setMessage(explainImportError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div
      className={`flex w-full flex-wrap items-center gap-2 border-t pt-2 ${drag ? "border-primary bg-accent" : "border-border"}`}
      aria-label="Area importazione archivio"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length !== 1) {
          setError(true);
          setMessage("Seleziona un solo archivio JSON o ZIP.");
          return;
        }
        void load(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        className="hidden"
        aria-label="Importa archivio storico"
        onChange={(e) => void load(e.target.files?.[0])}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <FileArchive />}Importa archivio 2018–2022
      </Button>
      <span className="text-xs text-muted-foreground">JSON o ZIP · trascina qui il file</span>
      <a
        className="text-xs text-muted-foreground underline"
        href={`${import.meta.env.BASE_URL}history/export_fastf1_archive.py`}
        download
      >
        Esportatore completo / compatto
      </a>
      {busy && (
        <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          <progress
            className="h-2 w-32 accent-primary"
            max={100}
            value={progress.percent}
            aria-label="Avanzamento importazione"
          />
          <span>
            {progress.percent}% · {progress.label}
          </span>
        </div>
      )}
      {message && (
        <span
          role={error ? "alert" : "status"}
          className={`w-full break-words text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
