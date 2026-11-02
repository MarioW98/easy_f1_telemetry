# 🏁 F1 Telemetry Lab

**Confronta la telemetria reale della Formula 1: scegli fino a 4 giri sullo stesso circuito — anche di annate diverse — e guardali correre in sincrono, con la mappa del tracciato, i grafici e un replay che puoi comandare tu.**

🌐 **Usa il sito qui: [mariow98.github.io/easy_f1_telemetry](https://mariow98.github.io/easy_f1_telemetry/)**
📓 Sorgente: [github.com/MarioW98/easy_f1_telemetry](https://github.com/MarioW98/easy_f1_telemetry)

Nessuna registrazione, nessuna chiave API, nessun server: è un'app che gira interamente nel browser.

**Sommario**
[🎈 Per chi vuole solo divertirsi](#-per-chi-vuole-solo-divertirsi) ·
[📖 Guida completa](#-guida-completa) ·
[📦 Archivi e dati](#-archivi-e-dati) ·
[💻 Per sviluppatori](#-per-sviluppatori) ·
[📜 Fonti e note legali](#-fonti-e-note-legali)

---

## 🎈 Per chi vuole solo divertirsi

### Di cosa si tratta

F1 Telemetry Lab ti fa rivivere i giri della Formula 1 come li vedono gli ingegneri sul muretto box: dove va l'auto sul tracciato, a che velocità, con quanto acceleratore, quando frena, che marcia mette e se il DRS è aperto.

La cosa più divertente è il **confronto**: puoi mettere sulla stessa pista fino a 4 giri insieme — lo stesso pilota in due annate diverse, i due compagni di squadra, il poleman contro il vincitore — e guardare le due auto sfrecciare in sincrono sulla mappa, con i grafici sotto che scorrono paralleli.

### Come si usa in 30 secondi

1. Apri [il sito](https://mariow98.github.io/easy_f1_telemetry/).
2. In alto a destra scegli da dove prendere i dati:
   - **OpenF1 Live** → stagioni dal 2023 al 2026, scaricate al volo da internet;
   - **Dati Locali** → stagioni già pronte qui nel repository (per ora **2021** e **2022**).
3. Seleziona **Anno → Gran Premio → Sessione** (Gara, Qualifying o Prove libere).
4. Per ogni pilota che vuoi confrontare scegli **anno, sessione, pilota e giro**, poi premi **CARICA ANALISI**.
5. Fatto: premi ▶ e l'analisi si anima — mappa in alto, grafici che scorrono lungo la pagina.

> **Prima volta con «Dati Locali»?** Non serve preparare niente: scegli direttamente anno, GP e sessione. Il file di quella sessione (~1 MB) viene scaricato automaticamente al primo uso. Il pannello «Archivi» serve solo se vuoi scaricare qualcosa in anticipo.

### Cosa trovi a schermo

- **La mappa del circuito** — le traiettorie reali dei giri scelti, con le auto che si muovono durante il replay. Zoom con la rotellina, trascina per spostarti, e **clicca su una traiettoria** per leggere i valori telemetrici in quel punto (e portare il replay lì con «Vai a questo istante»).
- **I grafici** — Velocità, Acceleratore, Freno, RPM, Marcia e DRS, tutti allineati sul tempo di giro. Passa il mouse per il dettaglio istante per istante; un clic porta il replay a quel punto.
- **I numeri live** — per ogni pilota: velocità grande, marcia, acceleratore, freno, RPM, DRS, aggiornati in tempo reale durante il replay.
- **Il confronto** — il distacco stimato tra i piloti a pari distanza percorsa, giro dopo giro.

### Qualche idea da provare

- **Verstappen 2021 vs Verstappen 2022** a Yas Marina: com'è cambiata la Red Bull in un inverno?
- **Il duello dei compagni di squadra in qualifica**: chi frena più tardi alla prima variante? Clicca sulle due traiettorie nel punto e confronta i valori.
- **Monza 2021 vs Monza 2022**: velocità massima sul rettilineo prima e dopo il cambio di regolamenti aerodinamici.
- **Il giro in pole contro il giro vincente della gara** nello stesso weekend: stessa pista, gomme e benzina diverse.

### Piccolo glossario (tutto quello che serve)

| Termine | Cosa significa |
|---|---|
| **Riferimento** | Il primo pilota che scegli: i distacchi sono calcolati rispetto a lui. |
| **G13 · 1:30.681** | Il giro scelto (G13 = 13° giro) e il suo tempo. |
| **Δ fin.** | Differenza tra i tempi finali dei due giri (se entrambi ufficiali). |
| **Gap ora** | Il distacco «in questo momento del replay», stimato a pari distanza. |
| **Copertura** | Quanto dei dati originali è arrivato fin qui (in %, con la lacuna massima). Se è bassa, i grafici possono avere buchi: l'app non inventa i dati mancanti. |
| **Campione** | Un singolo punto di misura del giro — l'auto viene «fotografata» molte volte al secondo. |

### Cosa c'è, oggi

- **OpenF1 Live**: 2023 → 2026 (gli eventi futuri compaiono solo dopo che sono corsi).
- **Dati Locali**: **2021** (105 sessioni) e **2022** (110 sessioni, incluse 3 Sprint) — gare, qualifiche e prove libere, giro più veloce per pilota.
- Gli altri anni (2018–2020) e le stagioni recenti si possono generare e aggiungere con due click da GitHub — vedi [Archivi e dati](#-archivi-e-dati) più avanti.

---

## 📖 Guida completa

### Le due sorgenti dati

| | **OpenF1 Live** | **Dati Locali** |
|---|---|---|
| Anni | 2023–2026 | 2018–2026 possibili · oggi 2021, 2022 |
| Da dove | API pubblica [OpenF1](https://openf1.org) | file JSON nel repository, o file importati |
| Giri disponibili | qualsiasi giro cronometrato | il giro più veloce di ogni pilota (archivi compatti) |
| Internet | necessario | solo al primo scaricamento di ogni sessione |
| Limiti | ~3 richieste/s sul tier gratuito (il client gestisce coda e cache) | nessuno |

La sorgente attiva e la visibilità dei grafici restano salvate nel browser (localStorage, chiave `f1-telemetry-lab-ui`): alla riapertura ritrovi l'app come l'avevi lasciata.

### La barra superiore

- **Stagione / Gran Premio / Sessione** — tre menu a tendina, sempre filtrati sulla sorgente attiva. Gli eventi non ancora corsi non compaiono.
- **Indicatore di stato** — «pronto» (🟢) o «caricamento dati…» con spinner.
- **Dati Locali ↔ OpenF1 Live** — l'interruttore della sorgente: i menu si ricaricano in base alla scelta.
- **Archivi** (visibile solo in Dati Locali) — elenca tutte le sessioni pubblicate nel repository, con il pulsante **Scarica** per pre-caricarle e **Ricarica elenco** per aggiornare il catalogo. *Non è un passaggio obbligato*: la selezione diretta dall'header scarica da sola le sessioni al primo uso.
- **Importa archivio** — trascina (o seleziona) un file `.json` o `.zip` esportato con gli script Python del progetto: i dati diventano subito «Dati Locali», anche offline. Accanto c'è il link per scaricare lo **Esportatore completo / compatto**.

### Scegliere piloti e giri

- Ogni slot è un giro da confrontare e ha i suoi quattro menu: **Anno, Sessione, Pilota, Giro**.
- Il primo slot è il **riferimento** per tutti i confronti.
- Fino a **4 slot** con «+ Aggiungi pilota»; ogni slot si rimuove con la ✕ (l'ultimo resta sempre).
- Puoi **mescolare annate** (es. Monza 2021 vs Monza 2022): l'app te lo segnala con un avviso, perché tracciato, regolamenti e coordinate possono cambiare tra un'annata e l'altra.
- **CARICA ANALISI** scarica solo i giri non ancora in cache: ricaricare una combinazione già vista è istantaneo.

### La legenda

Un pulsante per ogni giro caricato: il campione grafico della linea (continua = slot 1, poi tratteggiata, punteggiata, tratto-punto), nome, anno, squadra, numero di giro, e l'**occhiolino** 👁 per nascondere o riattivare temporaneamente quel pilota in mappa e grafici senza toglierlo dall'analisi.

### La mappa del circuito

- Il tracciato è ricostruito dai **dati di posizione reali** del giro scelto come riferimento: nessuna geometria inventata. Se i campioni sono troppo pochi o pieni di buchi, l'app lo dichiara invece di disegnare un circuito falso.
- **Zoom**: rotellina del mouse o i pulsanti di zoom; **spostamento**: trascina la mappa; **⤢ Ripristina vista** torna alla vista iniziale.
- Le **traiettorie colorate** sono cliccabili: si apre una scheda con i valori in quel punto (velocità, acceleratore, freno, marcia, DRS) e il pulsante **«Vai a questo istante»** che porta là il replay.
- Il pallino arancione ● segna l'inizio del giro; ogni auto mostra numero e abbreviazione del pilota (es. «1 VER»).

### La barra di riproduzione

- **⟲ Riavvia**, **⟨ ⟨** campione precedente, **▶/❚❚** play/pausa, **⟩ ⟩** campione successivo.
- **Slider del tempo** con indicazione «0.00 / 90.68 s».
- **Velocità di riproduzione**: 0.25× / 0.5× / 1× / 2×.
- Contatore «campione n/totale» per il giro di riferimento.
- La barra **resta fissa in fondo alla pagina** mentre scorri tra i grafici — come i controlli di un video — e si aggancia alla sua posizione a fine pagina.

### I grafici di telemetria

- Sei serie, ognuna attivabile/disattivabile dal pulsante nella testata: **Velocità (km/h)**, **Acceleratore (%)**, **Freno (ON/OFF)**, **RPM**, **Marcia**, **DRS**.
- L'asse X è il tempo **dall'inizio di ciascun giro**: i giri partono allineati sulla linea di partenza, anche se provengono da annate diverse.
- Sopra ogni grafico, i valori dei piloti al tempo corrente del replay.
- Il pulsante **⤢** su ogni grafico lo **espande** (raddoppia l'altezza, comprime le altre serie) per guardare un dettaglio; **Ripristina grafici** rimette tutto normale.
- Il **cursore rosso** verticale segue il replay; passando col mouse appare un'anteprima con `t` e i valori di ogni pilota; **un clic** in qualsiasi punto porta il replay a quell'istante.
- Le **lacune** dei dati originali (>1 s) diventano interruzioni visibili della linea: i dati mancanti non vengono mai «pontati» o riempiti con zeri.

### I pannelli laterali (desktop) / finali (mobile)

- **Scheda pilota** — velocità in grande, poi tempo trascorso, marcia, acceleratore, freno, RPM, DRS (aperto / abilitabile / chiuso), numero di giro e tempo di giro. Un asterisco dopo il tempo (`1:30.681*`) indica una durata ricostruita dall'inizio del giro successivo, non ufficiale.
- **Copertura dati** — percentuale di telemetria e posizione ricevute e lacuna massima; se i dati sono incompleti l'avviso è colorato.
- **Tabella di confronto** — per ogni pilota: il tempo di giro, **Δ fin.** (differenza dei tempi finali, «n/d» se una durata non è ufficiale) e **Gap ora** (stima del distacco a pari distanza, integrando la velocità: è un'approssimazione, non il dato ufficiale della direzione gara).

### Note sui dati (le «onestà» dell'app)

- La frequenza di campionamento varia per fonte, anno e sessione; la posizione tra due campioni (≤1,5 s) è interpolata.
- Non tutte le sessioni storiche sono complete: la copertura è sempre dichiarata, e nei casi limite l'app preferisce dire «circuito non ricostruibile» piuttosto che mostrare un tracciato inventato.
- OpenF1 copre dal 2023; FastF1 dal 2018. I tempi non ufficiali sono marcati con `*`.

---

## 📦 Archivi e dati

### Com'è organizzato il repository

```
public/data/archives/
├── manifest.json                 ← l'indice di tutto (anno, evento, sessione, file, peso, piloti, giri)
└── 2021/ 2022/ …
    └── <n>-<gp>-<sessione>.json  ← un file per sessione
```

- Ogni file JSON contiene un'«envelope» con `year, event, session, drivers, laps`; ogni giro ha `driver, duration, durationOfficial, tel` (i campioni di telemetria) e i campioni di posizione.
- **Modalità compatta** (quella pubblicata nel repository): solo il giro più veloce di ogni pilota, ~400 campioni di telemetria per giro → file da **0,4 a 2,3 MB** (~1 MB di media) a sessione.
- **Modalità completa**: tutti i giri con tutti i campioni — file molto più grandi, pensati per l'import da file, non per il repository.
- L'app legge il `manifest.json` per mostrare subito tutto il catalogo scaricabile, senza scaricare nulla finché non serve.

### Cosa c'è oggi

| Anno | Sessioni | Contenuto |
|---|---|---|
| **2021** | 105 | 22 gare + 22 qualifiche + prove libere |
| **2022** | 110 | 22 gare + 22 qualifiche + prove libere + 3 Sprint |
| 2018–2020 | da generare | la pipeline supporta tutto il 2018–2026 |

Progetto in corso: gli anni vengono aggiunti **uno alla volta**, completi di gara, qualifiche e prove libere. 2021 e 2022 sono i primi due consegnati e verificati.

### Aggiungere un anno — via GitHub (consigliato, zero setup locale)

1. Apri **Actions → Update F1 Archives → Run workflow**.
2. Scegli i parametri:
   - **year**: 2018–2026;
   - **mode**: `compact` (consigliata) o `full`;
   - **sessions**: `race`, `quali`, `race-quali`, `race-quali-fp` (weekend completo classico) o `all` (include Sprint);
   - **rounds**: facoltativo, es. `1-12,14` — utile per spezzare un anno in più esecuzioni.
3. Il workflow installa FastF1, scarica i dati, genera i JSON, **li committa** e richiama da solo il deploy su Pages.
4. Facoltativo ma consigliato: nei **Secrets** del repository impostare `F1_USERNAME` e `F1_PASSWORD` (un account F1 gratuito su formula1.com). Con le credenziali il download usa direttamente `livetiming.formula1.com` (tutte le stagioni); senza, FastF1 prova il mirror pubblico, con copertura parziale.

### Aggiungere un anno — in locale

```bash
python -m pip install 'fastf1>=3.4,<4'

# un anno completo (gare + qualifiche + prove libere), modalità compatta
python public/history/export_fastf1_sessions.py --year 2018 --sessions race-quali-fp --mode compact

# opzioni utili
#   --rounds 1-12,14      solo certi Gran Premi (per lavorare a blocchi)
#   --force               rigenera anche le sessioni già presenti
#   --sessions race       solo le gare (default)

git add public/data/archives
git commit -m "chore(archives): 2018 race-quali-fp (compact)"
git push   # il deploy su Pages parte da solo
```

Lo script è **idempotente** (salta le sessioni già esportate), ricostruisce `manifest.json` da quello che c'è su disco, e rifiuta file oltre 95 MB (il limite Git è 100 MB).

### Gli script disponibili in `public/history/`

| Script | Cosa produce |
|---|---|
| `export_fastf1_sessions.py` | Un JSON per sessione, formato del repository (è quello usato dal workflow) |
| `export_fastf1_archive.py` | Archivio completo o compatto in ZIP/JSON aggregato (`archive-v2`), per l'import dal browser |
| `export_fastf1.py` | Un singolo evento (anno + GP + sessione), giro più veloce per pilota |

Tutti richiedono `fastf1>=3.4,<4` e usano una cache locale per non riscaricare due volte la stessa sessione.

---

## 💻 Per sviluppatori

### Stack

- **React 19 + TypeScript + Vite 8** — SPA pura, nessun backend
- **TanStack Router** (routing file-based) + **TanStack Query** (fetch/cache)
- **Zustand** con persist middleware (localStorage)
- **Tailwind CSS 4** + **shadcn/ui** (Radix) + **Recharts** per i grafici
- **Vitest** (suite di test inclusa), ESLint + Prettier
- Pipeline dati: Python + **FastF1**

### Comandi

```bash
npm ci            # installa le dipendenze
npm run dev       # server di sviluppo (http://localhost:5173)
npm test          # suite di test (vitest)
npm run build     # build di produzione in dist/
npm run preview   # serve la build in locale (http://localhost:4173)
npm run lint      # eslint
npm run format    # prettier su tutto
```

### Struttura del progetto

```
src/
  routes/index.tsx        # la dashboard: selettori, slot piloti, mappa, grafici, replay
  components/f1/          # TrackMap, TelemetryCharts, HistoricalPicker,
                          # ArchiveManager, ArchiveImporter, SourceSwitcher
  components/ui/          # componenti shadcn/ui (Radix)
  store/appStore.ts       # stato globale (Zustand, persistito: "f1-telemetry-lab-ui")
  services/               # openf1Source, localArchiveSource, repoArchives (manifest + download)
  lib/                    # openf1 (client API), telemetry, history (registro archivi), archive-import
  hooks/                  # use-playback, useTelemetryData, use-mobile
  test/                   # suite vitest
public/
  data/archives/          # gli archivi JSON + manifest.json (pubblicati su Pages)
  history/                # exporter FastF1 in Python
.github/workflows/
  deploy.yml              # test + build + GitHub Pages, a ogni push su main
  update-archives.yml     # generazione archivi (manuale, con parametri) + deploy
```

### Deploy su GitHub Pages

- A ogni push su `main`: `npm test` → `npm run build -- --base=/<nome-repo>/` → copia di `index.html` in `404.html` (fallback SPA) → pubblicazione.
- Attivazione (una volta sola): **Settings → Pages → Source: GitHub Actions**.
- URL: `https://<utente>.github.io/<nome-repo>/`.
- Il workflow `update-archives.yml` committa gli archivi con il `GITHUB_TOKEN`, che di norma non innesta altri workflow: per questo, dopo il commit, richiama esplicitamente `deploy.yml`.

---

## 📜 Fonti e note legali

- **OpenF1** — API pubblica ([openf1.org](https://openf1.org)) per le stagioni 2023+. Il tier gratuito consente ≈3 richieste al secondo: il client le mette in coda e le cache da solo.
- **FastF1** — libreria open source (MIT) che legge i dati di timing pubblicati da formula1.com. I dati di timing hanno diritti separati dal software: lo strumento li usa per accesso personale; le pipeline dichiarano esplicitamente di non concedere diritti di ridistribuzione.
- Progetto **non ufficiale**, senza alcuna affiliazione con Formula One Group, FIA o i team. I dati sono offerti «così come sono», senza garanzia di correttezza o completezza: usali per studio e divertimento.

---

*Per la cronologia delle funzionalità e i dettagli di verifica, vedi [roadmap.md](roadmap.md).*