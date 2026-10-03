import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown } from "../autorun";

describe("scripted auto-run countdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts down once per second and then fires exactly once", () => {
    const c = new Countdown();
    const ticks: number[] = [];
    const done = vi.fn();
    c.start(3, (l) => ticks.push(l), done);
    expect(ticks).toEqual([3]);
    vi.advanceTimersByTime(999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(2000);
    expect(ticks).toEqual([3, 2, 1, 0]);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(c.active).toBe(false);
  });

  it("is NOT reset by unrelated activity (regression: servo polling re-rendered and restarted the timer)", () => {
    const c = new Countdown();
    const done = vi.fn();
    c.start(5, () => undefined, done);
    // simulate 20 Hz telemetry: lots of unrelated timers firing while the countdown runs
    const poll = setInterval(() => undefined, 45);
    vi.advanceTimersByTime(5000);
    clearInterval(poll);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents the run; finishNow runs immediately; restart replaces the previous countdown", () => {
    const c = new Countdown();
    const a = vi.fn();
    c.start(2, () => undefined, a);
    c.cancel();
    vi.advanceTimersByTime(5000);
    expect(a).not.toHaveBeenCalled();

    const b = vi.fn();
    c.start(10, () => undefined, b);
    c.finishNow();
    expect(b).toHaveBeenCalledTimes(1);

    const first = vi.fn();
    const second = vi.fn();
    c.start(3, () => undefined, first);
    c.start(3, () => undefined, second);
    vi.advanceTimersByTime(3000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
