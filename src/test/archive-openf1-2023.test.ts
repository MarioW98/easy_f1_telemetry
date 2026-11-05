import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArchive } from "@/lib/history";

// Validazione end-to-end: un file archivio OpenF1 reale deve passare lo stesso
// schema zod usato per i file FastF1 scaricati dal repository.
describe("archivio OpenF1 2023 (Bahrain Race)", () => {
  const path = resolve(
    __dirname,
    "../../public/data/archives/2023/01-bahrain-grand-prix-race.json",
  );
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const parsed = parseArchive(data);

  it("passa parseArchive con source OpenF1", () => {
    expect(parsed.source).toBe("OpenF1");
    expect(parsed.year).toBe(2023);
    expect(parsed.event).toBe("Bahrain Grand Prix");
    expect(parsed.drivers).toHaveLength(20);
    expect(parsed.laps).toHaveLength(20);
  });

  it("telemetria e posizioni nei limiti e ordinate", () => {
    for (const lap of parsed.laps) {
      expect(lap.tel.length).toBeGreaterThan(100);
      expect(lap.pos.length).toBeGreaterThan(100);
      const speeds = lap.tel.map((s) => s.speed ?? 0);
      expect(Math.max(...speeds)).toBeGreaterThan(250);
      expect(Math.max(...lap.pos.map((p) => Math.abs(p.x)))).toBeGreaterThan(1000);
    }
  });

  it("il giro veloce Zhou 1:33.996 è presente", () => {
    const zhou = parsed.laps.find((l) => l.driver === 24);
    expect(zhou?.duration).toBeCloseTo(93.996, 2);
  });
});
