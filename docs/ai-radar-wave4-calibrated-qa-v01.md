# AI Radar Wave 4 calibrated assessment and legacy QA v0.1

## Scope

This stage consumes the verified Wave 4 research checkpoint and installs two independent local-only tracks:

1. calibrated assessments for the ten newly research-ready identities;
2. rule/evidence QA for 10,223 reusable historical assessments.

It does not write Payload, PostgreSQL, Works, published ratings, or the human-review track.

## Verified package

```text
RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-v01.zip
SHA-256: eeebc2474a98e0c5e89348aabb8ceb1f038a076da0b46c16b827a40daf158ec6
```

Source chain:

```text
Wave 4 complete result ZIP:
3a99ee6aad204bce0b26329b7543ea0b7eae92d862ce2db2aca0d156a113072d

Wave 4 Windows checkpoint ZIP:
552b7f3e1ff3f7a3f909e0932dd972a92fd03ba64830d2d63619f54a77fcce66
```

## New assessments

```text
rows: 10
A: 6
E: 4
AI QA passed: 8
AI QA deferred: 2
publication ready: 0
```

Deferred rows retain explicit unresolved evidence requirements rather than receiving an unsafe pass.

## Historical QA

```text
rows: 10,223
passed: 1,200
passed with caution: 839
deferred for evidence: 8,148
deferred for route review: 32
deferred for rule conflict: 4

validated: 2,039
deferred: 8,184
publication ready: 0
```

The QA checks rule/grade alignment, evidence strength, generalized route handling, S-grade gates, and known calibration-sensitive rules. It does not pretend to replace missing source research.

## Windows command

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File `
    ".\scripts\radar\run-ai-radar-wave4-calibrated-qa-v01.ps1"
```

The runner:

- locates the fixed ZIP in Downloads or `data_local`;
- verifies the package ZIP and every nested SHA-256;
- verifies all fixed row counts and unique identities;
- installs separate local queues;
- runs recovery tests;
- creates one compact checkpoint ZIP.

Upload only:

```text
data_local/outputs/ai-radar/checkpoints/
RADAR-WAVE4-CALIBRATED-ASSESSMENT-AND-LEGACY-QA-checkpoint-v01.zip
```

## Safety

- no Payload write;
- no direct PostgreSQL write;
- no Works mutation;
- no rating publication;
- no human-review-track mutation;
- artifacts remain under `data_local`.
