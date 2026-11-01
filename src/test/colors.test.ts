import { describe, expect, it } from "vitest";
import { distinctColors } from "@/lib/telemetry";
describe("distinctColors", () => {
  it("gives 4 drivers of the same team 4 different colours", () => {
    const c = distinctColors(["3671C6", "3671C6", "3671C6", "3671C6"]);
    expect(new Set(c).size).toBe(4);
  });
  it("keeps distinct team colours unchanged", () => {
    const c = distinctColors(["3671C6", "E8002D"]);
    expect(c[0]).not.toBe(c[1]);
  });
});
