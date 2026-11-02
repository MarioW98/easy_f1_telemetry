import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SeriesKey } from "@/components/f1/TelemetryCharts";
import type { Selection } from "@/components/f1/HistoricalPicker";

/** The two data sources the dashboard can read from. */
export type SourceKind = "local" | "openf1";

export interface Slot {
  id: number;
}
let slotSeq = 1;
const newSlot = (): Slot => ({ id: slotSeq++ });
export const MAX_DRIVERS = 4;

export const DEFAULT_VISIBLE: Record<SeriesKey, boolean> = {
  speed: true,
  throttle: true,
  brake: true,
  rpm: true,
  gear: true,
  drsOpen: true,
};

/**
 * Global app state (Zustand).
 *
 * Persisted: only `source` and `visible` (user preferences). Everything else is
 * transient selection state that must reset when the source changes, because
 * session/meeting keys from OpenF1 and local archives live in disjoint ranges.
 *
 * The playback clock stays out of the store on purpose: it updates at 60fps and
 * would re-render every subscriber; it remains a dedicated hook (use-playback).
 */
interface AppState {
  source: SourceKind;
  year: number | null;
  meetingKey: number | null;
  sessionKey: number | null;
  slots: Slot[];
  selections: Record<number, Selection | null>;
  req: { entries: Selection[] } | null;
  hidden: string[];
  visible: Record<SeriesKey, boolean>;
  focus: SeriesKey | null;
  /** Bumped when installed archives change, so archive queries refetch. */
  revision: number;

  setSource: (source: SourceKind) => void;
  setYear: (year: number | null) => void;
  setMeeting: (meetingKey: number | null) => void;
  setSession: (sessionKey: number | null) => void;
  addSlot: () => void;
  removeSlot: (id: number) => void;
  setSelection: (id: number, value: Selection | null) => void;
  load: (entries: Selection[]) => void;
  toggleHidden: (key: string) => void;
  toggleSeries: (key: SeriesKey) => void;
  setFocus: (focus: SeriesKey | null) => void;
  bumpRevision: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      source: "openf1",
      year: null,
      meetingKey: null,
      sessionKey: null,
      slots: [newSlot()],
      selections: {},
      req: null,
      hidden: [],
      visible: { ...DEFAULT_VISIBLE },
      focus: null,
      revision: 0,

      setSource: (source) =>
        set({
          source,
          year: null,
          meetingKey: null,
          sessionKey: null,
          slots: [newSlot()],
          selections: {},
          req: null,
          hidden: [],
          focus: null,
        }),
      setYear: (year) =>
        set({
          year,
          meetingKey: null,
          sessionKey: null,
          slots: [newSlot()],
          selections: {},
          req: null,
          hidden: [],
        }),
      setMeeting: (meetingKey) =>
        set({
          meetingKey,
          sessionKey: null,
          slots: [newSlot()],
          selections: {},
          req: null,
          hidden: [],
        }),
      setSession: (sessionKey) =>
        set({ sessionKey, slots: [newSlot()], selections: {}, req: null, hidden: [], focus: null }),
      addSlot: () =>
        set((s) => (s.slots.length >= MAX_DRIVERS ? s : { slots: [...s.slots, newSlot()] })),
      removeSlot: (id) =>
        set((s) => {
          const slots = s.slots.filter((o) => o.id !== id);
          const selections = { ...s.selections };
          delete selections[id];
          return { slots: slots.length ? slots : [newSlot()], selections };
        }),
      setSelection: (id, value) => set((s) => ({ selections: { ...s.selections, [id]: value } })),
      load: (entries) => set({ req: { entries } }),
      toggleHidden: (key) =>
        set((s) => ({
          hidden: s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key],
        })),
      toggleSeries: (key) => set((s) => ({ visible: { ...s.visible, [key]: !s.visible[key] } })),
      setFocus: (focus) => set({ focus }),
      bumpRevision: () => set((s) => ({ revision: s.revision + 1 })),
    }),
    {
      name: "f1-telemetry-lab-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ source: s.source, visible: s.visible }),
    },
  ),
);
