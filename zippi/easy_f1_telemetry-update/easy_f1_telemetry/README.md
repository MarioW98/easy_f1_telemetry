# F1 Telemetry Lab

Confronta fino a quattro giri di Formula 1 sullo stesso circuito, anche di annate differenti:
telemetria OpenF1 dal 2023 e archivi FastF1 2018–2022, con riproduzione sincronizzata,
mappe del tracciato con traiettorie cliccabili e grafici (speed, throttle, brake, RPM, marcia, DRS).

App completamente client-side: nessun backend, nessuna registrazione, nessuna API key.

## Le due fonti dati

In alto a destra l'interruttore sceglie da dove arrivano i dati (la scelta viene salvata nel browser):

- **OpenF1 Live** (2023–oggi): API pubblica [OpenF1](https://openf1.org), tier gratuito ≈ 3 richieste/secondo (il client mette in coda e mette in cache da solo).
- **Dati Locali** (2018–2022): archivi FastF1 in formato JSON per sessione, due modi per averli:
  1. **Archivi** (pulsante nell'header): elenca le sessioni pubblicate in questo repository (`public/data/archives/`, descritte da `manifest.json`) e scarica solo quelle che ti interessano — tipicamente 1–4 MB a sessione, giro più veloce per pilota;
  2. **Importa archivio**: carica un file `.json` o `.zip` generato in locale con gli script in `public/history/` (modalità completa o compatta).

I selettori di anno/GP/sessione mostrano solo ciò che la fonte attiva può fornire; se una fonte non ha
i dati, l'app lo dice chiaramente e suggerisce l'altra.

## Pubblicazione su GitHub Pages

Il repository include il workflow `.github/workflows/deploy.yml`, che a ogni push su `main`:

1. installa le dipendenze ed esegue `npm run build` con `--base=/<nome-repo>/`;
2. pubblica il contenuto di `dist/` su GitHub Pages.

Per attivarlo basta una volta sola: **Settings → Pages → Source: GitHub Actions**.
Il sito sarà disponibile su `https://<utente>.github.io/<nome-repo>/`.

## Generare gli archivi storici (workflow «Update F1 Archives»)

Il workflow `.github/workflows/update-archives.yml` si esegue a mano (**Actions → Update F1 Archives → Run workflow**) e produce i JSON per sessione consumati dal pulsante «Archivi»:

| Input | Significato |
| --- | --- |
| `year` | anno da esportare (2018–2022), uno per esecuzione |
| `mode` | `compact` (default: giro più veloce per pilota, file piccoli) o `full` (tutti i giri: file molto grandi, evita su gare) |
| `sessions` | `race` (default: solo gare), `quali`, `race-quali`, `all` |
| `rounds` | opzionale, es. `1-12,14`: elabora solo quei round per spezzare un anno in più esecuzioni |

Note importanti:

- **Il download grezzo di FastF1 è per sessione intera** (car_data/pos_data non si possono richiedere parziali): sono i "decine di GB" all'anno. Succede solo sul runner GitHub durante la generazione — nel repository vengono committati **solo i JSON compatti** (per un'intera annata in `race` + `compact`: decine di MB, non GB).
- Default prudenziali: `race` + `compact` + un anno per volta. Se un run avvicina il limite di tempo, riesegui lo stesso anno con `rounds=1-12` e poi `rounds=13-24`.
- Il workflow rifà il commit automaticamente in `public/data/archives/` e rigenera `manifest.json`; nessun file può superare 95 MB (guardia integrata).
- Dopo il commit il sito si aggiorna col nuovo deploy e le sessioni compaiono nel pulsante «Archivi».

## Sviluppo locale

Serve Node.js 20+ e npm.

```sh
git clone <url-del-repository>
cd <nome-repository>
npm install
npm run dev
```

Altri comandi:

```sh
npm run build     # build di produzione in dist/
npm run preview   # anteprima locale della build
npm run test      # test con Vitest
npm run lint      # ESLint + Prettier
```

## Script di esportazione (uso locale)

Nella cartella `public/history/`:

- `export_fastf1_archive.py` — archivio annuale completo/compatto (`.zip` o `.json`), per l'import manuale;
- `export_fastf1_sessions.py` — **un JSON per sessione + manifest**, lo stesso formato usato dal workflow per il repository;
- `export_fastf1.py` — esportatore di sessione singola.

Richiedono Python 3 con `pip install 'fastf1>=3.4,<4'`.

## Architettura

- `src/store/appStore.ts` — stato globale (Zustand): fonte attiva, selezione anno/GP/sessione, slot piloti, preferenze persistenti;
- `src/services/` — layer dati: `dataSource.ts` (interfaccia), `openf1Source.ts`, `localArchiveSource.ts`, `repoArchives.ts` (manifest + download);
- `src/hooks/useTelemetryData.ts` — binding react-query consapevoli della fonte (le cache non si mescolano mai);
- `src/routes/index.tsx` — dashboard;
- `src/components/f1/` — `TrackMap` (zoom/pan, traiettorie per pilota, click = telemetria in quel punto), `TelemetryCharts`, `SourceSwitcher`, `ArchiveManager`, `ArchiveImporter`, `HistoricalPicker`;
- `src/lib/openf1.ts` — client OpenF1 (cache + coda con rate-limit);
- `src/lib/history.ts` — registri delle sessioni locali e accesso ai dati archivio;
- `src/hooks/use-playback.ts` — clock condiviso a 60 fps per la riproduzione sincronizzata.

## Limiti e note

- OpenF1: tier gratuito senza chiavi, ≈3 req/s e 30 req/min; il client serializza le richieste.
- I dati non sono ufficiali; frequenza variabile, posizione interpolata tra campioni ≤1,5 s.
- Le coordinate del tracciato non sono mai inventate: se i campioni di posizione sono insufficienti, la mappa lo dice.
