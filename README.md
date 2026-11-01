# F1 Telemetry Lab

Confronta fino a quattro giri di Formula 1 sullo stesso circuito, anche di annate differenti:
telemetria OpenF1 dal 2023 e archivi FastF1 2018–2022, con riproduzione sincronizzata,
mappe del tracciato e grafici (speed, throttle, brake, RPM, marcia, DRS).

App completamente client-side: nessun backend, nessuna registrazione. I dati storici 2023+ arrivano
dall'API pubblica [OpenF1](https://openf1.org) direttamente dal browser; gli archivi 2018–2022 si
importano come file JSON/ZIP esportati con gli script in `public/history/`.

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
npm run lint      # ESLint
```

## Pubblicazione su GitHub Pages

Il repository include il workflow `.github/workflows/deploy.yml`, che a ogni push su `main`:

1. installa le dipendenze ed esegue `npm run build` con `--base=/<nome-repo>/`;
2. pubblica il contenuto di `dist/` su GitHub Pages.

Per attivarlo basta una volta sola:

1. su GitHub apri **Settings → Pages**;
2. in **Build and deployment → Source** scegli **GitHub Actions**.

Il sito sarà disponibile su `https://<utente>.github.io/<nome-repo>/`.

## Importare archivi storici (2018–2022)

Nell'app usa il pulsante **Importa archivio 2018–2022** e carica un archivio `.json` o `.zip`
prodotto con gli script Python nella cartella `public/history/`:

- `export_fastf1_archive.py` — esportatore completo / compatto;
- `export_fastf1.py` — esportatore di sessione singola.

Gli script richiedono Python 3 con la libreria [FastF1](https://docs.fastf1.dev/).

## Struttura

- `src/routes/index.tsx` — dashboard principale;
- `src/components/f1/` — mappa del tracciato, grafici, selettore storico, importatore archivi;
- `src/lib/openf1.ts` — client OpenF1 (cache + coda con rate-limit);
- `src/lib/history.ts` — sessioni storiche importate e validazione degli archivi;
- `src/hooks/use-playback.ts` — clock condiviso per la riproduzione sincronizzata.
