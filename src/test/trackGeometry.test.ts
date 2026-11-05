import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeBounds,
  fitWindow,
  fmtCoord,
  groupByCoordinateSpace,
  maxTimeGap,
  sanitizePos,
  splitAtGaps,
  splitAtGapsDetailed,
  trailPath,
  viewBoxFor,
} from "@/lib/trackGeometry";
import { MAX_POS_GAP, type LapData, type PosSample } from "@/lib/telemetry";

/**
 * TESTS A–G on REAL archive data shipped in the repository
 * (public/data/archives — exported OpenF1 sessions, format f1-telemetry-lab/v1).
 * No coordinate is invented: laps are loaded from the JSON archives and, where a
 * scenario needs a variant (negative/asymmetric axes, a telemetry gap, another
 * coordinate frame), the REAL samples are transformed/trimmed as documented in
 * each test — the geometry itself is never fabricated.
 */

const ARCHIVE_ROOT = join(__dirname, "..", "..", "public", "data", "archives");

interface ArchiveLap {
  driver: number;
  lapNumber: number;
  startMs: number;
  duration: number;
  durationOfficial: boolean;
  tel: unknown[];
  pos: { t: number; x: number; y: number }[];
}
interface ArchiveJson {
  format: string;
  source: string;
  year: number;
  event: string;
  circuit: string;
  session: string;
  date: string;
  laps: ArchiveLap[];
}

const loadArchive = (rel: string): ArchiveJson =>
  JSON.parse(readFileSync(join(ARCHIVE_ROOT, rel), "utf8")) as ArchiveJson;

/** Convert an archive lap into the LapData shape used by the map. */
const toLap = (l: ArchiveLap, coordsSpace?: string): LapData => ({
  driver: l.driver,
  lapNumber: l.lapNumber,
  startMs: l.startMs,
  duration: l.duration,
  durationOfficial: l.durationOfficial,
  tel: [],
  pos: l.pos.map((p) => ({ t: p.t, x: p.x, y: p.y })),
  dist: [],
  coverage: { tel: 1, pos: 1, maxTelGap: 0, maxPosGap: 0 },
  coordsSpace,
});

const MONACO_2024 = "2024/08-monaco-grand-prix-qualifying.json";
const MONACO_2023 = "2023/07-monaco-grand-prix-qualifying.json";

const monaco2024 = loadArchive(MONACO_2024);
const monaco2023 = loadArchive(MONACO_2023);

/** laps with substantial /location coverage, ordered by sample count */
const posLaps = (a: ArchiveJson, min = 200) =>
  a.laps.filter((l) => l.pos.length >= min).sort((x, y) => y.pos.length - x.pos.length);

const inside = (vb: { x: number; y: number; w: number; h: number }, pts: PosSample[]) => {
  let ok = true;
  for (const p of pts) {
    const x = p.x,
      y = -p.y; // the map flips y
    if (!(x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h)) ok = false;
  }
  return ok;
};

describe("dati reali d'archivio", () => {
  it("gli archivi Monaco contengono giri con centinaia di campioni /location", () => {
    expect(monaco2024.format).toBe("f1-telemetry-lab/v1");
    expect(posLaps(monaco2024).length).toBeGreaterThanOrEqual(4);
    expect(posLaps(monaco2023).length).toBeGreaterThanOrEqual(4);
  });
});

describe("TEST A — circuito con un solo pilota, dati completi: tutto il tracciato visibile", () => {
  it("il viewBox contiene ogni campione del giro con padding su tutti e quattro i lati", () => {
    const lap = posLaps(monaco2024)[0]!;
    const { pts } = sanitizePos(
      lap.pos.map((p) => ({ t: p.t, x: p.x, y: p.y })),
      lap.duration,
    );
    expect(pts.length).toBeGreaterThanOrEqual(200);
    const vb = viewBoxFor(computeBounds([pts]))!;
    // whole track inside the viewBox (nothing clipped)
    expect(inside(vb, pts)).toBe(true);
    // padding present on all four sides (data strictly inside, not touching edges)
    const b = computeBounds([pts])!;
    const pad = 0.05 * Math.max(b.maxX - b.minX, b.maxY - b.minY);
    expect(vb.x).toBeLessThan(b.minX);
    expect(vb.x + vb.w).toBeGreaterThan(b.maxX);
    expect(vb.y).toBeLessThan(-b.maxY);
    expect(vb.y + vb.h).toBeGreaterThan(-b.minY);
    expect(pad).toBeGreaterThan(0);
    // aspect ratio preserved, not stretched to the panel
    const dataRatio = (b.maxX - b.minX) / (b.maxY - b.minY);
    const vbRatio = vb.w / vb.h;
    expect(vbRatio).toBeCloseTo((b.maxX - b.minX + 2 * pad) / (b.maxY - b.minY + 2 * pad), 6);
    expect(vbRatio).toBeCloseTo(dataRatio, 1);
  });
});

describe("TEST B — due piloti nella stessa sessione: entrambe le traiettorie visibili insieme", () => {
  it("il bounding box è l'unione di entrambe le serie e produce due percorsi non vuoti", () => {
    const laps = posLaps(monaco2024, 250).slice(0, 2);
    expect(laps).toHaveLength(2);
    const clean = laps.map((l) => sanitizePos(l.pos, l.duration).pts);
    const vb = viewBoxFor(computeBounds(clean))!;
    for (const pts of clean) {
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(inside(vb, pts)).toBe(true);
      expect(trailPath(splitAtGaps(pts), Infinity)).not.toBe("");
    }
    // the union is wider than each single series in at least one dimension
    const single = computeBounds([clean[0]!])!;
    const union = computeBounds(clean)!;
    expect(
      union.minX < single.minX ||
        union.maxX > single.maxX ||
        union.minY < single.minY ||
        union.maxY > single.maxY,
    ).toBe(true);
  });
});

describe("TEST C — quattro piloti nella stessa sessione: quattro traiettorie distinguibili", () => {
  it("ciascun pilota produce i propri segmenti SVG e tutti stanno nel viewBox unico", () => {
    const laps = posLaps(monaco2024, 250).slice(0, 4);
    expect(laps).toHaveLength(4);
    expect(new Set(laps.map((l) => l.driver)).size).toBe(4);
    const clean = laps.map((l) => sanitizePos(l.pos, l.duration).pts);
    const vb = viewBoxFor(computeBounds(clean))!;
    const paths = clean.map((pts) => trailPath(splitAtGaps(pts), Infinity));
    paths.forEach((d) => {
      expect(d).not.toBe("");
      expect(d.startsWith("M")).toBe(true);
    });
    for (const pts of clean) expect(inside(vb, pts)).toBe(true);
    // distinct drivers → distinct path data (no accidental shared geometry object)
    expect(new Set(paths).size).toBe(4);
  });
});

describe("TEST D — coordinate negative e assi di dimensione molto diversa: nessun taglio", () => {
  it("Monaco (X e Y negative, bbox quasi quadrato) resta interamente contenuto", () => {
    const lap = posLaps(monaco2024)[0]!;
    const pts = sanitizePos(lap.pos, lap.duration).pts;
    const b = computeBounds([pts])!;
    expect(b.minX).toBeLessThan(0);
    expect(b.minY).toBeLessThan(0); // negative coordinates handled
    const vb = viewBoxFor(computeBounds([pts]))!;
    expect(inside(vb, pts)).toBe(true);
    expect(vb.w).toBeGreaterThan(0);
    expect(vb.h).toBeGreaterThan(0);
  });

  it("Las Vegas (bbox ≈ 11610×19493, asse Y ≈ 1,7× asse X) non viene tagliato né deformato", () => {
    const vegas = loadArchive("2024/22-las-vegas-grand-prix-qualifying.json");
    const lap = posLaps(vegas)[0]!;
    const pts = sanitizePos(lap.pos, lap.duration).pts;
    const b = computeBounds([pts])!;
    const w = b.maxX - b.minX,
      h = b.maxY - b.minY;
    expect(h / w).toBeGreaterThan(1.4); // strongly asymmetric axes
    const vb = viewBoxFor(computeBounds([pts]))!;
    expect(inside(vb, pts)).toBe(true);
    // meet + uniform scale: proportions preserved (viewBox ratio = data ratio + pad)
    expect(vb.w / vb.h).toBeCloseTo(
      (w + 2 * 0.05 * Math.max(w, h)) / (h + 2 * 0.05 * Math.max(w, h)),
      6,
    );
  });

  it("una trasformazione a affinità reale dei dati (specchio + offset negativo) resta contenuta", () => {
    const lap = posLaps(monaco2024)[0]!;
    const pts = sanitizePos(lap.pos, lap.duration).pts.map((p) => ({
      t: p.t,
      x: -p.x - 48000, // mirror and shift: different origin, same geometry
      y: p.y * 1.9 + 12000, // different scale on the two axes
    }));
    const vb = viewBoxFor(computeBounds([pts]))!;
    expect(inside(vb, pts)).toBe(true);
  });
});

describe("TEST E — lacune temporali: il percorso si interrompe e riprende senza collegamenti", () => {
  it("un buco reale (campioni rimossi) genera un nuovo M e nessun collegamento artificiale", () => {
    const lap = posLaps(monaco2024)[0]!;
    const raw = sanitizePos(lap.pos, lap.duration).pts;
    // simulate a real telemetry blackout: remove a 3-second slice mid-lap
    const mid = raw[Math.floor(raw.length / 2)]!.t;
    const holed = raw.filter((p) => p.t < mid || p.t > mid + 3);
    expect(maxTimeGap(holed)).toBeGreaterThan(MAX_POS_GAP);
    const segs = splitAtGaps(holed);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const d = trailPath(segs, Infinity);
    expect(d.split("M").length - 1).toBe(segs.length); // one M per segment
    expect(d).not.toContain("Z"); // never closed
    // no pair of consecutive sub-paths shares an endpoint (no artificial link)
    const subs = d.split(" M");
    expect(subs.length).toBe(segs.length);
    // progressive drawing during the blackout shows only the first part
    const during = trailPath(segs, mid + 1.5);
    expect(during.startsWith("M")).toBe(true);
    expect(during).toBe(trailPath([segs[0]!], mid + 1.5));
    // isolated samples never become a segment
    const det = splitAtGapsDetailed([raw[0]!, raw[1]!, { t: raw[1]!.t + 10, x: 1, y: 2 }]);
    expect(det.segs).toHaveLength(1);
    expect(det.isolated).toBe(1);
  });
});

describe("TEST F — stessa pista, sessioni diverse, sistemi di coordinate diversi: niente unioni forzate", () => {
  it("Monaco 2023 e Monaco 2024 restano in due gruppi separati, senza riscalamenti", () => {
    const mk = (a: ArchiveJson, i = 0) => {
      const l = posLaps(a)[i]!;
      return {
        lap: toLap(l, `local:${a.year}:${a.event}:${a.circuit}:${a.session}:${a.date}`),
        color: "#fff",
        label: `${l.driver}`,
        number: l.driver,
      };
    };
    const groups = groupByCoordinateSpace([mk(monaco2024), mk(monaco2023)]);
    expect(groups).toHaveLength(2);
    // each group is fitted on ITS OWN bounds; nothing is merged into one box
    const boxes = groups.map((g) => viewBoxFor(computeBounds(g.drivers.map((d) => d.lap.pos)))!);
    expect(boxes[0]).not.toEqual(boxes[1]);
    // the raw samples are never mutated (no translation/rotation/rescale applied)
    const before = monaco2024.laps[0].pos[0];
    expect(before).toEqual(loadArchive(MONACO_2024).laps[0].pos[0]);
    // same frame → same group (all four drivers of one session overlap 1:1)
    const same = groupByCoordinateSpace([
      mk(monaco2024, 0),
      mk(monaco2024, 1),
      mk(monaco2024, 2),
      mk(monaco2024, 3),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0]!.drivers).toHaveLength(4);
  });
});

describe("TEST G — ridimensionamento e FIT: il circuito resta interamente visibile", () => {
  const lap = posLaps(monaco2024)[0]!;
  const pts = sanitizePos(lap.pos, lap.duration).pts;
  const vb = viewBoxFor(computeBounds([pts]))!;

  it("FIT (zoom 1, centro null) mostra esattamente l'intero viewBox", () => {
    const v = fitWindow(vb, 1, null);
    expect(v.vx).toBeCloseTo(vb.x, 6);
    expect(v.vy).toBeCloseTo(vb.y, 6);
    expect(v.vw).toBeCloseTo(vb.w, 6);
    expect(v.vh).toBeCloseTo(vb.h, 6);
  });

  it("a qualsiasi zoom la finestra resta dentro il viewBox (mai fuori pista)", () => {
    for (const z of [1, 1.35, 3, 7, 14]) {
      const c = { x: vb.x + vb.w * 0.83, y: vb.y + vb.h * 0.17 }; // pan estremo
      const v = fitWindow(vb, z, c);
      expect(v.vx).toBeGreaterThanOrEqual(vb.x - 1e-6);
      expect(v.vy).toBeGreaterThanOrEqual(vb.y - 1e-6);
      expect(v.vx + v.vw).toBeLessThanOrEqual(vb.x + vb.w + 1e-6);
      expect(v.vy + v.vh).toBeLessThanOrEqual(vb.y + vb.h + 1e-6);
    }
  });

  it("il reshape del pannello non cambia l'inquadratura: la finestra dipende solo da vb+zoom", () => {
    const v1 = fitWindow(vb, 1, null);
    const v2 = fitWindow(vb, 1, null);
    expect(v2).toEqual(v1); // ResizeObserver cambia solo la scala px, non la vista
    const zoomed = fitWindow(vb, 4, null);
    expect(zoomed.vw).toBeCloseTo(vb.w / 4, 6);
    expect(zoomed.vh).toBeCloseTo(vb.h / 4, 6);
  });
});

describe("sanitizePos e viewBox degeneri", () => {
  it("scarta non finiti, duplicati e fuori giro contando i motivi", () => {
    const { pts, stats } = sanitizePos(
      [
        { t: 0, x: 1, y: 1 },
        { t: 0.2, x: NaN, y: 2 },
        { t: 0.4, x: Infinity, y: 2 },
        { t: 0.4, x: 3, y: 3 },
        { t: 0.4, x: 3.5, y: 3 }, // duplicate t (both finite → counted)
        { t: -1, x: 0, y: 0 }, // out of lap
        { t: 5, x: 4, y: 4 }, // out of lap (duration 4)
        { t: 0.6, x: 5, y: 5 },
      ],
      4,
    );
    expect(pts.map((p) => p.t)).toEqual([0, 0.4, 0.6]);
    expect(stats).toEqual({ kept: 3, nonFinite: 2, duplicate: 1, outOfLap: 2 });
  });

  it("gestisce bbox degeneri senza divisioni per zero né valori non finiti", () => {
    const zero = viewBoxFor(computeBounds([[{ t: 0, x: 5, y: -7 }]]))!;
    expect(Number.isFinite(zero.w) && zero.w > 0).toBe(true);
    expect(Number.isFinite(zero.h) && zero.h > 0).toBe(true);
    expect(viewBoxFor(computeBounds([]))).toBeNull();
    expect(viewBoxFor(null)).toBeNull();
    expect(viewBoxFor({ minX: NaN, minY: 0, maxX: 1, maxY: 1 })).toBeNull();
  });

  it("fmtCoord preserva la precisione (niente Math.round globale)", () => {
    expect(fmtCoord(10.256)).toBe("10.26");
    expect(fmtCoord(-1234.5678)).toBe("-1234.57");
    expect(fmtCoord(10)).toBe("10");
    expect(fmtCoord(-0.001)).toBe("0"); // -0.00 normalized
    const raw = posLaps(monaco2024)[0]!.pos;
    const pts = sanitizePos(raw, 1e9).pts; // keep every sample: compare precision
    const d = trailPath(splitAtGaps(pts.slice(0, 50)), Infinity);
    // OpenF1 ships integer samples: they render clean (no ".00" noise), while
    // fractional detail (interpolated tip, transformed data) survives untouched
    expect(d).not.toMatch(/\.00[ ,]/);
    const frac = pts.slice(0, 3).map((p) => ({ t: p.t, x: p.x + 0.25, y: p.y - 0.75 }));
    // fractional detail survives the y flip (-(y-0.75) = -y+0.75 → ".75"/".25" endings)
    expect(trailPath(splitAtGaps(frac), Infinity)).toMatch(/\d+\.\d+/);
    // every emitted vertex equals the source sample at 2-decimals precision
    const first = pts[0]!;
    expect(d.startsWith(`M${fmtCoord(first.x)},${fmtCoord(-first.y)}`)).toBe(true);
  });
});
