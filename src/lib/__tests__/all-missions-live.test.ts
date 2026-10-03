import { describe, expect, it } from "vitest";
import { Aborted } from "../arm";
import { DEFAULT_RUNNER, MISSIONS, Runner } from "../missions";
import { SimWorld } from "../sim";

/**
 * Every shipped mission, run LIVE (not dry) on the virtual arm through the real driver stack.
 * A dry run cannot catch an unreachable default coordinate; this can. Takes ~4 minutes, so it is opt-in:
 * `npm run test:live` (sets LIVE_ALL=1). The default `npm test` skips it.
 */
describe.skipIf(!process.env.LIVE_ALL)("all missions execute live on the virtual arm (reachability + no crash)", () => {
  for (const m of MISSIONS) {
    it(`${m.emoji} ${m.id}`, async () => {
      const world = new SimWorld();
      const arm = world.arm;
      arm.maxDegPerS = 400;
      await arm.initFollower();
      await arm.setTorque(true);
      if (m.scene) world.objects = m.scene(Object.fromEntries(m.params.map((p) => [p.key, p.value])));
      const tick = setInterval(() => void arm.readState().then((s) => world.update(s)).catch(() => undefined), 30);
      const perceive = async () =>
        world.objects
          .filter((o) => !o.held)
          .map((o) => ({ label: o.name, px: { x: 0, y: 0 }, area: 100, bbox: [0, 0, 1, 1] as [number, number, number, number], world: { x: o.x, y: o.y } }));
      const ctl = new AbortController();
      const runner = new Runner(arm, ctl.signal, () => undefined, perceive, { ...DEFAULT_RUNNER, speedMs: 80 });
      const params = Object.fromEntries(m.params.map((p) => [p.key, /second|duration/i.test(p.key) ? 2 : p.value]));
      let err: unknown = null;
      try {
        await m.run(runner, params);
      } catch (e) {
        if (!(e instanceof Aborted)) err = e;
      } finally {
        clearInterval(tick);
      }
      expect(err instanceof Error ? err.message : err).toBeNull();
    }, 120000);
  }
});
