#!/usr/bin/env python3
"""Export locale degli archivi 2018, 2019 e 2020 (FastF1, mode compact).

Perche' uno script separato: dal 15/10/2026 l'archivio livetiming.formula1.com
richiede l'autenticazione F1 TV (401/403 senza token) e il mirror pubblico di
FastF1 copre solo 2021-2022. Gli anni 2018-2020 si possono quindi esportare
SOLO in locale con un account F1 TV (Access o superiore).

Cosa fa:
  1. Verifica fastf1 >= 3.9 (versione con supporto all'autenticazione).
  2. Verifica che esista un token F1 TV valido (python -m fastf1 auth f1tv).
  3. Per ogni anno lancia export_fastf1_sessions.py con --sessions all
     in piu' tentativi da 15 minuti: i file gia' validi su disco vengono
     saltati, quindi il progresso e' cumulativo ed e' possibile ri-lanciare.
     Si ferma su un anno solo dopo 2 tentativi consecutivi senza progresso
     (sessioni veramente prive di dati).

Uso:
  python -m pip install "fastf1>=3.9,<4"
  python -m fastf1 auth f1tv --authenticate     # una volta; token ~4 giorni
  python export_2018_2019_2020.py

Opzionale (login non interattivo): variabili d'ambiente F1_USERNAME e
F1_PASSWORD prima di --authenticate. Le credenziali restano sul tuo computer:
FastF1 le invia solo a Formula 1 e non le salva.

Alla fine di ogni anno il manifest.json globale viene rigenerato
automaticamente dallo script di export (tutti gli anni presenti su disco).
"""
from __future__ import annotations

import subprocess
import sys
import time
from importlib import metadata
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPORTER = HERE / "export_fastf1_sessions.py"
ARCHIVES = HERE.parent / "data" / "archives"

YEARS: dict[int, int] = {2018: 105, 2019: 110, 2020: 85}  # anno -> sessioni attese
ATTEMPT_SECONDS = 900   # 15 minuti per tentativo (kill = riprende dal file successivo)
MAX_ATTEMPTS = 8
PAUSE_BETWEEN = 30      # secondi tra un tentativo e l'altro


def fail(msg: str) -> None:
    print(f"\n[FERMO] {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_environment() -> None:
    if not EXPORTER.exists():
        fail(f"Non trovo {EXPORTER.name} accanto a questo script.")
    try:
        version = metadata.version("fastf1")
    except metadata.PackageNotFoundError:
        fail("fastf1 non installato. Esegui: python -m pip install \"fastf1>=3.9,<4\"")
    if tuple(int(p) for p in version.split(".")[:2]) < (3, 9):
        fail(f"fastf1 {version} non supporta l'autenticazione F1 TV "
             "(serve >= 3.9). Esegui: python -m pip install \"fastf1>=3.9,<4\"")
    status = subprocess.run(
        [sys.executable, "-m", "fastf1", "auth", "f1tv", "--status"],
        capture_output=True, text=True,
    )
    output = (status.stdout + status.stderr).lower()
    if "not authenticated" in output or status.returncode != 0 and "authenticated" not in output:
        fail(
            "Token F1 TV assente o scaduto. Autenticati prima di rieseguire:\n"
            "    python -m fastf1 auth f1tv --authenticate\n"
            "(richiede un abbonamento F1 TV Access o superiore; il token dura "
            "circa 4 giorni, poi occorre rifare il login.)"
        )
    print(f"Ambiente OK: fastf1 {version}, token F1 TV presente.")


def count_files(year: int) -> int:
    return len(list((ARCHIVES / str(year)).glob("*.json")))


def export_year(year: int, wanted: int) -> None:
    cache = HERE / ".cache-fastf1" / str(year)
    cache.mkdir(parents=True, exist_ok=True)
    prev, zero_streak = -1, 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        print(f"[{year}] tentativo {attempt}/{MAX_ATTEMPTS} "
              f"(gia' presenti: {count_files(year)}/{wanted} file)...")
        try:
            subprocess.run(
                [sys.executable, str(EXPORTER),
                 "--year", str(year), "--sessions", "all",
                 "--mode", "compact", "--cache", str(cache)],
                timeout=ATTEMPT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired:
            print(f"[{year}] tentativo interrotto dopo {ATTEMPT_SECONDS}s: "
                  "si riprende dal file successivo.")
        done = count_files(year)
        print(f"[{year}] tentativo {attempt} completato: {done}/{wanted} file.")
        if done >= wanted:
            break
        zero_streak = zero_streak + 1 if done == prev else 0
        if zero_streak >= 2:
            print(f"[{year}] nessun progresso in 2 tentativi consecutivi: "
                  "le sessioni rimanenti sono probabilmente prive di dati "
                  "nell'archivio F1 (normale per qualche FP1 o sessione breve).")
            break
        prev = done
        time.sleep(PAUSE_BETWEEN)
    for cache_dir in (HERE / ".cache-fastf1").glob(str(year)):
        import shutil
        shutil.rmtree(cache_dir, ignore_errors=True)


def main() -> None:
    check_environment()
    for year, wanted in YEARS.items():
        print(f"\n=== {year} ===")
        export_year(year, wanted)
    print("\n=== RIEPILOGO ===")
    for year, wanted in YEARS.items():
        print(f"  {year}: {count_files(year)}/{wanted} sessioni "
              f"in {ARCHIVES / str(year)}")
    print("\nIl manifest.json e' stato rigenerato con tutti gli anni su disco.")
    print("Prossimo passo: commit e push degli archivi (o deploy via workflow).")


if __name__ == "__main__":
    main()
