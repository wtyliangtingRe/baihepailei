# Radar Public Metrics production apply-once gate v01

## Current stage

This branch now contains the accepted candidate lock plus a non-executable production runtime contract.

It binds the accepted post-merge source-read-only Candidate, the accepted
disposable update-only rehearsal, the frozen Research Release, and the exact
merged website `main`:

`cba94510c6ed460f821d82179e24d9a61ee28f5c`

No production importer, marker, apply runner, production authorization or
database write is introduced in this first commit.

## Accepted inputs

- Research head: `c2fe7847ee8b60b439f8e92025437937ceff06d5`
- Release: `RADAR-PUBLIC-METRICS-10563-0001`
- post-merge Candidate SHA-256:
  `cc8757e41be8ef51e8331e9e19d59d9fadb2ad8e2ca1eba9e2a8357f7bdea6b7`
- post-merge independent-review ZIP SHA-256:
  `d044479131e8ce77f01901ea092970a2a72c69deecc3382cfbc625fca1c69d83`
- post-merge audit Markdown SHA-256:
  `88f84319459f9627f1296a3ba85f0ac51e7c4a71bb3a947a5e258d561454f9e3`
- post-merge audit JSON SHA-256:
  `b96b2f1561bc7cc5e465ac6a0e06f400f230da1dfb14b2a3857da18530f8d025`
- accepted disposable rehearsal ZIP SHA-256:
  `1474267b2d53ecf08209afb0eb2bf6f8d01c2fbdba9a1f5845b23f3f86b67b0f`

## Required implementation gates

Later commits on this same Draft PR must add and independently validate:

1. a production-specific nonce-bound loopback marker;
2. an update-only importer that preserves the already-reviewed exact eight-field
   PATCH body;
3. a fresh same-window source backup;
4. a full disposable restore rehearsal of the production gate;
5. writer isolation and source-container identity checks;
6. PostgreSQL advisory locking and a durable apply-control marker;
7. exact `plan -> apply -> verify` convergence;
8. failure receipts with no automatic retry or rollback;
9. a separate post-merge production-authorization artifact;
10. a typed operator confirmation immediately before the first source PATCH.

## Safety state

```text
source database write       false
Payload write               false
production metric import    false
production authorization    false
executable production gate  false
```

This Stage A commit cannot execute or authorize the production update.

## Stage B1 — production runtime contract

Stage B1 adds:

- a nonce-bound loopback-only production marker;
- explicit `rehearsal` versus `production` execution modes;
- strict authorization parity:
  - rehearsal requires `productionAuthorization = false`;
  - production requires `productionAuthorization = true`;
- strict database identity separation;
- the exact eight-field metric PATCH contract;
- GET, login POST and exact numeric rating PATCH as the only permitted HTTP
  surface.

Stage B1 deliberately does **not** export or include an executable importer,
source apply runner, backup executor or database connection path.

```text
production marker             present
runtime write contract        present
executable production import  false
source database access        false
production authorization      false
```

## Stage B2 — executable gate, still unauthorized

Stage B2 adds the complete production-gate engineering surface:

- the production importer, derived from the already accepted update-only
  rehearsal contract;
- exact numeric database-ID PATCH only;
- the same eight reviewed Metrics fields;
- `plan -> apply -> verify` closed-world convergence;
- a fresh backup binding supplied by a separate authorization artifact;
- writer isolation for production mode;
- a PostgreSQL advisory lock held for the full operation;
- an atomic durable apply-control marker that refuses automatic reruns;
- failure receipts with no automatic retry or rollback;
- a disposable rehearsal driver that creates a fresh source `pg_dump`, restores
  it into a uniquely named temporary database, and runs the exact gate in
  `rehearsal` mode.

The production branch remains unauthorized. The apply-once runner refuses real
source execution unless all of these are true:

1. it runs from exact merged `main`;
2. a separate post-merge production authorization artifact is present;
3. the artifact binds the exact tool HEAD, Candidate SHA, source container,
   database and fresh backup;
4. the authorization is no older than 30 minutes;
5. the operator supplies the exact production confirmation string.

```text
production importer             present
apply-once runner               present
disposable rehearsal driver     present
fresh backup required           true
advisory lock required          true
durable apply-control required  true
automatic retry                 false
automatic rollback              false
production authorization        false
real source execution           not authorized
```

The next gate is to execute the disposable production-gate rehearsal and
independently audit its evidence ZIP. No production execution is allowed before
that evidence is accepted and this PR is merged.

## Stage C — final rehearsal remediation

The first exact Stage B2 disposable execution proved:

- 10,563 update-only PATCH requests converged;
- source database before/after state was byte-identical;
- production authorization remained false.

The independent audit did not accept that ZIP as the final rehearsal because:

1. the acceptance receipt used `sourceDatabaseWrite: true` for the disposable
   target write;
2. PostgreSQL truncated the overlong disposable database identifier;
3. the durable apply-control marker body was not included in the ZIP.

This remediation commit:

- distinguishes `targetDatabaseWrite` from `sourceDatabaseWrite`;
- records source-write risk only in production mode;
- asserts `current_database()` exactly;
- limits the disposable database name to 63 UTF-8 bytes;
- binds the apply-control path and SHA-256;
- verifies the completed control state;
- includes `apply-control-marker.json` in the final evidence package.

The prior ZIP remains preserved as remediation evidence only. A single final
disposable rehearsal of the exact repaired HEAD is required before review.
Production authorization remains closed.
## Stage D — final disposable rehearsal accepted

The exact repaired HEAD
`1ce8f3df61063105ebbc66df0eb9f879d56d87ea`
completed the final disposable production-gate rehearsal.

Accepted final evidence:

- ZIP:
  `public-metrics-production-gate-20260804-131816-4ac226c7-evidence-v01.zip`
- bytes: `2000446`
- SHA-256:
  `187021c234751ef9ea3cd69bc9830e914b926ab6c68378bdf874ee77c23d5140`
- independent audit Markdown SHA-256:
  `4aaeead0ae65da6c475e91d72125602d6315cff3b7d698aa760fa3068c7cd9c4`
- independent audit JSON SHA-256:
  `6f7cea1cfc32317ca6aaa23bdc78cc902badb995a45f2a97ab0107716910a216`

The independent audit confirmed:

```text
initial wouldUpdate        10,563
PATCH requests             10,563
final alreadyCurrent       10,563
POST create / PUT / DELETE 0 / 0 / 0
target disposable write    true
source production write    false
source before/after         byte-exact
apply-control state         completed
production authorization   false
```

This acceptance closes the disposable rehearsal gate. It does not authorize
merging the PR and does not authorize a production write. The PR remains Draft
for code and evidence review. Any production execution still requires the exact
merged `main`, a fresh same-window backup, and a separate short-lived post-merge
production authorization artifact.
## Stage E — final code review remediation

The final 11-file review of evidence-binding head
`1fe59d98aea9c6cc690fbf3357259006d04a2e48` found four production-only
blocking gaps that the disposable rehearsal could not exercise:

1. the runner verified backup path, SHA-256 and bytes but did not enforce backup
   age, source identity or the backup-to-authorization time relationship;
2. a materially future-dated authorization could pass and `expiresAt` was not
   explicitly required to follow `createdAt`;
3. the typed confirmation was checked at runner startup rather than immediately
   before entering the first production PATCH loop;
4. a failure after apply could leave writers stopped while the failure receipt
   incorrectly reported that writer-restart inspection was unnecessary.

This remediation:

- binds `freshBackup` to exact container ID, image, database and user;
- requires the backup to be no older than 30 minutes, within 15 minutes before
  authorization creation, and consistent with the local file timestamp;
- rejects future-dated authorization outside a two-minute clock-skew allowance
  and requires `expiresAt > createdAt`;
- prompts for a second production-only phrase inside the importer after the
  final pre-plan and immediately before the PATCH loop;
- records only the confirmation timestamp;
- derives writer-restart inspection from actual stopped/restarted state.

The prior final rehearsal remains accepted behavior evidence for its exact old
head, but it no longer accepts the newly changed importer/runner hashes. PR #338
remains Draft, all production authorization remains false, and one replacement
disposable rehearsal plus independent audit is required before Ready for review.
## Stage E — replacement rehearsal schema closure

The first replacement rehearsal attempt on
`ea99394ae6f0d3f96fdfde61445946f3b4e5ed14` stopped before `plan`.

The source database identity and restored disposable initial state were exact.
No Payload application phase started and no metric PATCH occurred.

The failure was a closed schema mismatch: the hardened runner records the
fresh-backup source binding in its durable apply-control marker, while the
rehearsal authorization still contained only `path`, `sha256`, and `bytes`.

This remediation makes the rehearsal authorization carry the same complete
fresh-backup provenance needed by the control marker:

- `createdAt`;
- source container ID;
- source image;
- source database;
- source database user;
- explicit `sourceDatabaseWrite: false`.

The failed attempt is not resumable and is not accepted as evidence. A new
replacement disposable rehearsal is required. Production authorization remains
closed.
## Stage F — replacement disposable rehearsal accepted

The current PR HEAD
`67b8faa2b975c9528ce70a333c4a74f771c019ec`
completed the replacement disposable production-gate rehearsal.

Accepted evidence:

- ZIP:
  `public-metrics-production-gate-20260804-150026-9e777365-evidence-v01.zip`
- bytes: `1987405`
- SHA-256:
  `224658a4797c795f6b2603bbac865a87e77b223d8434de2225628909e0d94555`
- independent audit Markdown SHA-256:
  `ba5e1b30f06c0b0b327e8b03722831934f8d36b6e2b515be83d83e2dd9be6dca`
- independent audit JSON SHA-256:
  `b1e0bcb99e4dc55d446ee92d34211b31f47ebf2ca6c32f2ab69048d37887fbfc`
- independent checks: `121 / 121`

```text
initial wouldUpdate        10,563
unique numeric PATCH IDs   10,563
final alreadyCurrent       10,563
missing / mismatch / block 0 / 0 / 0
POST create / PUT / DELETE 0 / 0 / 0
source before / after       byte-exact
target disposable write    true
source production write    false
apply-control state         completed
production authorization   false
```

In rehearsal mode, `applyControl.freshBackupCreatedAt` is null by design. The
timestamp remains exact in the backup binding and rehearsal authorization, while
the control binds the backup path, SHA-256, bytes, source container, image,
database and user. Production mode still enforces the strict timestamp and
authorization windows.

This closes the replacement rehearsal gate. It does not mark the PR Ready,
authorize merging, or authorize production execution. The next gate is CI on
the evidence-binding commit followed by final PR review.
## Stage G — final PR review accepted

The exact evidence-binding HEAD
`2a3167deb52542d50f3b1706c4721fd5cdfb32bc`
passed CI run `30890582574` and the final 11-file PR review.

Final review state:

```text
changed files             11
commits                   9
comments                  0
review submissions        0
review threads            0
requested reviewers       0
replacement audit         121 / 121
blocking findings         0
```

The latest evidence-binding commit changed only workflow assertions, the lock,
the guide and the lock test. It did not change the importer, production runner,
rehearsal executor or runtime contract.

The final review also closes two non-blocking maintenance findings:

1. the PR-body control character caused by PowerShell backtick interpolation;
2. a duplicate workflow assertion.

Authorization after this stage:

```text
mark PR Ready             true
merge PR                  false
production write          false
production authorization  false
metric import authorized  false
```

After CI succeeds on this final-review acceptance commit, PR #338 may be marked
Ready for review. Merging and production execution remain separate later gates.
