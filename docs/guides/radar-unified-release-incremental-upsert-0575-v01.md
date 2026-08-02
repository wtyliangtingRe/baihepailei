# Radar Unified Fact and Rating Upsert v01

## Model

Every accepted cumulative Release contains two projections in identical identity order:

- `records.jsonl` → `radar-public-records`;
- `ratings.jsonl` → `radar-public-ratings`.

Both bind to the same exact `workId + siteId` identity. Titles are never an identity fallback.

## Plan states

Each projection is independently classified as:

- `ready_create` — no current projection exists;
- `ready_update` — the same exact identity exists but Release-owned content changed;
- `already_current` — the stored projection already equals the Release;
- `blocked_*` — duplicate, missing or conflicting identity prevents execution.

A Release row is executable only when both its fact and rating projections are unblocked.

## Current first import

The source database has neither public projection collection, so the first accepted lab plan is:

```text
facts ready_create     575
ratings ready_create   575
blockers                 0
```

After execution, both projections must replan as:

```text
facts already_current   575
ratings already_current 575
```

## Hypothetical previous-release state

The offline planner also proves compatibility with a database that already contained the old 520 fact-only Release:

```text
facts ready_update      520
facts ready_create       55
ratings ready_create    575
blockers                  0
```

This protects future migrations or restored snapshots, but it is not the current production starting state.

## Apply behavior

The guarded lab importer allows only:

- authenticated `POST` for `ready_create`;
- authenticated `PATCH` to the exact current document ID for `ready_update`;
- no request for `already_current`;
- no `PUT`;
- no `DELETE`;
- no Works creation or update.

Every write response is checked for publication key, identity key, Work relationship, snapshots and current status. The full Release is then replanned from a fresh read.

## Omission and withdrawal

Omission from a later Release never means deletion, withdrawal or unpublication. A future withdrawal mechanism must be separately reviewed and require an explicit publication key, expected current hash, reason, evidence and rollback receipt.

Until then:

```text
omissionMeansDelete       false
explicitWithdrawalRequired true
```

## Ownership boundaries

The fact projection owns only:

- public research state;
- evidence-bound facts;
- evidence references;
- Release provenance and record hashes.

The rating projection owns only:

- core/best/likely/worst grades;
- matched public classes;
- public reasoning and unresolved dimensions;
- tag/warning hints;
- blank or future moderated review data;
- rating provenance and hashes.

Neither projection overwrites:

- `Works.radarAssessment`;
- `Works.humanAssessment`;
- `Works.rank`;
- old `radar-public-conclusions`;
- unrelated facts, tags or site content.

## Future cumulative releases

A later cumulative Release may contain unchanged, corrected and newly researched works. Normal sequence:

```text
private canonical research
→ immutable cumulative Release
→ checksum and exact-identity validation
→ read-only current-state plan
→ disposable cloned-database rehearsal
→ require both projections already_current
→ checksum-bound evidence
→ separately armed production candidate
→ post-apply verification and rollback checkpoint
```

Two Release candidates must never execute concurrently. Every candidate must bind the website commit, research commit, previous Release hashes, new Release hashes, backup hash and exact create/update/current partitions.

This policy does not authorize production writes.
