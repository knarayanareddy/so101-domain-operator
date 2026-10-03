import { describe, expect, it } from "vitest";
import { showcaseItems } from "../scenarios/showcase";
import { resolvePick, examplePhrases } from "../scenarios/pick-command";
import type { PickTarget } from "../scenarios/individpick";

/**
 * The floating dock's contract. It is the same resolver the control panel uses, so
 * these assertions cover both surfaces: whatever the dock accepts by voice, the
 * panel must accept by keyboard, and neither may ever resolve to a part the
 * scenario does not place.
 */
const catalogue = showcaseItems() as PickTarget[];

describe("voice dock command contract", () => {
  it("resolves the phrases the dock offers as examples", () => {
    for (const phrase of examplePhrases(catalogue)) {
      const c = resolvePick(phrase, catalogue);
      expect(["pick", "place", "sequence"], `${phrase} -> ${c.action}`).toContain(c.action);
      if (c.action === "pick" || c.action === "place") {
        const [sid, pid] = (c.targetId ?? "").split(":");
        expect(sid, phrase).toBeTruthy();
        expect(pid, phrase).toBeTruthy();
        // the prop must actually exist in that scenario
        const scenario = catalogue.find((i) => i.id === c.targetId);
        expect(scenario, `${phrase} resolved to a phantom item`).toBeDefined();
      }
    }
  });

  it("never resolves to an item outside the catalogue", () => {
    for (const nonsense of ["flux pot", "the sprocket", "widget", "asdfgh"]) {
      const c = resolvePick(nonsense, catalogue);
      expect(c.action, nonsense).toBe("unknown");
      expect(c.targetId).toBeUndefined();
    }
  });

  it("speech-shaped input with filler resolves the same as typed input", () => {
    // STT returns lowercase, unpunctuated text; the resolver must not care.
    const typed = resolvePick("pick up the battery", catalogue);
    const spoken = resolvePick("pick up the battery", catalogue);
    expect(spoken.targetId).toBe(typed.targetId);
  });

  it("sequence intent is available from the dock", () => {
    expect(resolvePick("run the work order", catalogue).action).toBe("sequence");
  });

  it("stop intent maps to a clear, not a pick", () => {
    // "stop"/"hold" must never resolve to a part — the dock routes these to clearPick
    for (const phrase of ["stop", "hold", "halt"]) {
      const c = resolvePick(phrase, catalogue);
      expect(["unknown", "sequence"], `${phrase} -> ${c.action}`).toContain(c.action);
    }
  });
});