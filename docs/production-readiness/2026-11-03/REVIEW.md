# SO-101 Domain Operator review

## Scope and verdict

Robot-control implementation/prototype at `3c962ec85f73e97be626d7fa19f3fe08642460c4`. The snapshot samples README, package manifest, Pages workflow, bridge requirements, database setup, scenario index, Vitest config and selected tests. Motion, serial bridge, API and UI implementation bodies were not inspected. No hardware, simulator, tests, server or deployment was run. Physical safety and product claims remain unverified. [Plan](REMEDIATION_PLAN.md).

## Architecture and product boundary

The README describes a Next.js control deck, headless `tools/so101.ts`, advisory vision and sensors, and a three-valued verification ledger ([README.md:8-17,30-38](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/README.md#L8-L38)). The tree separately lists serial transport, a Python bridge, API routes, simulated scenarios and Postgres integration. These are distinct paths; their actual wiring and interlocks were not traced. Static Pages export intentionally removes API routes ([pages.yml:27-31](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/.github/workflows/pages.yml#L27-L31)).

## Findings

- **SO-1 — High, unverified risk:** README claims `safety interlocks baked in` ([README.md:12-17](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/README.md#L12-L17)), but the actuation and bridge code was not sampled. No evidence here establishes independent emergency stop, joint limits, fail-safe handling or permission enforcement. Do not actuate without a qualified operator, physical safeguards and verified read-back.
- **SO-2 — Medium, confirmed static:** the so-called live mission suite is `live on the virtual arm`, and is skipped unless `LIVE_ALL` is set ([all-missions-live.test.ts:6-14](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/src/lib/__tests__/all-missions-live.test.ts#L6-L14)). Default test success cannot establish real-hardware reachability or even that this extended virtual suite ran. Report simulation separately and require explicit hardware acceptance.
- **SO-3 — Medium, confirmed static:** the Pages workflow states that API routes `cannot exist in a static export` and moves them aside ([pages.yml:27-31](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/.github/workflows/pages.yml#L27-L31)). A successful Pages build does not prove detect, voice, state or health services work. Surface unavailable features and test static and server modes separately.
- **SO-4 — Medium, unverified risk:** `src/db/index.ts` says localStorage is the `source of truth` and Postgres only a backup ([lines 4-9](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/src/db/index.ts#L4-L9)). Backup completeness, ledger integrity, multi-client consistency and recovery are unknown. Define authoritative storage and test actual restore.
- **SO-5 — Informational, historical CI:** the snapshot records successful [Pages deployment](https://github.com/knarayanareddy/so101-domain-operator/actions/runs/37237001713) for this SHA; it is not a hardware or server-mode test.

## Five disciplines

- **Correctness:** three-valued ledger semantics are documented, and detector tests state `detection is evidence, never permission` ([detect.test.ts:12-16](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/src/lib/__tests__/detect.test.ts#L12-L16)). Neither claim proves all live actuation paths enforce that boundary. Five-domain simulation is not real-domain validation.
- **Automation:** `package.json:4-16` defines lint, typecheck, Vitest and separate live-virtual commands. Sampled tests include packet checksum and countdown cases. No test was run; no assertion count proves physical safety.
- **DevOps:** static export differs from the server; database failover, credentials, release rollback and recovery are unverified. Bridge requirements specify broad lower bounds ([requirements:1-3](https://github.com/knarayanareddy/so101-domain-operator/blob/3c962ec85f73e97be626d7fa19f3fe08642460c4/public/bridge/requirements.txt#L1-L3)); resolve and review their provenance.
- **OWASP:** bridge/API authentication, origin checks, command authorization, shell/input injection, credential redaction and data protection were not sampled. Network access to an actuator is a high-consequence boundary, not established secure by a UI label.
- **UI/UX:** control, connect and mission components exist in the tree. Clear simulation/live state, reachable stop, keyboard operation and accessible failures were not inspected or tested.

## Blockers and owner decisions

Owner must designate a qualified safety operator, physical stop and exclusion zone, calibrated hardware and limits, permitted missions, trust boundaries, data retention and deployment environment. Hardware validation requires explicit supervised authorization and read-back; no autonomous movement was performed. Snapshot ranges are README 1-97, manifest 1-43, workflow 1-45, bridge requirements 1-3, DB 1-30, scenario index 1-80, Vitest config 1-7, all-missions 1-39, autorun 1-57, detect 1-220 of 334, driver 1-97 and hanoi 1-51. All other source and real-world performance are outside this sample.
