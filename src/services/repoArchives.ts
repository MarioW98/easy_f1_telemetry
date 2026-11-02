import { z } from "zod";
import { importAggregated, type ImportProgress, type ImportSummary } from "@/lib/archive-import";

/**
 * Repository-hosted archives: small per-session JSON files committed under
 * `public/data/archives/<year>/` and published by GitHub Pages, described by a
 * single manifest.json. The workflow `.github/workflows/update-archives.yml`
 * generates them (FastF1, compact mode = fastest lap per driver).
 *
 * Downloading one session = one small HTTP request (typically 1-4 MB); nothing
 * is ever decompressed in memory as a whole season.
 */

const manifestSchema = z.object({
  generated: z.string().nullable().optional(),
  sessions: z.array(
    z.object({
      year: z.number().int().min(2018).max(2026),
      event: z.string().min(1),
      circuit: z.string().min(1),
      session: z.string().min(1),
      date: z.string().min(1),
      file: z.string().regex(/^[0-9]{4}\/[a-zA-Z0-9._-]+\.json$/),
      bytes: z.number().int().nonnegative(),
      drivers: z.number().int().nonnegative().optional(),
      laps: z.number().int().nonnegative().optional(),
    }),
  ),
});

export type RepoSession = z.infer<typeof manifestSchema>["sessions"][number];
export type RepoManifest = z.infer<typeof manifestSchema>;

export const REPO_MANIFEST_QUERY_KEY = ["repoArchives"] as const;

/** React Query fetcher: always fresh (bypasses the module memoization). */
export const fetchRepoManifestFresh = () => fetchRepoManifest(true);

export function parseRepoManifest(raw: unknown): RepoManifest {
  return manifestSchema.parse(raw);
}

export function repoSessionUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/archives/${file}`;
}

let cache: RepoManifest | null = null;

/**
 * Fetch the repository manifest. `force` bypasses the module memoization (used
 * by "Ricarica elenco"); a missing/invalid manifest = empty list. The memoized
 * copy only feeds `localArchiveSource.years()` before React Query resolves.
 */
export async function fetchRepoManifest(force = false): Promise<RepoManifest> {
  if (!force && cache) return cache;
  const url = `${import.meta.env.BASE_URL}data/archives/manifest.json`;
  const res = await fetch(url);
  if (res.status === 404) return (cache = { generated: null, sessions: [] });
  if (!res.ok) throw new Error(`Manifest archivi non disponibile (HTTP ${res.status}).`);
  cache = parseRepoManifest(await res.json());
  return cache;
}

export function cachedRepoSessions(): RepoSession[] {
  return cache?.sessions ?? [];
}

export function isRepoSessionInstalled(meta: RepoSession, installedKeys: Set<string>): boolean {
  // Installed archive sessions are identified by event+circuit+session+date.
  return installedKeys.has(
    `${meta.year}|${meta.event}|${meta.circuit}|${meta.session}|${meta.date}`,
  );
}

/** Download one session JSON with progress, validate and install it. */
export async function downloadRepoSession(
  meta: RepoSession,
  progress: (p: ImportProgress) => void = () => {},
): Promise<ImportSummary> {
  progress({ percent: 0, label: "Download…" });
  const res = await fetch(repoSessionUrl(meta.file));
  if (!res.ok) throw new Error(`Download non riuscito (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || meta.bytes || 0;
  let text: string;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: string[] = [];
    let received = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      progress({
        percent: Math.min(25, Math.round((25 * received) / total)),
        label: `Download ${formatMB(received)} / ${formatMB(total)}…`,
      });
    }
    chunks.push(decoder.decode());
    text = chunks.join("");
  } else {
    text = await res.text();
  }
  progress({ percent: 30, label: "Validazione…" });
  const summary = await importAggregated(JSON.parse(text), (p) =>
    progress({ percent: 30 + Math.round(0.7 * p.percent), label: p.label }),
  );
  progress({ percent: 100, label: "Sessione installata" });
  return { ...summary, bytes: total || text.length };
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
