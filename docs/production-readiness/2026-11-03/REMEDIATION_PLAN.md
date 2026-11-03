# SO-101 remediation plan

Proposed work only. No device was accessed or moved. See [review](REVIEW.md). Dependency order: `SO-T1 → SO-T2 → SO-T3 → SO-T4 → SO-T5`.

### SO-T1 — Map real control paths (SO-1, SO-3)
Prerequisite: owner supplies safety lead and approved non-actuating environment. Observed paths: `tools/so101.ts`, `tools/so101-transport.ts`, `public/bridge/so101_bridge.py`, `src/lib/arm.ts`, `src/app/api/`.
1. Trace browser and headless commands from identity through transport to servo writes, including failure and reconnect paths.
2. Inventory static versus server-mode capabilities, calibration dependencies and any physical emergency-stop mechanisms.
3. Record an explicit threat and hazard model with stop conditions, ownership and unverified assumptions.
Deliverable: control/data-flow and hazard record. Verification: independent reviewer traces one denied command and one communication failure without actuating hardware.
- [ ] Every real actuator path and authority is identified.
- [ ] Simulation, server and static capabilities are distinguished.

### SO-T2 — Enforce safety and trust boundaries (SO-1)
Prerequisite: SO-T1 and safety lead approval. Observed paths: `src/lib/arm.ts`, `src/lib/kinematics.ts`, `tools/so101.ts`, `public/bridge/so101_bridge.py`.
1. Define independent physical stop, workspace and joint limits, safe speed, torque state and fail-closed behavior for lost communications.
2. Enforce authorization and deterministic command validation at each actuator entry point; ensure model or sensor output cannot itself authorize motion.
3. Test stale calibration, malformed commands, disconnected sensors, unauthorized clients and stop/reconnect in a simulated or non-actuating harness.
Deliverable: enforced control boundary and documented safety procedure. Verification: deliberately bypass a limit or authorization check in an isolated mutation and observe an appropriate negative test fail.
- [ ] Limits, stop and failure states are testable and independently reviewed.
- [ ] Advisory inputs cannot grant actuation authority.

### SO-T3 — Expand verification with honest modality labels (SO-2)
Prerequisite: SO-T2. Observed paths: `package.json`, `src/lib/__tests__/all-missions-live.test.ts`, `src/lib/__tests__/detect.test.ts`.
1. Run the existing lint, typecheck and default tests in a clean environment; record skipped suites and failures.
2. Run the separately defined extended virtual suite and add behavior-based tests for unknown ledger outcomes, limits and emergency-stop handling.
3. Add CI gates for non-hardware tests and report simulated outcomes separately from observed hardware results.
Deliverable: reproducible modality-labeled test evidence. Verification: mutation of an unknown-to-pass mapping or stop check must fail a relevant test.
- [ ] Default and extended virtual results are recorded separately.
- [ ] No simulation result is described as physical validation.

### SO-T4 — Recovery, static UX and supervised hardware acceptance (SO-3, SO-4)
Prerequisites: SO-T3; explicit owner and safety operator approval. Observed paths: `.github/workflows/pages.yml`, `src/db/index.ts`, `src/components/`, `tools/so101.ts`.
1. Label absent static API features and simulation/live mode; test keyboard access and conspicuous stop/error states.
2. Decide ledger authority and backup objectives; exercise actual isolated restore and release rollback using synthetic records.
3. Only under qualified supervision and physical safeguards, conduct approved non-actuating checks, read back device state, then a separately authorized minimal motion test with an immediate stop path.
Deliverable: mode-specific acceptance, recovery and supervised hardware record. Verification: observe state read-back, safe stop and restored data; document any unverified state rather than guessing.
- [ ] Static and server-mode behaviors are independently checked.
- [ ] Recovery and any authorized hardware checks are observed, not inferred.

### SO-T5 — Independent release decision (preventive)
Prerequisite: SO-T4. Observed paths: `README.md`, `docs/specs/`; proposed safety/release record.
1. Compare product claims with measured supported hardware, domains and detector vocabulary.
2. Independently repeat critical negative, stop and recovery checks on the candidate revision.
3. Have the owner and safety lead accept residual risks and approve or block deployment.
Deliverable: bounded claims and signed acceptance. Verification: confirm deployed revision and evidence for each supported claim.
- [ ] No untested domain or hardware capability is represented as verified.
- [ ] Owner, safety lead, release and rollback decisions are recorded.

## Gate and rollback

Owner must approve hardware, operators, safeguards, scope, credentials, data retention and recovery objectives. Never promote on simulator tests alone. Roll back to a verified artifact and stop physical operation on a safety or control-boundary failure; a release rollback is not a substitute for an independent physical stop.
