import { describe, expect, it } from "vitest";
import { resolvePick, examplePhrases } from "../scenarios/pick-command";
import { showcaseItems } from "../scenarios/showcase";
import type { PickTarget } from "../scenarios/individpick";

const catalogue = showcaseItems() as PickTarget[];

describe("natural-language pick resolution", () => {
  it("resolves an exact label", () => {
    const c = resolvePick("pick up the battery", catalogue);
    expect(c.action).toBe("pick");
    expect(c.label).toMatch(/battery/i);
    expect(c.targetId).toBeTruthy();
  });

  it("resolves a domain word to the right item", () => {
    // "the board" must mean the logic board, not any other board-shaped thing
    const c = resolvePick("grab the board", catalogue);
    expect(c.action).toBe("pick");
    expect(c.label).toMatch(/logic board/i);
  });

  it("resolves a specific kitting reel by its part name", () => {
    // the reels are labelled by PART, not "reel" — otherwise "the resistor" is ambiguous
    const c = resolvePick("pick up the resistor", catalogue);
    expect(c.action, c.reason).toBe("pick");
    expect(c.label).toMatch(/resistor/i);
  });

  it("resolves a specific capacitor reel", () => {
    const c = resolvePick("grab the capacitor", catalogue);
    expect(c.action, c.reason).toBe("pick");
    expect(c.label).toMatch(/capacitor/i);
  });

  it("resolves a named lab sample", () => {
    const c = resolvePick("pick up sample A2", catalogue);
    expect(c.action, c.reason).toBe("pick");
    expect(c.label).toMatch(/a2/i);
  });

  it("catalogue labels are unique enough to be addressable", () => {
    // duplicates here are exactly what makes a voice command ambiguous
    const reelLabels = catalogue.filter((i) => i.domain.includes("PCB")).map((i) => i.label);
    expect(new Set(reelLabels).size, reelLabels.join(",")).toBe(reelLabels.length);
  });

  it("tolerates filler words and punctuation", () => {
    for (const phrase of [
      "please could you grab the battery",
      "Grab battery!",
      "  get   the   battery  ",
      "can you please bring the battery over",
    ]) {
      const c = resolvePick(phrase, catalogue);
      expect(c.action, phrase).toBe("pick");
      expect(c.label, phrase).toMatch(/battery/i);
    }
  });

  it("detects place intent", () => {
    const c = resolvePick("place the screen", catalogue);
    expect(c.action).toBe("place");
  });

  it("sequence intent wins over any part name", () => {
    // "run the work order" mentions nothing pickable but must not resolve to a part
    const c = resolvePick("run the work order", catalogue);
    expect(c.action).toBe("sequence");
    expect(c.targetId).toBeUndefined();
  });

  it("does not invent an item that is not in the catalogue", () => {
    const c = resolvePick("pick up the flux pot", catalogue);
    expect(c.action).toBe("unknown");
    expect(c.candidates.length).toBeGreaterThan(0);
  });

  it("returns unknown with candidates for an empty request", () => {
    const c = resolvePick("", catalogue);
    expect(c.action).toBe("unknown");
    expect(c.reason).toMatch(/empty/i);
  });

  it("only ever resolves to a real, reachable catalogue entry", () => {
    // the resolver cannot invent targets: every id it returns must exist
    for (const phrase of examplePhrases(catalogue)) {
      const c = resolvePick(phrase, catalogue);
      if (c.action === "pick" || c.action === "place") {
        expect(catalogue.some((i) => i.id === c.targetId), `${phrase} -> ${c.targetId}`).toBe(true);
      }
    }
  });

  it("example phrases are drawn from the real catalogue", () => {
    const p = examplePhrases(catalogue);
    expect(p.length).toBeGreaterThan(3);
    expect(p.some((x) => x.includes("work order"))).toBe(true);
    for (const phrase of p.filter((x) => x.includes("pick"))) {
      const c = resolvePick(phrase, catalogue);
      expect(c.action, phrase).toBe("pick");
    }
  });
});

describe("voice route contract", () => {
  it("the API route returns text only and declares no actuation", async () => {
    const { GET } = await import("@/app/api/voice/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // the contract that keeps this safe: text only
    expect(body.note).toMatch(/no actuation/i);
  });
});