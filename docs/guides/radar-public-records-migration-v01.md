# Radar Public Records Migration v01

This stage registers the unrated `radar-public-records` collection and generates an additive Payload/PostgreSQL migration without executing it.

## Canonical archive

The only supported migration-preparation entrypoint retained in the repository is:

- `scripts/radar/prepare-radar-public-records-migration-v01.ps1`

Its permanent verification assets are:

- `tests/radar-public-records-migration-preparation.test.mjs`
- `.github/workflows/validate-radar-public-records-migration-v01.yml`
- `docs/guides/radar-public-records-migration-v01.md`

The accepted generated artifacts are:

- `src/migrations/20260801_101546_current_schema_baseline_before_radar_public_records_v01.ts`
- `src/migrations/20260801_101546_current_schema_baseline_before_radar_public_records_v01.json`
- `src/migrations/20260801_101551_radar_public_records_v01.ts`
- `src/migrations/20260801_101551_radar_public_records_v01.json`

Temporary fix, recovery, repair and resume wrappers created during debugging were deliberately deleted after the canonical preparer succeeded. They must not be restored or reused. The regression suite requires that the canonical preparer remain the only PowerShell entrypoint whose name contains `radar-public-records-migration`.

## Accepted local identity baseline

The first real `RADAR-PUBLIC-RELEASE-0001` plan was run against the authenticated local Payload instance on 2026-08-01.

- public release rows: 520
- authenticated Works rows read: 35,615
- exact `workId + siteId` matches: 520
- ready create: 520
- blocked: 0
- title-only matching: false
- Payload writes: false
- PostgreSQL writes: false
- decision: `accept_public_release_plan_dry_run`

The anonymous API exposed 35,611 Works while the authenticated planner read 35,615. The four protected records do not affect this release because all 520 identities matched in the authenticated view.

## Migration preparation boundary

The preparer:

1. patches `payload.config.ts` to register `RadarPublicRecords` behind `RADAR_PUBLIC_RECORDS_SCHEMA_READY`;
2. creates a snapshot-only baseline with the new collection disabled;
3. creates the additive migration with the new collection enabled;
4. checks that generated DDL only creates or alters `radar_public_records*` tables and enums;
5. removes its repository-local temporary Payload config before workspace validation;
6. reruns schema, release, planner and migration tests;
7. optionally commits and pushes the generated files.

It does **not** run `payload migrate`, write Public Release records, modify Works, or update either rating track.

## Accepted preparation receipt

The canonical preparer completed successfully on 2026-08-01 and pushed migration commit:

- preparation commit: `ba465781e321c0c9e888c7271229648df2674d8d`
- local tests before generation: 19 passed, 0 failed
- local tests after generation: 19 passed, 0 failed
- PostgreSQL session: read-only
- database migration executed: false
- Payload writes: false
- Works mutations: false
- Public Record writes: false
- result: `accept_repaired_migration_preparation`
- recovery result: `accept_failed_migration_recovery`

Payload's Windows migration generator emitted mixed space-plus-tab indentation and trailing whitespace in the generated TypeScript migration. The accepted artifact was normalized without changing SQL semantics, and the regression suite now rejects mixed indentation and trailing whitespace.

## Local command

For archival reproduction before this stage is merged, use only:

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\prepare-radar-public-records-migration-v01.ps1" `
  -CommitAndPush
```

The repository must be clean and the expected branch must exactly match `origin/agent/radar-public-records-migration-v01` before generation begins. Do not run the preparer again after the accepted migration artifacts already exist unless intentionally rebuilding the stage on a fresh branch.

## Reuse checklist for a later additive collection

Copy the canonical preparer into a new, versioned script and change all stage-specific constants together:

1. expected branch;
2. baseline and migration names;
3. collection import, schema flag and registration anchors;
4. allowed table and enum prefixes;
5. forbidden existing tables and protected fields;
6. generated-artifact tests and workflow paths;
7. migration runbook and receipt names.

Retain these invariants:

- isolated temporary migration directory;
- `default_transaction_read_only=on` during schema comparison;
- no `payload migrate` in the preparation stage;
- exact generated artifact inventory;
- temporary config cleanup before `git status` validation;
- DDL allowlist plus protected-table denylist;
- pre-generation and post-generation tests;
- TypeScript and whitespace checks;
- narrow staged-file verification before commit.

## Later stages

After the generated migration is reviewed and merged:

1. apply it only to an isolated cloned database;
2. run the 520-row import in the isolated database;
3. rerun the planner and require 520 `already_current` rows;
4. verify Works and both assessment tracks remain byte-for-byte or field-for-field unchanged;
5. prepare a one-shot production candidate with backup, rollback and receipt gates.
