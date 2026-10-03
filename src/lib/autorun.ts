/**
 * Countdown used by scripted ("auto-run") control.
 *
 * It is deliberately independent from React effects: the first version lived in a useEffect whose
 * dependencies (preflight/runMission) were re-created on every servo poll (~20 Hz), so the 1 s
 * timer was cleared and restarted constantly and the countdown never reached zero.
 * Here the timer lives in a plain object that only start()/cancel()/finishNow() can touch.
 */
export class Countdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onDone: (() => void) | null = null;
  private onTick: ((left: number) => void) | null = null;
  left = 0;

  get active(): boolean {
    return this.onDone !== null;
  }

  start(seconds: number, onTick: (left: number) => void, onDone: () => void) {
    this.cancel();
    this.left = Math.max(0, Math.round(seconds));
    this.onTick = onTick;
    this.onDone = onDone;
    onTick(this.left);
    if (this.left === 0) return this.finishNow();
    this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.left -= 1;
      this.onTick?.(this.left);
      if (this.left <= 0) this.finishNow();
      else this.schedule();
    }, 1000);
  }

  /** Skip the remaining wait ("Start now"). */
  finishNow() {
    const done = this.onDone;
    this.clear();
    done?.();
  }

  /** Abort without running anything. */
  cancel() {
    this.clear();
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.onDone = null;
    this.onTick = null;
  }
}
