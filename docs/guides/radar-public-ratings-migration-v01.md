# Radar Public Ratings Migration v01

## Purpose

Register a separate `radar-public-ratings` Payload collection and generate one additive PostgreSQL migration for the accepted unified release:

```text
RADAR-UNIFIED-RATING-RELEASE-0575-0001
```

This stage does not execute the migration and does not import any of the 575 records or ratings.

## Separation boundary

`radar-public-ratings` stores the public machine-rating projection only:

- exact Work identity snapshots;
- core / best / likely / worst grades;
- public matched rule classes;
- fact and evidence references;
- concise reasoning and unresolved dimensions;
- public tag and warning-template hints;
- blank, non-blocking human-review state;
- source and release hashes.

It must not overwrite:

- `Works.radarAssessment`;
- `Works.humanAssessment`;
- `Works.rank`;
- `radar-public-conclusions`;
- `radar-public-records` facts or evidence.

## Local preparation

Run from the repository root in PowerShell 7:

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\prepare-radar-public-ratings-migration-v01.ps1" `
  -CommitAndPush
```

The runner:

1. preserves local `next-env.d.ts` and `payload-types.ts` modifications;
2. rejects every other unexpected dirty path;
3. fast-forwards the exact migration branch;
4. runs the locked Release planner, collection-schema and migration-preparation tests;
5. runs TypeScript checking without installing packages;
6. registers the collection behind `RADAR_PUBLIC_RATINGS_SCHEMA_READY`;
7. invokes only `payload migrate:create` with a read-only PostgreSQL session;
8. requires exactly one TypeScript migration and one JSON snapshot;
9. rejects DDL outside the `radar_public_ratings*` table and enum prefixes;
10. verifies that the generated snapshot retains Works and `radar_public_records`;
11. reruns tests, TypeScript checking and `git diff --check`;
12. commits and pushes only the generated config and migration files.

## Prohibited actions

The preparer does not run:

- `pnpm install`;
- `payload migrate`;
- PostgreSQL DDL or DML directly;
- Payload API writes;
- Docker database cloning;
- Release import;
- production apply.

## Acceptance before merge

The migration PR may be accepted only when:

- the generated migration creates only `radar_public_ratings*` relations and enums;
- migration down logic removes only those new relations and enums;
- `src/migrations/index.ts` registers the migration exactly once;
- schema, planner, migration and TypeScript checks pass;
- no review threads remain;
- database migration executed is still `false`.

After merge, a separate isolated-database rehearsal will apply the migration and test the 575-row fact + rating import. That rehearsal remains non-production.
