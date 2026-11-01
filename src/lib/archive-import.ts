import { z } from "zod";
import { installSessions, parseArchive, sessionMetadataSchema, type HistoricalArchive } from "./history";
export const MAX_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const envelope = z.object({ format: z.literal("f1-telemetry-lab/archive-v2"), source: z.literal("FastF1"), years: z.array(z.number().int().min(2018).max(2022)).min(1).max(5), mode: z.enum(["full", "compact"]).optional() });
export type ImportProgress = { percent: number; label: string };
export type ImportSummary = { sessions: number; years: number[]; mode: string; bytes: number };
const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0));
export function validateYears(years: number[], actual: number[]) {
  if (new Set(years).size !== years.length || actual.some((y) => !years.includes(y)) || years.some((y) => !actual.includes(y))) throw new Error("Gli anni dichiarati non corrispondono alle sessioni presenti.");
}
export async function importAggregated(input: unknown, progress: (p: ImportProgress) => void = () => {}) {
  if (typeof input !== "object" || !input) throw new Error("Struttura archivio non valida.");
  const raw = input as { format?: unknown; sessions: unknown[] };
  if (raw.format === "f1-telemetry-lab/v1") {
    const data = parseArchive(input); installSessions([{ meta: data, data }]);
    return { sessions: 1, years: [data.year], mode: "v1" };
  }
  const header = envelope.parse(raw);
  if (!Array.isArray(raw.sessions) || !raw.sessions.length || raw.sessions.length > 1000) throw new Error("L'archivio deve contenere da 1 a 1000 sessioni.");
  const entries: { meta: HistoricalArchive; data: HistoricalArchive }[] = [];
  for (let i = 0; i < raw.sessions.length; i++) {
    try {
      const data = parseArchive({ ...(raw.sessions[i] as object), format: "f1-telemetry-lab/v1", source: "FastF1" });
      entries.push({ meta: data, data });
      raw.sessions[i] = null; // Release the unvalidated copy as each session is validated.
    } catch (e) { throw new Error(`Sessione ${i + 1} non valida: ${explainImportError(e)}`); }
    progress({ percent: 30 + Math.round(65 * (i + 1) / raw.sessions.length), label: `Validazione sessione ${i + 1}/${raw.sessions.length}` });
    await yieldUI();
  }
  validateYears(header.years, [...new Set(entries.map((s) => s.meta.year))]);
  installSessions(entries);
  return { sessions: entries.length, years: header.years, mode: header.mode ?? "non specificata" };
}
export function explainImportError(e: unknown) {
  if (e instanceof z.ZodError) { const issue = e.issues[0]; return `Formato o dati non validi (${issue?.path.join(".") || "archivio"}): ${issue?.message ?? "controlla versione e campioni"}`; }
  if (e instanceof SyntaxError) return "JSON non valido o incompleto.";
  return e instanceof Error ? e.message : "Impossibile leggere l'archivio.";
}
export async function importArchiveFile(file: File, progress: (p: ImportProgress) => void): Promise<ImportSummary> {
  progress({ percent: 0, label: "Controllo dimensione…" });
  if (file.name.toLowerCase().endsWith(".zip")) {
    if (file.size > MAX_ZIP_BYTES) throw new Error("ZIP oltre 1 GB: genera un archivio più piccolo per questo browser.");
    const { ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
    const reader = new ZipReader(new BlobReader(file));
    try {
      const files = await reader.getEntries();
      const manifest = files.find((f) => f.filename === "manifest.json");
      if (!manifest || !("getData" in manifest) || manifest.uncompressedSize > 1024 * 1024) throw new Error("ZIP privo di manifest.json valido.");
      const manifestText = await manifest.getData(new TextWriter());
      const raw = JSON.parse(manifestText);
      const header = envelope.parse(raw);
      const descriptors = z.array(sessionMetadataSchema.extend({ file: z.string().regex(/^sessions\/[a-zA-Z0-9_-]+\.json$/) })).min(1).max(1000).parse(raw.sessions);
      validateYears(header.years, [...new Set(descriptors.map((d) => d.year))]);
      const entries = descriptors.map((meta) => {
        const entry = files.find((f) => f.filename === meta.file);
        if (!entry || !("getData" in entry)) throw new Error(`Sessione mancante nello ZIP: ${meta.file}`);
        if (entry.uncompressedSize > MAX_JSON_BYTES) throw new Error(`Sessione oltre 64 MB: ${meta.file}. Usa la modalità compatta.`);
        return { meta, load: async () => {
          try { return parseArchive({ ...JSON.parse(await entry.getData(new TextWriter())), format: "f1-telemetry-lab/v1", source: "FastF1" }); }
          catch (e) { throw new Error(`${meta.event} · ${meta.session}: ${explainImportError(e)}`); }
        } };
      });
      installSessions(entries);
      progress({ percent: 100, label: "Indice ZIP importato; campioni caricati alla selezione della sessione." });
      return { sessions: entries.length, years: header.years, mode: header.mode ?? "non specificata", bytes: file.size };
    } finally { await reader.close(); }
  }
  if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Seleziona un archivio .json o .zip.");
  if (file.size > MAX_JSON_BYTES) throw new Error("JSON oltre 64 MB: genera un unico ZIP con --container zip; nessun campione viene eliminato.");
  const text = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => progress({ percent: e.lengthComputable ? Math.round(25 * e.loaded / e.total) : 5, label: "Lettura del file…" });
    r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("Impossibile leggere il file.")); r.readAsText(file);
  });
  progress({ percent: 28, label: "Analisi JSON…" }); await yieldUI();
  const result = await importAggregated(JSON.parse(text), progress);
  progress({ percent: 100, label: "Importazione completata" });
  return { ...result, bytes: file.size };
}
