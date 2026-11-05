import { describe, expect, it } from "vitest";
import { splitAtGaps, trailPath } from "@/lib/trackGeometry";
import { MAX_POS_GAP } from "@/lib/telemetry";
import type { PosSample } from "@/lib/telemetry";

const p = (t: number, x: number, y: number): PosSample => ({ t, x, y });

/** Continuous run: 0.0 → 0.6 s, then a hole wider than MAX_POS_GAP, then 3.0 → 3.3 s. */
const samples = [p(0, 10, 20), p(0.3, 30, 20), p(0.6, 50, 20), p(3, 90, 60), p(3.3, 110, 60)];

describe("splitAtGaps", () => {
  it("mantiene una sequenza continua come segmento unico", () => {
    const segs = splitAtGaps([p(0, 1, 1), p(0.3, 2, 1), p(0.6, 3, 1)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(3);
  });

  it("spezza la linea dove il buco temporale supera MAX_POS_GAP", () => {
    expect(3 - 0.6).toBeGreaterThan(MAX_POS_GAP);
    const segs = splitAtGaps(samples);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.map((s) => s.t)).toEqual([0, 0.3, 0.6]);
    expect(segs[1]!.map((s) => s.t)).toEqual([3, 3.3]);
  });

  it("scarta i campioni isolati: nessun collegamento inventato", () => {
    const segs = splitAtGaps([p(0, 1, 1), p(0.3, 2, 1), p(9, 99, 99)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.map((s) => s.t)).toEqual([0, 0.3]);
  });
});

describe("trailPath", () => {
  const segs = splitAtGaps(samples);

  it("è vuota prima del primo campione", () => {
    expect(trailPath(segs, -1)).toBe("");
  });

  it("contiene solo i campioni registrati fino al tempo di replay", () => {
    expect(trailPath(segs, 0.3)).toBe("M10,-20 L30,-20");
  });

  it("chiude con la punta interpolata dentro il segmento, mai oltre", () => {
    // 0.45 s cade tra 0.3 (x=30) e 0.6 (x=50) → punta a x=40
    expect(trailPath(segs, 0.45)).toBe("M10,-20 L30,-20 L40,-20");
  });

  it("non attraversa mai la lacuna: nessun collegamento artificiale", () => {
    const d = trailPath(segs, 2); // durante il buco: solo il primo segmento
    expect(d).toBe("M10,-20 L30,-20 L50,-20");
    expect(d).not.toContain("90");
  });

  it("riparte con un nuovo sottopercorso dopo la lacuna", () => {
    const d = trailPath(segs, 3.3);
    expect(d).toBe("M10,-20 L30,-20 L50,-20 M90,-60 L110,-60");
  });

  it("non supera mai l'ultimo campione registrato", () => {
    expect(trailPath(segs, 100)).toBe("M10,-20 L30,-20 L50,-20 M90,-60 L110,-60");
  });
});
