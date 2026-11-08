"""Export private FastF1 archives (2018-2026); no redistribution rights granted.
Install: python -m pip install 'fastf1>=3.4,<4'
Default: python export_fastf1_archive.py --output archive.zip
Compact JSON: python export_fastf1_archive.py --mode compact --container json --output archive.json
ZIP retains all selected samples and supports lazy browser loading; recommended for full mode.
All five seasons and scheduled sessions (including sprint) are attempted by default.
"""
import argparse
import json
import logging
import math
import tempfile
import zipfile
from pathlib import Path

CIRCUITS = {
    "Melbourne": "Melbourne", "Sakhir": "Sakhir", "Shanghai": "Shanghai", "Baku": "Baku",
    "Barcelona": "Catalunya", "Monte Carlo": "Monte Carlo", "Montréal": "Montreal", "Montreal": "Montreal",
    "Le Castellet": "Paul Ricard", "Spielberg": "Spielberg", "Silverstone": "Silverstone", "Hockenheim": "Hockenheim",
    "Budapest": "Hungaroring", "Spa-Francorchamps": "Spa-Francorchamps", "Monza": "Monza", "Sochi": "Sochi",
    "Singapore": "Singapore", "Suzuka": "Suzuka", "Austin": "Austin", "Mexico City": "Mexico City",
    "São Paulo": "Interlagos", "Sao Paulo": "Interlagos", "Yas Island": "Yas Marina Circuit",
    "Imola": "Imola", "Portimão": "Portimao", "Portimao": "Portimao", "Mugello": "Mugello",
    "Nürburg": "Nurburgring", "Istanbul": "Istanbul", "Zandvoort": "Zandvoort", "Lusail": "Lusail", "Jeddah": "Jeddah",
}

def choose_laps(candidates, mode):
    if mode == "compact":
        fastest = candidates.pick_fastest()
        return [] if fastest is None else [fastest]
    return [lap for _, lap in candidates.iterrows()]

def extract_session(session, year, mode):
    import pandas as pd
    def num(value):
        return float(value) if pd.notna(value) and math.isfinite(float(value)) else None
    def text(value):
        return str(value) if pd.notna(value) else None
    drivers, laps = [], []
    for _, result in session.results.iterrows():
        number = str(result.DriverNumber)
        # Timed non-deleted laps with original start dates; do not exclude slow or pit laps.
        candidates = session.laps.pick_drivers(number)
        candidates = candidates[candidates.LapStartDate.notna() & candidates.LapTime.notna() & (candidates.LapTime > pd.Timedelta(0))]
        if "Deleted" in candidates:
            candidates = candidates[~candidates.Deleted.astype("boolean").fillna(False).astype(bool)]
        before = len(laps)
        for lap in choose_laps(candidates, mode):
            start, duration = lap.LapStartDate, lap.LapTime.total_seconds()
            def samples(frame):
                if frame is None:
                    return []
                data = frame[(frame.Date >= start - pd.Timedelta(seconds=1.5)) & (frame.Date <= start + pd.Timedelta(seconds=duration + 1.5))]
                return data.drop_duplicates("Date").sort_values("Date").iterrows()
            tel, pos = [], []
            for _, s in samples(session.car_data.get(number)):
                drs = num(s.DRS)
                tel.append(dict(t=(s.Date-start).total_seconds(), speed=num(s.Speed), throttle=num(s.Throttle),
                    brake=None if pd.isna(s.Brake) else int(bool(s.Brake)), rpm=num(s.RPM), gear=num(s.nGear),
                    drs=drs, drsOpen=None if drs is None else int(drs >= 10)))
            for _, s in samples(session.pos_data.get(number)):
                x, y = num(s.X), num(s.Y)
                if x is not None and y is not None and (x != 0 or y != 0):
                    pos.append(dict(t=(s.Date-start).total_seconds(), x=x, y=y))
            if not any(0 <= s["t"] <= duration for s in tel):
                logging.warning("No in-lap telemetry: driver %s lap %s", number, lap.LapNumber)
                continue
            # Optional tyre fields (v1 schema): compound as reported by FastF1
            # (UNKNOWN/TEST_UNKNOWN stay as-is, the site normalises them), tyre
            # age in laps from TyreLife. Absent/NaN -> None (unknown).
            compound = text(lap.get("Compound"))
            tyre_life = num(lap.get("TyreLife"))
            laps.append(dict(driver=int(number), lapNumber=int(lap.LapNumber), startMs=int(start.timestamp()*1000),
                duration=duration, durationOfficial=True, tel=tel, pos=pos,
                compound=compound, tyreAge=None if tyre_life is None else int(round(tyre_life))))
        if len(laps) > before:
            drivers.append(dict(driver_number=int(number), name_acronym=str(result.Abbreviation), full_name=str(result.FullName),
                team_name=text(result.TeamName), team_colour=text(result.TeamColor)))
    if not laps:
        raise ValueError("No measured laps available")
    date = pd.Timestamp(session.date)
    date = date.tz_localize("UTC") if date.tzinfo is None else date.tz_convert("UTC")
    location = str(session.event.Location)
    return dict(year=year, event=str(session.event.EventName), circuit=CIRCUITS.get(location, location), session=session.name,
        date=date.isoformat().replace("+00:00", "Z"), drivers=drivers, laps=laps)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", choices=["full", "compact"], default="full")
    parser.add_argument("--container", choices=["json", "zip"], default="zip")
    parser.add_argument("--years", nargs="+", type=int, choices=range(2018, 2027), default=list(range(2018, 2027)))
    parser.add_argument("--cache", default=str(Path.home()/".cache"/"f1-telemetry-lab"))
    args = parser.parse_args()
    import fastf1
    import pandas as pd
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, handlers=[logging.FileHandler(str(out)+".log", encoding="utf-8"), logging.StreamHandler()])
    cache = Path(args.cache); cache.mkdir(parents=True, exist_ok=True); fastf1.Cache.enable_cache(str(cache))
    header = dict(format="f1-telemetry-lab/archive-v2", source="FastF1", fastf1Version=fastf1.__version__, mode=args.mode,
        sampleProvenance="Original car_data/pos_data per lap; no resampling", years=[], sessions=[])
    errors, total_laps, raw_bytes = [], 0, 0
    with tempfile.TemporaryDirectory(prefix="f1-export-") as temp:
        paths = []
        for year in sorted(set(args.years)):
            try:
                schedule = fastf1.get_event_schedule(year, include_testing=False)
            except Exception as exc:
                errors.append(dict(year=year, error=str(exc))); logging.exception("Calendar %s unavailable", year); continue
            for _, event in schedule.iterrows():
                if int(event.RoundNumber) <= 0:
                    continue
                for slot in range(1, 6):
                    name = event.get(f"Session{slot}")
                    if pd.isna(name) or not str(name).strip():
                        continue
                    try:
                        session = event.get_session(slot)
                        session.load(weather=False, messages=False)
                        payload = extract_session(session, year, args.mode)
                        path = Path(temp)/f"session_{len(paths):04d}.json"
                        path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
                        meta = {k: payload[k] for k in ["year", "event", "circuit", "session", "date"]}
                        header["sessions"].append(dict(**meta, file=f"sessions/{path.name}"))
                        paths.append(path); total_laps += len(payload["laps"]); raw_bytes += path.stat().st_size
                        logging.info("Exported %s %s %s: %s laps", year, event.EventName, name, len(payload["laps"]))
                        del payload, session
                    except Exception as exc:
                        errors.append(dict(year=year, event=str(event.EventName), session=str(name), error=str(exc)))
                        logging.exception("Skipped %s %s %s", year, event.EventName, name)
        if not paths:
            raise SystemExit("No measured session exported; inspect the .log file")
        header["years"] = sorted(set(s["year"] for s in header["sessions"]))
        header["errors"] = errors
        if args.container == "zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as bundle:
                bundle.writestr("manifest.json", json.dumps(header, separators=(",", ":"), allow_nan=False))
                for path in paths:
                    bundle.write(path, f"sessions/{path.name}")
        else:
            # Stream session JSONs into one output: never hold five seasons in RAM.
            metadata = {k: v for k, v in header.items() if k != "sessions"}
            with out.open("w", encoding="utf-8") as stream:
                stream.write(json.dumps(metadata, separators=(",", ":"))[:-1] + ',"sessions":[')
                for i, path in enumerate(paths):
                    if i: stream.write(",")
                    with path.open(encoding="utf-8") as source:
                        while chunk := source.read(1024*1024): stream.write(chunk)
                stream.write("]}")
        print(f"Mode={args.mode}; sessions={len(paths)}; laps={total_laps}; errors={len(errors)}")
        print(f"Archive disk size={out.stat().st_size:,} bytes; uncompressed session JSON={raw_bytes:,} bytes")
        if args.container == "json" and out.stat().st_size > 64*1024*1024:
            print("Browser JSON limit exceeded: export again with --container zip (no samples removed).")
        if raw_bytes > 1024*1024*1024:
            print("Large archive: use ZIP and allow enough disk for cache and temporary uncompressed sessions.")

if __name__ == "__main__":
    main()
