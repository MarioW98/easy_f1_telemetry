"""Export original FastF1 samples for private import into F1 Telemetry Lab.

Install: python -m pip install 'fastf1>=3.4,<4'
Example: python export_fastf1.py --year 2022 --event Monza --session Q --circuit Monza --output monza-2022.json
Use the exact OpenF1 circuit_short_name for --circuit to enable cross-year matching.
Only each driver's fastest timed lap is exported. No resampling or position reconstruction.
FastF1 supports 2018 onward, not every historical session is complete.
Formula 1 timing data has separate rights from FastF1's MIT software licence.
Use only data you are entitled to access and use; this script does not grant redistribution rights.
"""
import argparse
import json
import math
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, choices=range(2018, 2023), required=True)
    parser.add_argument("--event", required=True)
    parser.add_argument("--session", default="Q")
    parser.add_argument("--circuit", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    import fastf1
    import pandas as pd
    cache = Path.home() / ".cache" / "f1-telemetry-lab"
    cache.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache))
    session = fastf1.get_session(args.year, args.event, args.session)
    session.load(weather=False, messages=False)
    def num(value):
        return float(value) if pd.notna(value) and math.isfinite(float(value)) else None
    def text(value):
        return str(value) if pd.notna(value) else None
    drivers, laps = [], []
    for _, result in session.results.iterrows():
        number = str(result.DriverNumber)
        candidates = session.laps.pick_drivers(number).pick_accurate()
        if candidates.empty:
            continue
        lap = candidates.pick_fastest()
        if lap is None or pd.isna(lap.LapStartDate) or pd.isna(lap.LapTime):
            continue
        start = lap.LapStartDate
        duration = lap.LapTime.total_seconds()
        def raw_samples(frame):
            if frame is None:
                return []
            data = frame[(frame.Date >= start - pd.Timedelta(seconds=1.5)) & (frame.Date <= start + pd.Timedelta(seconds=duration + 1.5))]
            return data.drop_duplicates("Date").sort_values("Date").iterrows()
        tel, pos = [], []
        for _, s in raw_samples(session.car_data.get(number)):
            drs = num(s.DRS)
            tel.append(dict(t=(s.Date-start).total_seconds(), speed=num(s.Speed), throttle=num(s.Throttle),
                brake=None if pd.isna(s.Brake) else int(bool(s.Brake)), rpm=num(s.RPM), gear=num(s.nGear),
                drs=drs, drsOpen=None if drs is None else int(drs >= 10)))
        for _, s in raw_samples(session.pos_data.get(number)):
            x, y = num(s.X), num(s.Y)
            if x is not None and y is not None and (x != 0 or y != 0):
                pos.append(dict(t=(s.Date-start).total_seconds(), x=x, y=y))
        if not tel:
            continue
        drivers.append(dict(driver_number=int(number), name_acronym=str(result.Abbreviation), full_name=str(result.FullName),
            team_name=text(result.TeamName), team_colour=text(result.TeamColor)))
        # Optional tyre fields (v1 schema), same semantics as export_fastf1_archive.py.
        compound = text(lap.get("Compound"))
        tyre_life = num(lap.get("TyreLife"))
        laps.append(dict(driver=int(number), lapNumber=int(lap.LapNumber), startMs=int(start.timestamp()*1000),
            duration=duration, durationOfficial=True, tel=tel, pos=pos,
            compound=compound, tyreAge=None if tyre_life is None else int(round(tyre_life))))
    if not laps:
        raise SystemExit("No measured telemetry available for this session.")
    payload = dict(format="f1-telemetry-lab/v1", source="FastF1", fastf1Version=fastf1.__version__,
        sampleProvenance="Original car_data and pos_data; no resampling", year=args.year,
        event=str(session.event.EventName), circuit=args.circuit, session=session.name,
        date=pd.Timestamp(session.date).isoformat() + "Z", drivers=drivers, laps=laps)
    Path(args.output).write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"Exported {len(laps)} original fastest laps to {args.output}")

if __name__ == "__main__":
    main()