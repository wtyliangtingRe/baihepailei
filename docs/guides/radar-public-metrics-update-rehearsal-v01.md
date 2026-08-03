# Radar Public Metrics update-only rehearsal v01

## Purpose

This package implements and rehearses an **update-only** overlay for the frozen
10,563-row Public Metrics Release:

`RADAR-PUBLIC-METRICS-10563-0001`

It operates only against a newly restored disposable PostgreSQL database. It
contains **No production authorization** and must not write the source database.

## Locked inputs

- base `main`: `62768b16d7f2bba102bb4391999b479b1fda4110`
- Research head: `c2fe7847ee8b60b439f8e92025437937ceff06d5`
- plan Candidate SHA-256:
  `7c387dba1e5c6bfa9e3fe312c39b7ff203d969386209c02536b821f03f923b21`
- plan review ZIP SHA-256:
  `6f724b85a0f125bc99d3b0074f9f017609b7acff9b91ddfa5bb3b570afa544c5`
- schema execution receipt SHA-256:
  `aaaf3a2d0e05ed565e673198a9b134717945b56b49038b97243d958d60ed63a2`
- apply-time backup SHA-256:
  `e9fc00aa5e66cb4d03c34397da80df21c5b109ccb0bed6b967ad9c41dad3fae5`

## Initial and final state

The independently reviewed read-only plan requires exactly:

```text
initial wouldUpdate       10,563
initial alreadyCurrent         0
missingRating                  0
identityMismatch               0
blocked                        0
```

The disposable apply must perform exactly 10,563 `PATCH` requests to exact
numeric `radar-public-ratings` IDs. The final plan must contain exactly 10,563
`alreadyCurrent` rows.

## Permitted fields

Each PATCH body contains exactly:

1. `confidencePercent`
2. `evidenceCoveragePercent`
3. `metricsPolicyVersion`
4. `sourceMetricsPolicyVersion`
5. `relationshipEvidenceState`
6. `metricsSourceReleaseId`
7. `metricsCalculationBasisSha256`
8. `requiresMetricReview`

No identity, title, grade, reasoning, human-review, Work relation, provenance from
the rating Release, or Public Record field may be included.

## HTTP boundary

Permitted requests:

- GET for marker and collection reads;
- one POST to `/api/users/login` per phase;
- PATCH only to `/api/radar-public-ratings/<numeric-id>` during apply.

Forbidden requests:

- POST create to Public Ratings or Public Records;
- PUT;
- DELETE;
- PATCH to Works, Public Records, users, or any other collection;
- title-based lookup or identity substitution.

## Disposable rehearsal

The PowerShell runner:

1. verifies the exact engineering branch and seven-file boundary;
2. verifies the read-only Candidate, review ZIP, schema receipt, and backup;
3. records a fresh read-only source snapshot;
4. restores the exact apply-time backup into a loopback-only PostgreSQL
   container;
5. starts a nonce-bound temporary Payload instance;
6. runs `plan`, `apply`, and `verify` as three separately marked phases;
7. requires 10,563 PATCH responses and zero create/PUT/DELETE requests;
8. verifies all protected existing-field fingerprints remain unchanged;
9. verifies the expected metric distributions and 299 review flags;
10. proves the source database remained unchanged;
11. destroys the app process and disposable database;
12. emits a checksum-bound text evidence ZIP without database bytes or
    credentials.

## Safety

- source PostgreSQL write: false
- production authorization: false
- production metric import: false
- Works write: false
- Public Records write: false
- human-review write: false
- automatic retry: false
- automatic rollback: false

A successful disposable rehearsal is only evidence for later PR review. A new
post-merge production preflight, fresh backup, apply-once marker, explicit human
authorization, and separate execution receipt remain mandatory.