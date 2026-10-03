/**
 * Repair ledger — the record a technician's checklist produces.
 *
 * This is the artefact the phone-repair scene is really selling: an ordered,
 * timestamped, exportable record of what was done, with an explicit verdict per
 * step. Deliberately dependency-free and in-memory: it is a report, not state you
 * query. If retention becomes a real requirement the existing
 * `src/app/api/state` Postgres path is the upgrade, not this file.
 *
 * Design rules (from docs/specs/2026-10-03-phone-repair-scene.md):
 *  - Verdicts are a CLOSED set: "pass" | "fail" | "unknown". No free-form strings.
 *  - An unavailable optional input yields "unknown", never "fail" and never a throw.
 *    Failing to distinguish "we did not check" from "this was wrong" is how a QA
 *    record becomes untrustworthy.
 *  - Every step is recorded, including steps that were never verified.
 */

/** Closed verdict set. Anything else is a programming error, not a data error. */
export type Verdict = "pass" | "fail" | "unknown";

const VERDICTS: readonly Verdict[] = ["pass", "fail", "unknown"];

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/** Where a verdict came from. Drives how a reader should weight it. */
export type Evidence = "arm" | "camera" | "sensor" | "operator";

export interface RepairStep {
  /** 1-based step number as shown to the technician. */
  step: number;
  /** Part identifier the step is about (e.g. "part-battery"). */
  part: string;
  /** Human-readable action ("fetch battery from tray 1"). */
  action: string;
  verdict: Verdict;
  /** Why this verdict. Always populated — a bare verdict is not a record. */
  reason: string;
  /** Which input produced the evidence. */
  evidence: Evidence;
  /** Epoch ms when the step completed. */
  t_ms: number;
  /** True when the technician explicitly confirmed this step. */
  confirmed: boolean;
}

export interface RepairLedger {
  /** Job/work-order identity. Supplied by the caller; the deck invents none. */
  job: string;
  started: number;
  finished: number;
  steps: RepairStep[];
}

export class LedgerError extends Error {}

function assertVerdict(v: Verdict): Verdict {
  if (!isVerdict(v)) {
    throw new LedgerError(
      `invalid verdict ${JSON.stringify(v)}; expected one of ${VERDICTS.join(" | ")}`,
    );
  }
  return v;
}

/**
 * Accumulates steps during a run.
 *
 * `now` and `source` are injectable so tests are deterministic without mocking
 * globals.
 */
export class RepairLedgerBuilder {
  private readonly steps: RepairStep[] = [];
  constructor(
    public readonly job: string,
    public readonly started: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Record a verified step. `evidence` says which input proved it. */
  add(o: {
    part: string;
    action: string;
    verdict: Verdict;
    reason: string;
    evidence: Evidence;
    confirmed?: boolean;
  }): RepairStep {
    if (!o.reason || !o.reason.trim()) {
      throw new LedgerError(`step for ${o.part} has no reason; a verdict without a reason is not a record`);
    }
    const entry: RepairStep = {
      step: this.steps.length + 1,
      part: o.part,
      action: o.action,
      verdict: assertVerdict(o.verdict),
      reason: o.reason,
      evidence: o.evidence,
      t_ms: this.now(),
      confirmed: o.confirmed ?? false,
    };
    this.steps.push(entry);
    return entry;
  }

  /** A step we could not check because an optional input was unavailable. */
  unknown(part: string, action: string, reason: string): RepairStep {
    return this.add({ part, action, verdict: "unknown", reason, evidence: "operator" });
  }

  build(): RepairLedger {
    return {
      job: this.job,
      started: this.started,
      finished: this.now(),
      steps: [...this.steps],
    };
  }
}

/** Summary counts. Derived here so the UI and the CLI cannot disagree. */
export interface LedgerSummary {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
  /** True only when every step is "pass" — "unknown" is NOT success. */
  complete: boolean;
}

export function summarise(l: RepairLedger): LedgerSummary {
  let pass = 0,
    fail = 0,
    unknown = 0;
  for (const s of l.steps) {
    if (s.verdict === "pass") pass++;
    else if (s.verdict === "fail") fail++;
    else unknown++;
  }
  return { total: l.steps.length, pass, fail, unknown, complete: fail === 0 && unknown === 0 && pass > 0 };
}

/** One-line human summary, e.g. `3/6 steps verified · 1 fail · 2 unknown`. */
export function formatSummary(l: RepairLedger): string {
  const s = summarise(l);
  const bits = [`${s.pass}/${s.total} steps verified`];
  if (s.fail) bits.push(`${s.fail} fail`);
  if (s.unknown) bits.push(`${s.unknown} unknown`);
  return bits.join(" · ");
}