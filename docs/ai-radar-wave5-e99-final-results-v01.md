# Wave 5 E99 Final Research Results v01

This flow installs one complete result package for every remaining previous-E
row in the verified Wave 5 high-impact 230 batch.

## Fixed package

```text
RADAR-WAVE5-E99-FINAL-RESEARCH-RESULTS-v01.zip
SHA-256: 1e4b12a1b9d57aa86ab42292000fc0d268242c00bf9d543cc88a5c1168c98033
```

## Verified outcome

```text
Rows: 99
AI QA passed: 90
AI QA deferred: 9

A: 1
B: 4
D: 54
E: 40

High-impact 230 completed: 230
High-impact 230 remaining: 0
```

## Policy calibration

- Pure BL or male-male romance works move to `D-QUEER-GENERAL`; they are not
  `E-BL-HEAVY` merely because they are non-yuri works.
- Pure heterosexual, male-centered, or non-yuri adult works move to
  `D-GENERAL`.
- Severe yuri-facing male intimacy, past male romance, male substitution,
  route contamination, token-yuri, and severe special risks remain E.
- Ambiguous identities or weakly sourced severe allegations move to
  `D-UNCLEAR` and remain AI-QA deferred.
- Every row remains local-only, `do_not_publish`, and human-review required.

## Source chain

The runner binds the high-impact input/checkpoint, extremes-9 result/checkpoint,
A122 input/checkpoint, critical/high-44 result/checkpoint, remaining-78
result/checkpoint, and policy commit:

```text
Policy commit:
1ee8670db0e67b81a7055e3ce9bcbf9e15f9ee11
```

## Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave5-e99-final-results-v01.ps1"
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- All installed artifacts remain under `data_local`.
