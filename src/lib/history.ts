import { z } from "zod";
import { api, type Meeting, type Session, type Driver, type Lap } from "./openf1";
import { buildLapData, lapWindow, MARGIN_S, type LapData } from "./telemetry";

const finite = z.number().finite();
export const sessionMetadataSchema = z.object({
  year: z.number().int().min(2018).max(2022), event: z.string().min(1), circuit: z.string().min(1),
  session: z.string().min(1), date: z.string().datetime(),
});
const archiveSchema = sessionMetadataSchema.extend({
  format: z.literal("f1-telemetry-lab/v1"), source: z.literal("FastF1"),
  drivers: z.array(z.object({ driver_number: z.number().int().positive(), name_acronym: z.string(), full_name: z.string(), team_name: z.string().nullable(), team_colour: z.string().nullable() })).min(1).max(30),
  laps: z.array(z.object({
    driver: z.number().int().positive(), lapNumber: z.number().int().positive(),
    startMs: finite.refine((ms) => Number.isFinite(new Date(ms).getTime()), "Data del giro non valida."), duration: finite.positive(), durationOfficial: z.boolean(),
    tel: z.array(z.object({ t: finite, speed: finite.nullable(), throttle: finite.nullable(), brake: finite.nullable(), rpm: finite.nullable(), gear: finite.nullable(), drs: finite.nullable(), drsOpen: finite.nullable() })).max(20000),
    pos: z.array(z.object({ t: finite, x: finite, y: finite })).max(20000),
  })).min(1).max(10000),
});
export type HistoricalArchive = z.infer<typeof archiveSchema>;
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
type Stored = { meta: SessionMetadata; data?: HistoricalArchive; load?: () => Promise<HistoricalArchive> };
const archives = new Map<number, Stored>();
const identities = new Map<string, number>();
const meetings = new Map<string, number>();
const lazyCache = new Map<number, HistoricalArchive>();
const pending = new Map<number, Promise<HistoricalArchive>>();
let seq = -1;
const identity = (a: SessionMetadata) => JSON.stringify([a.year, a.event, a.circuit, a.session, a.date]);
const eventIdentity = (a: SessionMetadata) => JSON.stringify([a.year, a.event, a.circuit]);
export function parseArchive(input: unknown): HistoricalArchive {
  const a = archiveSchema.parse(input);
  const keys = new Set<string>();
  for (const l of a.laps) {
    if (!a.drivers.some((d) => d.driver_number === l.driver)) throw new Error("Pilota del giro assente dall'archivio.");
    const key = `${l.driver}-${l.lapNumber}`;
    if (keys.has(key)) throw new Error("Giro duplicato nell'archivio.");
    keys.add(key);
    for (const samples of [l.tel, l.pos]) {
      if (samples.some((s, i) => s.t < -MARGIN_S || s.t > l.duration + MARGIN_S || (i > 0 && s.t <= (samples[i - 1]?.t ?? -Infinity)))) throw new Error("Campioni fuori intervallo o non ordinati.");
    }
    if (!l.tel.some((s) => s.t >= 0 && s.t <= l.duration)) throw new Error("Il giro non contiene telemetria nell'intervallo del giro.");
  }
  return a;
}
function store(stored: Stored) {
  const id = identity(stored.meta);
  const key = identities.get(id) ?? seq--;
  identities.set(id, key);
  const eventId = eventIdentity(stored.meta);
  // The first session's key doubles as its event key for backwards compatibility.
  if (!meetings.has(eventId)) meetings.set(eventId, key);
  archives.set(key, stored); lazyCache.delete(key);
  return key;
}
export function importArchive(input: unknown) {
  const archive = parseArchive(input);
  return { key: store({ meta: archive, data: archive }), archive };
}
export function installSessions(entries: Stored[]) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = identity(entry.meta);
    if (seen.has(id)) throw new Error("Sessione duplicata nell'archivio.");
    seen.add(id);
  }
  return entries.map(store);
}
export function availableHistoricalYears() { return [...new Set([...archives.values()].map((s) => s.meta.year))].sort((a,b) => b-a); }
async function getArchive(key: number) {
  const stored = archives.get(key);
  if (!stored) return undefined;
  if (stored.data) return stored.data;
  const cached = lazyCache.get(key);
  if (cached) { lazyCache.delete(key); lazyCache.set(key, cached); return cached; }
  const active = pending.get(key); if (active) return active;
  const load = stored.load; if (!load) throw new Error("Sessione incompleta.");
  const promise = load().then((data) => {
    if (identity(data) !== identity(stored.meta)) throw new Error("La sessione ZIP non corrisponde all'indice.");
    lazyCache.set(key, data);
    while (lazyCache.size > 2) { const oldest = lazyCache.keys().next().value; if (oldest !== undefined) lazyCache.delete(oldest); }
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, promise); return promise;
}
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
export function sameCircuit(a: Meeting, b: Meeting) {
  if (a.circuit_key !== undefined && b.circuit_key !== undefined) return a.circuit_key === b.circuit_key;
  return normalize(a.circuit_short_name) === normalize(b.circuit_short_name);
}
export const entryKey = (e: { session: number; d: number; lap: number }) => `${e.session}-${e.d}-${e.lap}`;
export const dataApi = {
  meetings: async (year: number): Promise<Meeting[]> => {
    if (year >= 2023) return api.meetings(year);
    const result = new Map<number, Meeting>();
    for (const { meta: a } of archives.values()) {
      if (a.year !== year) continue;
      const key = meetings.get(eventIdentity(a)); if (key === undefined) continue;
      const prev = result.get(key);
      if (!prev || a.date < prev.date_start) result.set(key, { meeting_key: key, meeting_name: a.event, country_name: "", circuit_short_name: a.circuit, date_start: a.date, year });
    }
    return [...result.values()];
  },
  sessions: async (key: number): Promise<Session[]> => {
    if (key >= 0) return api.sessions(key);
    return [...archives].filter(([, a]) => meetings.get(eventIdentity(a.meta)) === key).map(([id, { meta: a }]) => ({ session_key: id, meeting_key: key, session_name: a.session, session_type: a.session, date_start: a.date, date_end: a.date }));
  },
  drivers: async (key: number): Promise<Driver[]> => (await getArchive(key))?.drivers ?? (key < 0 ? [] : api.drivers(key)),
  laps: async (key: number): Promise<Lap[]> => {
    const a = await getArchive(key);
    return a ? a.laps.map((l) => ({ driver_number: l.driver, lap_number: l.lapNumber, date_start: new Date(l.startMs).toISOString(), lap_duration: l.duration, is_pit_out_lap: false })) : key < 0 ? [] : api.laps(key);
  },
  lapData: async (session: number, driver: number, number: number, laps: Lap[]): Promise<LapData> => {
    const a = await getArchive(session);
    if (a) {
      const l = a.laps.find((l) => l.driver === driver && l.lapNumber === number);
      if (!l) throw new Error("Giro assente dall'archivio.");
      const date = (t: number) => new Date(l.startMs + t * 1000).toISOString();
      const result = buildLapData(driver, number, { startMs: l.startMs, endMs: l.startMs + l.duration * 1000, official: l.durationOfficial },
        l.tel.map((s) => ({ date: date(s.t), speed: s.speed, throttle: s.throttle, brake: s.brake, rpm: s.rpm, n_gear: s.gear, drs: s.drs })), l.pos.map((s) => ({ date: date(s.t), x: s.x, y: s.y, z: null })));
      // Preserve the archive's explicitly supplied DRS state, including differing source encodings.
      const states = new Map(l.tel.map((s) => [Math.round(s.t * 1000), s.drsOpen]));
      result.tel.forEach((s) => { s.drsOpen = states.get(Math.round(s.t * 1000)) ?? s.drsOpen; });
      return result;
    }
    const lap = laps.find((l) => l.driver_number === driver && l.lap_number === number);
    const win = lap ? lapWindow(lap, laps) : null;
    if (!win) throw new Error("Il giro non ha un intervallo temporale definito.");
    const from = new Date(win.startMs - MARGIN_S * 1000).toISOString(), to = new Date(win.endMs + MARGIN_S * 1000).toISOString();
    return buildLapData(driver, number, win, await api.carData(session, driver, from, to), await api.location(session, driver, from, to));
  },
};
