import { Cloud, Database } from "lucide-react";
import { useAppStore } from "@/store/appStore";

/**
 * Toggle between the two data sources, per the implementation plan:
 * top-right of the main bar, persisted in localStorage (via the store's
 * persist middleware), with a colored badge showing the active source.
 */
export function SourceSwitcher() {
  const source = useAppStore((s) => s.source);
  const setSource = useAppStore((s) => s.setSource);
  const isLocal = source === "local";
  return (
    <div
      role="radiogroup"
      aria-label="Fonte dati"
      className="inline-flex items-center overflow-hidden rounded border border-border bg-secondary"
    >
      <button
        role="radio"
        aria-checked={isLocal}
        title="Archivi FastF1 2018–2026 (scaricati dal repository o importati da file)"
        onClick={() => {
          if (!isLocal) setSource("local");
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${
          isLocal ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Database className="h-3.5 w-3.5" />
        Dati Locali
        <span
          aria-hidden
          className={`ml-0.5 h-1.5 w-1.5 rounded-full ${isLocal ? "bg-white" : "bg-muted-foreground/50"}`}
        />
      </button>
      <button
        role="radio"
        aria-checked={!isLocal}
        title="API pubblica OpenF1 (stagioni 2023–oggi, ≈3 richieste/secondo)"
        onClick={() => {
          if (isLocal) setSource("openf1");
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${
          !isLocal ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Cloud className="h-3.5 w-3.5" />
        OpenF1 Live
        <span
          aria-hidden
          className={`ml-0.5 h-1.5 w-1.5 rounded-full ${!isLocal ? "bg-white" : "bg-muted-foreground/50"}`}
        />
      </button>
    </div>
  );
}
