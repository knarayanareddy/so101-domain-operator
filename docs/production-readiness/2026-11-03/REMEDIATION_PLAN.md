# SO-101 remediation plan

Proposed work only. No device was accessed or moved. See [review](./REVIEW.md).

## Phased roadmap with entry and exit criteria

| Phase | Tasks | Entry criteria | Exit criteria |
| --- | --- | --- | --- |
| Baseline and boundary mapping | SO-T1 | Current draft findings accepted as documentation baseline; owner names a safety lead and a non-actuating review environment. | All control paths, mode splits, and hazard assumptions are recorded and independently traceable. |
| Safety and trust-boundary enforcement | SO-T2 | SO-T1 complete. | Real actuator entry points have defined limits, authorization, and fail-closed behavior with negative-test evidence. |
| Honest automation evidence | SO-T3 | SO-T2 complete. | Non-hardware automation runs are reproducible, modality-labeled, and mutation-sensitive. |
| Recovery, UX labeling, supervised acceptance | SO-T4 | SO-T3 complete; owner approves any supervised hardware-adjacent check. | Static/server differences, recovery drills, and any explicitly authorized supervised acceptance evidence are recorded without overstating runtime scope. |
| Release decision | SO-T5 | SO-T4 complete. | Owner and safety lead either accept bounded residual risk with evidence or block release. |

### SO-T1 — Map real control paths (SO-1, SO-3)
Prerequisites: owner supplies safety lead and approved non-actuating environment.

Observed paths: `tools/so101.ts`, `tools/so101-transport.ts`, `public/bridge/so101_bridge.py`, `src/lib/arm.ts`, `src/app/api/`.

Steps:
1. Trace browser and headless commands from caller identity through transport, bridge, and servo-write boundaries, including reconnect and failure paths.
2. Inventory which capabilities exist in static Pages mode versus server mode, and record any places where builds or deployments remove functionality.
3. Write a threat-and-hazard map that names stop conditions, authority boundaries, calibration assumptions, and still-unverified safety claims.

Output: control/data-flow map plus a hazard-and-trust-boundary record.

Verification: an independent reviewer traces one denied command path and one communications-failure path from the written map without actuating hardware.

Definition of done:
- [ ] Every actuator-capable entry point and caller authority is identified.
- [ ] Static-export versus server-mode capability differences are explicit.
- [ ] Unverified assumptions are listed instead of implied away.

### SO-T2 — Enforce safety and trust boundaries (SO-1)
Prerequisites: SO-T1 complete; safety lead approval.

Observed paths: `src/lib/arm.ts`, `src/lib/kinematics.ts`, `tools/so101.ts`, `public/bridge/so101_bridge.py`.

Steps:
1. Define independent physical stop expectations, workspace and joint limits, safe speed/torque ranges, and fail-closed behavior for disconnects or stale state.
2. Enforce authorization and deterministic command validation at every actuator entry point so model, detector, or optional-sensor output cannot directly authorize motion.
3. Add non-actuating negative tests for stale calibration, malformed commands, disconnected dependencies, unauthorized clients, and stop/reconnect handling.

Output: enforced control-boundary implementation and operator safety procedure.

Verification: deliberately bypass one limit or authorization check in an isolated mutation and observe a relevant negative test fail.

Definition of done:
- [ ] Limits, stop behavior, and failure states are testable and independently reviewed.
- [ ] Advisory inputs cannot grant actuation authority.
- [ ] Unauthorized or malformed commands are rejected with recorded evidence.

### SO-T3 — Expand verification with honest modality labels (SO-2)
Prerequisites: SO-T2 complete.

Observed paths: `package.json`, `src/lib/__tests__/all-missions-live.test.ts`, `src/lib/__tests__/detect.test.ts`, `src/lib/__tests__/autorun.test.ts`, `src/lib/__tests__/driver.test.ts`.

Steps:
1. Run the existing lint, typecheck, and default test commands in a clean environment and record exactly which suites ran, skipped, or failed.
2. Run the separately defined extended virtual suite and add behavior-based checks for unknown-ledger handling, limits, stop behavior, and fail-closed detector/service outages.
3. Publish CI/reporting rules that label pure-function, virtual-arm, and any future hardware evidence separately.

Output: reproducible, modality-labeled automation evidence.

Verification: mutate an unknown-to-pass mapping or stop check and confirm the relevant suite fails.

Definition of done:
- [ ] Default and extended virtual results are recorded separately.
- [ ] Negative tests fail on deliberately broken safety or ledger behavior.
- [ ] No simulation result is described as physical validation.

### SO-T4 — Recovery, static UX, and supervised hardware acceptance (SO-3, SO-4)
Prerequisites: SO-T3 complete; explicit owner and safety-operator approval.

Observed paths: `.github/workflows/pages.yml`, `src/db/index.ts`, `src/components/`, `tools/so101.ts`.

Steps:
1. Label absent static API features, simulation/live mode, and stop/error states in the UI, then verify keyboard reachability and conspicuous failure messaging.
2. Decide ledger authority and backup objectives, then perform isolated restore and release-rollback drills with synthetic records and recorded observations.
3. Only under qualified supervision and physical safeguards, perform approved non-actuating checks first, then any separately authorized minimal-motion acceptance with immediate stop and read-back evidence.

Output: mode-specific UX notes, recovery evidence, and any supervised acceptance record.

Verification: observe restored data, release rollback, state read-back, and stop behavior directly; document unknowns rather than inferring success.

Definition of done:
- [ ] Static and server-mode behaviors are independently checked.
- [ ] Recovery evidence is observed, not inferred from code or CI.
- [ ] Any authorized hardware-adjacent acceptance remains explicitly supervised and scoped.

### SO-T5 — Independent release decision (preventive)
Prerequisites: SO-T4 complete.

Observed paths: `README.md`, `docs/specs/`; proposed safety/release record.

Steps:
1. Compare public claims with measured support for hardware, domains, detector vocabulary, recovery, and operator workflow.
2. Independently repeat critical negative, stop, and recovery checks on the candidate revision and confirm the deployed artifact matches the reviewed revision.
3. Have the owner and safety lead record an approve/block decision with residual risks, rollback trigger conditions, and any remaining prohibited use cases.

Output: bounded-claims release packet and signed acceptance or release block.

Verification: cross-check every supported claim against recorded evidence and verify the released revision identifier before approval.

Definition of done:
- [ ] No untested hardware or domain capability is represented as verified.
- [ ] Release evidence binds to the exact candidate revision.
- [ ] Owner and safety-lead decision records are complete.

## Task dependency map

| Task | Depends on | Enables | Why the dependency matters |
| --- | --- | --- | --- |
| SO-T1 | Owner names safety lead and non-actuating environment | SO-T2, SO-T3, SO-T4 | Later enforcement and testing cannot be trusted until the real control paths and mode splits are mapped. |
| SO-T2 | SO-T1 | SO-T3, SO-T4, SO-T5 | Test expansion and release review need an explicit control boundary to test against. |
| SO-T3 | SO-T2 | SO-T4, SO-T5 | Recovery and release claims need modality-labeled evidence, not mixed simulator/hardware reporting. |
| SO-T4 | SO-T3 plus explicit owner/safety approval | SO-T5 | Recovery drills and any supervised acceptance must follow the established gates and reporting rules. |
| SO-T5 | SO-T4 | Release or release block | Final approval must consume the completed evidence packet rather than substitute for it. |

## Production acceptance checklist

- [ ] Qualified safety lead and named operator are assigned.
- [ ] Physical stop mechanism, exclusion zone, and calibration procedure are documented and observed.
- [ ] Static Pages limitations versus server/runtime capabilities are disclosed in operator-facing surfaces.
- [ ] Authoritative ledger/storage behavior and restore objectives are approved.
- [ ] Negative tests for authorization, limits, stop behavior, and fail-closed perception/service outages are passing on the candidate revision.
- [ ] Simulator or virtual-arm results are reported separately from any supervised hardware evidence.
- [ ] Recovery drill and release rollback drill are observed and recorded.
- [ ] Public claims are narrowed to what the evidence packet directly supports.

## Changes requiring owner approval

- Any task that authorizes hardware connection, torque enablement, or motion, even for minimal supervised acceptance.
- Any change to the permitted mission set, workspace limits, stop procedure, or operator training expectations.
- Any decision that keeps `localStorage` authoritative, promotes Postgres to authoritative state, or changes data-retention scope.
- Any deployment target, credential boundary, or localhost bridge exposure change.
- Any release note or README change that broadens supported domains, hardware, or verification claims.

## Release and rollback policy

- Do not release on simulator or virtual-arm evidence alone.
- Treat safety-boundary failure, unauthorized-command acceptance, failed restore drill, or revision/evidence mismatch as release blockers.
- If a post-release safety or control-boundary issue appears, stop physical operation first; software rollback is secondary and is not a substitute for an independent physical stop.
- Roll back only to a specifically verified artifact with matching evidence, and record what evidence remains valid after rollback.
- Keep unsupported scenarios blocked in documentation and UI until new evidence is gathered and independently reviewed.
