// OpenF1 client: in-memory cache, serialized request queue (rate limit), timeouts, typed errors.
const BASE = "https://api.openf1.org/v1";
const MIN_GAP_MS = 400; // free tier ≈ 3 req/s
const TIMEOUT_MS = 25000;

export type ApiErrorKind = "network" | "rate_limit" | "http" | "timeout";
export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface Meeting {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name?: string;
  country_name: string;
  circuit_short_name: string;
  circuit_key?: number;
  date_start: string;
  year: number;
}
export interface Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  is_cancelled?: boolean;
}
export interface Driver {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string | null;
  team_colour: string | null;
}
export interface Lap {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  is_pit_out_lap: boolean | null;
}
export interface CarData {
  date: string;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  rpm: number | null;
  n_gear: number | null;
  drs: number | null;
}
export interface Location {
  date: string;
  x: number | null;
  y: number | null;
  z: number | null;
}

const cache = new Map<string, Promise<unknown>>();
let chain: Promise<void> = Promise.resolve();
let last = 0;

function slot(): Promise<void> {
  const p = chain.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  });
  chain = p.catch(() => undefined);
  return p;
}

async function doFetch<T>(url: string, attempt = 0): Promise<T> {
  await slot();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError")
      throw new ApiError("timeout", "La richiesta ha impiegato troppo tempo.");
    throw new ApiError("network", "Errore di rete: impossibile contattare OpenF1.");
  } finally {
    clearTimeout(to);
  }
  if (res.status === 429) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return doFetch<T>(url, attempt + 1);
    }
    throw new ApiError(
      "rate_limit",
      "Limite di richieste OpenF1 raggiunto. Attendi qualche secondo e riprova.",
      429,
    );
  }
  // OpenF1 returns 404 with {"detail":"No results found."} for empty results
  if (res.status === 404) return [] as T;
  if (!res.ok)
    throw new ApiError("http", `OpenF1 ha risposto con errore HTTP ${res.status}.`, res.status);
  const json = await res.json();
  return (Array.isArray(json) ? json : []) as T;
}

export function get<T>(
  path: string,
  params: Record<string, string | number> = {},
  raw: string[] = [],
): Promise<T> {
  const qs = [
    ...Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`),
    ...raw, // pre-built filters like date>=...
  ].join("&");
  const url = `${BASE}/${path}${qs ? "?" + qs : ""}`;
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const p = doFetch<T>(url);
  cache.set(url, p);
  p.catch(() => cache.delete(url)); // allow retry
  return p;
}

export const api = {
  meetings: (year: number) => get<Meeting[]>("meetings", { year }),
  sessions: (meeting_key: number) => get<Session[]>("sessions", { meeting_key }),
  drivers: (session_key: number) => get<Driver[]>("drivers", { session_key }),
  laps: (session_key: number) => get<Lap[]>("laps", { session_key }),
  carData: (session_key: number, driver_number: number, from: string, to: string) =>
    get<CarData[]>("car_data", { session_key, driver_number }, [`date>=${from}`, `date<=${to}`]),
  location: (session_key: number, driver_number: number, from: string, to: string) =>
    get<Location[]>("location", { session_key, driver_number }, [`date>=${from}`, `date<=${to}`]),
};
