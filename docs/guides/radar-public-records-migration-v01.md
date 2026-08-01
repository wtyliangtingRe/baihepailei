# Radar Public Records Migration v01

This stage registers the unrated `radar-public-records` collection and generates an additive Payload/PostgreSQL migration without executing it.

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
5. reruns schema, release and planner tests;
6. optionally commits and pushes the generated files.

It does **not** run `payload migrate`, write Public Release records, modify Works, or update either rating track.

## Local command

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\prepare-radar-public-records-migration-v01.ps1" `
  -CommitAndPush
```

The repository must be clean and the expected branch must exactly match `origin/agent/radar-public-records-migration-v01` before generation begins.

## Later stages

After the generated migration is reviewed and merged:

1. apply it only to an isolated cloned database;
2. run the 520-row import in the isolated database;
3. rerun the planner and require 520 `already_current` rows;
4. verify Works and both assessment tracks remain byte-for-byte or field-for-field unchanged;
5. prepare a one-shot production candidate with backup, rollback and receipt gates.
