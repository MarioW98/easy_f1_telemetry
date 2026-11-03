#!/usr/bin/env python3
"""Export per-session OpenF1 JSON archives (2023+) for browser download.

Produces the SAME per-session format as export_fastf1_sessions.py
(f1-telemetry-lab/v1 envelope, compact mode = fastest lap per driver), so the
site consumes both sources transparently. OpenF1 (api.openf1.org) redistributes
the same F1 livetiming timing/telemetry streams that FastF1 reads: sample rate
(~3.7 Hz), units and coordinate scale are identical. The history store schema
accepts source "FastF1" | "OpenF1".

Use this exporter when the F1 livetiming CDN refuses FastF1 downloads (403
from CloudFront on datacenter IPs) or for seasons with complete OpenF1
coverage (2023 onwards). Sessions come from /meetings + /sessions (pre-season
testing excluded); one session costs ~40 small HTTP requests at ~3 req/s, so a
full season takes roughly 1.5-2.5 hours. Valid files already on disk are
skipped, so the run can be interrupted and resumed freely.

Usage:
  python export_openf1_sessions.py --year 2023 --sessions all
  python export_openf1_sessions.py --year 2023 --sessions all --rounds 1-12
  python export_openf1_sessions.py --year 2024 --sessions all --force

Requires: python -m pip install 'requests>=2.28'
"""
import argparse
import json
import logging
import math
import re
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_fastf1_archive import CIRCUITS  # noqa: E402

FILTERS: dict[str, set[str] | None] = {
    "race": {"Race"},
    "quali": {"Qualifying", "Qualifying Sprint", "Sprint Qualifying", "Sprint Shootout"},
    "race-quali": {"Race", "Qualifying", "Sprint"},
    "race-quali-fp": {"Race", "Qualifying", "Sprint", "Practice 1", "Practice 2", "Practice 3"},
    "all": None,
}
# OpenF1 naming -> FastF1 naming, to keep picker labels consistent across years.
EVENT_OVERRIDES = {"Emilia Romagna Grand Prix": "Emilia-Romagna Grand Prix"}
LOCATION_OVERRIDES = {"Marina Bay": "Singapore", "Monaco": "Monte Carlo"}
MARGIN_S = 1.5  # same window margin as the site (src/lib/telemetry.ts)
BASE_URL = "https://api.openf1.org/v1"


def slug(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", norm.lower()).strip("-") or "session"


def parse_rounds(spec: str) -> set[int]:
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


def num(value) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


class OpenF1Client:
    """Rate-limited GET helper: ~3 req/s, retries on 429/5xx/network errors."""

    def __init__(self, rps: float = 2.9):
        import requests

        self.session = requests.Session()
        self.min_interval = 1.0 / rps
        self.last = 0.0

    def get(self, path: str, **params):
        import requests

        url = BASE_URL + path
        for attempt in range(4):
            wait = self.last + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                res = self.session.get(url, params=params, timeout=40)
            except requests.RequestException as exc:
                if attempt == 3:
                    raise
                delay = 6 * 2**attempt
                logging.warning("Errore di rete (%s), riprovo tra %ss: %s", type(exc).__name__, delay, path)
                time.sleep(delay)
                continue
            if res.status_code == 200:
                return res.json()
            if res.status_code == 404:
                return []
            if res.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                retry_after = res.headers.get("Retry-After", "")
                delay = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else 6 * 2**attempt
                logging.warning("HTTP %s da OpenF1, riprovo tra %.0fs: %s", res.status_code, delay, path)
                time.sleep(delay)
                continue
            res.raise_for_status()
        return []


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso_param(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def dedupe_sort(samples: list[dict]) -> list[dict]:
    out, last_t = [], None
    for s in sorted(samples, key=lambda x: x["t"]):
        if last_t is not None and s["t"] <= last_t:
            continue
        last_t = s["t"]
        out.append(s)
    return out


def export_session(client: OpenF1Client, sess: dict, year: int, event: str, circuit: str) -> dict:
    sk = sess["session_key"]
    session_start = parse_iso(sess["date_start"])
    drivers_rows = client.get("/drivers", session_key=sk)
    laps_rows = client.get("/laps", session_key=sk)
    drivers_by_number = {d["driver_number"]: d for d in drivers_rows}

    # Fastest valid lap per driver (compact mode).
    best: dict[int, tuple[float, dict]] = {}
    for row in laps_rows:
        duration = num(row.get("lap_duration"))
        if duration is None or duration <= 0 or not row.get("date_start"):
            continue
        n = row["driver_number"]
        if n not in drivers_by_number:
            continue
        if n not in best or duration < best[n][0]:
            best[n] = (duration, row)
    items = []
    for n, (duration, lap) in best.items():
        start = parse_iso(lap["date_start"])
        items.append(dict(n=n, duration=duration, lap=lap, start=start,
                          w0=start - timedelta(seconds=MARGIN_S),
                          w1=start + timedelta(seconds=duration + MARGIN_S)))
    if not items:
        raise ValueError("Nessun giro misurato disponibile")

    # Batch the per-driver time windows into a few wide windows (span cap 240 s):
    # one /car_data + one /location call per group returns every driver on track,
    # which cuts requests from ~40 per session to ~4-20 and keeps OpenF1 happy.
    items.sort(key=lambda it: it["w0"])
    groups: list[list[dict]] = []
    for it in items:
        if groups:
            g = groups[-1]
            span = max(it["w1"], max(x["w1"] for x in g)) - g[0]["w0"]
            if span <= timedelta(seconds=240):
                g.append(it)
                continue
        groups.append([it])
    streams: dict[int, tuple[list, list]] = {}
    for g in groups:
        window = {"date>": iso_param(min(x["w0"] for x in g)),
                  "date<": iso_param(max(x["w1"] for x in g))}
        members = {x["n"] for x in g}
        car_rows = client.get("/car_data", session_key=sk, **window)
        loc_rows = client.get("/location", session_key=sk, **window)
        for c in car_rows:
            if c.get("driver_number") in members:
                streams.setdefault(c["driver_number"], [[], []])[0].append(c)
        for c in loc_rows:
            if c.get("driver_number") in members:
                streams.setdefault(c["driver_number"], [[], []])[1].append(c)

    drivers, laps = [], []
    for it in items:
        n, duration, start = it["n"], it["duration"], it["start"]
        drv = drivers_by_number[n]
        car_rows, loc_rows = streams.get(n, ([], []))
        tel, pos = [], []
        for c in car_rows:
            t = round((parse_iso(c["date"]) - start).total_seconds(), 3)
            if t < -MARGIN_S or t > duration + MARGIN_S:
                continue
            drs = c.get("drs")
            tel.append(dict(t=t, speed=num(c.get("speed")), throttle=num(c.get("throttle")),
                            brake=None if c.get("brake") is None else int(bool(c["brake"])),
                            rpm=num(c.get("rpm")), gear=num(c.get("n_gear")), drs=num(drs),
                            drsOpen=None if drs is None else int(drs >= 10)))
        for c in loc_rows:
            t = round((parse_iso(c["date"]) - start).total_seconds(), 3)
            x, y = c.get("x"), c.get("y")
            if t < -MARGIN_S or t > duration + MARGIN_S or x is None or y is None or (x == 0 and y == 0):
                continue
            pos.append(dict(t=t, x=float(x), y=float(y)))
        tel, pos = dedupe_sort(tel), dedupe_sort(pos)
        if not any(0 <= s["t"] <= duration for s in tel):
            logging.warning("Nessuna telemetria nel giro: %s #%s giro %s", sess["session_name"], n, it["lap"]["lap_number"])
            continue
        laps.append(dict(driver=int(n), lapNumber=int(it["lap"]["lap_number"]), startMs=int(start.timestamp() * 1000),
                         duration=duration, durationOfficial=True, tel=tel, pos=pos))
        full_name = f'{drv.get("first_name", "")} {drv.get("last_name", "")}'.strip()
        drivers.append(dict(driver_number=int(n), name_acronym=drv["name_acronym"],
                            full_name=full_name or drv["full_name"],
                            team_name=drv.get("team_name"), team_colour=drv.get("team_colour")))
    if not laps:
        raise ValueError("Nessun giro con telemetria disponibile")
    return dict(year=year, event=event, circuit=circuit, session=sess["session_name"],
                date=session_start.strftime("%Y-%m-%dT%H:%M:%SZ"), drivers=drivers, laps=laps)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--year", required=True, type=int, choices=range(2023, 2027))
    parser.add_argument("--mode", choices=["compact"], default="compact",
                        help="compact = giro più veloce per pilota (l'unica modalità implementata)")
    parser.add_argument("--sessions", choices=sorted(FILTERS), default="all",
                        help="quali sessioni dell'anno esportare (default: tutte, prove incluse)")
    parser.add_argument("--rounds", default="",
                        help="es. '1-12,14': solo questi Gran Premi (numerati in ordine cronologico)")
    parser.add_argument("--rps", type=float, default=2.9, help="richieste al secondo verso OpenF1 (max consigliato 3)")
    parser.add_argument("--output-dir",
                        default=str(Path(__file__).resolve().parent.parent / "data" / "archives"))
    parser.add_argument("--force", action="store_true",
                        help="riesporta anche le sessioni già presenti su disco (default: salta i file validi)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = OpenF1Client(args.rps)
    out_dir = Path(args.output_dir)
    year_dir = out_dir / str(args.year)
    year_dir.mkdir(parents=True, exist_ok=True)
    wanted = FILTERS[args.sessions]
    rounds = parse_rounds(args.rounds) if args.rounds.strip() else None

    meetings = [m for m in client.get("/meetings", year=args.year) if "Testing" not in m["meeting_name"]]
    meetings.sort(key=lambda m: (m["date_start"], m["meeting_key"]))
    sessions_by_meeting: dict[int, list[dict]] = defaultdict(list)
    for s in client.get("/sessions", year=args.year):
        if not s.get("is_cancelled"):
            sessions_by_meeting[s["meeting_key"]].append(s)

    exported, skipped, errors = 0, 0, 0
    for rnd, meeting in enumerate(meetings, 1):
        if rounds and rnd not in rounds:
            continue
        event = EVENT_OVERRIDES.get(meeting["meeting_name"], meeting["meeting_name"])
        location = LOCATION_OVERRIDES.get(meeting["location"], meeting["location"])
        circuit = CIRCUITS.get(location, location)
        for sess in sorted(sessions_by_meeting.get(meeting["meeting_key"], []), key=lambda s: s["date_start"]):
            name = sess["session_name"]
            if wanted is not None and name not in wanted:
                continue
            path = year_dir / f"{rnd:02d}-{slug(event)}-{slug(name)}.json"
            if path.exists() and not args.force:
                try:
                    if json.loads(path.read_text(encoding="utf-8")).get("format") == "f1-telemetry-lab/v1":
                        skipped += 1
                        continue
                except Exception:
                    logging.warning("File esistente illeggibile, lo riesporto: %s", path.name)
            try:
                payload = export_session(client, sess, args.year, event, circuit)
                blob = {"format": "f1-telemetry-lab/v1", "source": "OpenF1", **payload}
                path.write_text(json.dumps(blob, separators=(",", ":"), allow_nan=False), encoding="utf-8")
                exported += 1
                logging.info("Esportata %s r%02d %s %s: %s giri (%.1f MB)", args.year, rnd, event, name,
                             len(payload["laps"]), path.stat().st_size / 1048576)
            except Exception:
                errors += 1
                logging.exception("Saltata %s r%02d %s %s", args.year, rnd, event, name)

    # Rebuild the manifest from every per-session file on disk (all years).
    entries: list[dict] = []
    for path in sorted(out_dir.glob("[0-9][0-9][0-9][0-9]/*.json")):
        if path.name == "manifest.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logging.warning("File illeggibile, escluso dal manifest: %s", path)
            continue
        if data.get("format") != "f1-telemetry-lab/v1":
            continue
        meta = {k: data[k] for k in ["year", "event", "circuit", "session", "date"]}
        entries.append({**meta, "file": path.relative_to(out_dir).as_posix(),
                        "bytes": path.stat().st_size,
                        "drivers": len(data.get("drivers", [])), "laps": len(data.get("laps", []))})
    entries.sort(key=lambda e: (e["year"], e["date"]))
    manifest = {"format": "f1-telemetry-lab/repo-manifest/v1",
                "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "sessions": entries}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":"), ensure_ascii=False),
                                           encoding="utf-8")
    total = sum(e["bytes"] for e in entries)
    logging.info("Manifest: %s sessioni, %.1f MB totali nel repository (esportate ora: %s, già presenti: %s, errori: %s)",
                 len(entries), total / 1048576, exported, skipped, errors)


if __name__ == "__main__":
    main()
