# Radar Public Release Incremental Upsert v01

This policy defines how the public research collection continues to receive new and corrected data after the website is online. It does not authorize production writes by itself.

## Release model

Every Public Release remains an immutable, checksum-bound package. The recommended post-launch format is a cumulative public snapshot: a later release contains all records that should remain current, including unchanged records, corrected records and newly publishable records.

The planner compares each release row against the current `radar-public-records` projection by exact identity only:

- `ready_create`: the exact Work exists and no current public record exists;
- `ready_update`: the same publication key and identity exist, but release-bound content changed;
- `already_current`: the current public record already equals the release projection;
- `blocked_*`: identity, duplicate or schema ambiguity prevents the whole apply candidate from proceeding.

A package containing 550 records after the first 520-record release might therefore plan as, for example:

```text
ready_create     30
ready_update      4
already_current 516
blocked           0
```

The apply result must converge to all 550 rows being `already_current`.

## Idempotent apply behavior

The lab importer supports two explicit modes:

- `initial`: requires every release row to be `ready_create`;
- `incremental`: permits only `ready_create`, `ready_update` and `already_current`, with zero blockers.

Incremental execution performs:

- authenticated `POST` for `ready_create`;
- authenticated `PATCH` to the exact current record ID for `ready_update`;
- no request for `already_current`;
- no `PUT` or `DELETE` path.

After every create or update, the returned document is checked for publication key, identity key, Work binding, record hash and status. The complete release is then replanned and must converge to `already_current` for every row.

## Omission and withdrawal

Omitting a record from a later package never means deletion, withdrawal or unpublication. This prevents an incomplete exporter run from silently removing public data.

Withdrawal requires a future, separately reviewed mechanism with:

- an explicit target publication key;
- a stated reason and supporting evidence;
- an expected current record hash;
- a dedicated confirmation and audit receipt;
- no title-only targeting;
- rollback instructions.

Until that mechanism exists, the incremental importer rejects delete, rollback and withdrawal flags.

## Identity and overwrite boundaries

Incremental publication retains the same identity rules as the first release:

- `workId` and `siteId` must resolve to the same exact Work;
- title matching is never a fallback;
- a publication key already bound to another identity is blocked;
- duplicate Work IDs, site IDs or current publication keys are blocked;
- the importer never creates Works;
- the importer never writes Works, human assessments, AI rating fields or the old `radar_public` conclusion track.

The Public Release owns only the release-bound projection fields in `radar-public-records`. A later production runner must continue to compare and protect every unrelated table and field.

## Publication sequence after launch

A normal ongoing update should follow this sequence:

```text
new canonical research
→ immutable Public Release package
→ independent package validation
→ authenticated read-only plan against current website state
→ review create/update/blocker partition
→ disposable cloned-database rehearsal
→ require all release rows already_current after apply
→ checksum-bound evidence receipt
→ separately armed production candidate
→ post-production readback and rollback checkpoint
```

No research exporter, scheduled job or website request may skip directly from package generation to production writes.

## Concurrency and release ordering

Production candidates must be serialized. Each candidate should bind:

- the expected current website commit;
- the expected database backup hash;
- the expected previous release ID and records hash;
- the new release ID and records hash;
- the exact create, update and already-current counts from the accepted plan.

If any bound value changes before execution, the candidate expires and must be replanned. Two Public Releases must never apply concurrently.

## Current implementation status

The shared lab importer already implements guarded initial and incremental modes. PR #325 still runs Release 0001 in strict `initial` mode, because the source database has not yet received the first 520 records.

After the initial production stage is separately designed and accepted, the recurring production workflow should reuse the incremental planner and apply semantics while adding production-only backup, lock, rollback and post-apply gates.
