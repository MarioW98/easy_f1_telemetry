#!/usr/bin/env python3
"""Export per-session FastF1 JSON archives (2018-2022) for browser download.

Each requested session becomes ONE small JSON file (v1 envelope) under
public/data/archives/<year>/ and manifest.json is rebuilt from every file on
disk. Default mode is 'compact' (fastest lap per driver): the raw FastF1
download per session is inevitably the full car/position streams, but only the
compact result is committed to the repository — keep --sessions race (default)
and use --rounds to split a season across several runs if needed.

Usage:
  python export_fastf1_sessions.py --year 2021
  python export_fastf1_sessions.py --year 2021 --rounds 1-12 --sessions race

Requires: python -m pip install 'fastf1>=3.4,<4'
"""
import argparse
import json
import logging
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_fastf1_archive import extract_session  # noqa: E402

FILTERS: dict[str, set[str] | None] = {
    "race": {"Race"},
    "quali": {"Qualifying", "Qualifying Sprint", "Sprint Qualifying", "Sprint Shootout"},
    "race-quali": {"Race", "Qualifying", "Sprint"},
    "all": None,
}


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--year", required=True, type=int, choices=range(2018, 2023))
    parser.add_argument("--mode", choices=["compact", "full"], default="compact",
                        help="compact = giro più veloce per pilota (file piccoli, consigliata)")
    parser.add_argument("--sessions", choices=sorted(FILTERS), default="race",
                        help="quali sessioni dell'anno esportare (default: solo gare)")
    parser.add_argument("--rounds", default="",
                        help="es. '1-12,14': elabora solo questi round per spezzare l'anno in più esecuzioni")
    parser.add_argument("--output-dir",
                        default=str(Path(__file__).resolve().parent.parent / "data" / "archives"))
    parser.add_argument("--cache", default=str(Path.home() / ".cache" / "f1-telemetry-lab"))
    args = parser.parse_args()

    import fastf1
    import pandas as pd

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache))
    out_dir = Path(args.output_dir)
    year_dir = out_dir / str(args.year)
    year_dir.mkdir(parents=True, exist_ok=True)
    wanted = FILTERS[args.sessions]
    rounds = parse_rounds(args.rounds) if args.rounds.strip() else None

    exported, errors = 0, 0
    schedule = fastf1.get_event_schedule(args.year, include_testing=False)
    for _, event in schedule.iterrows():
        rnd = int(event.RoundNumber)
        if rnd <= 0:
            continue
        if rounds and rnd not in rounds:
            continue
        for slot in range(1, 6):
            name = event.get(f"Session{slot}")
            if pd.isna(name) or not str(name).strip():
                continue
            if wanted is not None and str(name) not in wanted:
                continue
            try:
                session = event.get_session(slot)
                session.load(weather=False, messages=False)
                payload = extract_session(session, args.year, args.mode)
                blob = {"format": "f1-telemetry-lab/v1", "source": "FastF1", **payload}
                path = year_dir / f"{rnd:02d}-{slug(str(event.EventName))}-{slug(str(name))}.json"
                path.write_text(json.dumps(blob, separators=(",", ":"), allow_nan=False), encoding="utf-8")
                exported += 1
                logging.info("Esportata %s %s %s: %s giri (%.1f MB)",
                             args.year, event.EventName, name, len(payload["laps"]), path.stat().st_size / 1048576)
                del payload, blob, session
            except Exception:
                errors += 1
                logging.exception("Saltata %s %s %s", args.year, event.EventName, name)

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
    logging.info("Manifest: %s sessioni, %.1f MB totali nel repository (esportate ora: %s, errori: %s)",
                 len(entries), total / 1048576, exported, errors)
    for e in entries:
        if e["bytes"] > 60 * 1024 * 1024:
            logging.warning("File oltre 60 MB (limite browser 64 MB): %s", e["file"])
    if exported == 0 and errors > 0 and not entries:
        raise SystemExit("Nessuna sessione esportata: controlla il log.")


if __name__ == "__main__":
    main()
