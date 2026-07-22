# AI Radar Wave 5 Priority-35 Results v0.1

This stage installs and verifies the first 35 high-priority remediation results from
`RADAR-WAVE5-DEFERRED-REMEDIATION-8183-input-v01.zip`.

## Fixed package

```text
Package: RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-v01.zip
SHA-256: a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f

Source Wave 5 input ZIP:
9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3

Source Wave 5 input checkpoint ZIP:
c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76
```

## Verified outcome

```text
Rows: 35
AI QA passed: 34
AI QA deferred: 1
A: 3
D: 32
```

Rule distribution:

```text
A-NEAR-CONFIRMED: 2
A-YURI-HAREM: 1
D-ABO: 1
D-MULTI-ENDING: 15
D-GENERAL: 15
D-UNCLEAR: 1
```

The runner verifies the package ZIP hash, every nested SHA-256 entry, source-chain
binding, fixed summaries, row-level safety declarations, unique identities, and the
exact all/passed/deferred identity partition before installing files under `data_local`.

## Windows command

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File `
  ".\scripts\radar\run-ai-radar-wave5-priority35-results-v01.ps1"
```

The runner creates:

```text
data_local/outputs/ai-radar/checkpoints/
RADAR-WAVE5-PRIORITY35-RESEARCH-RESULTS-checkpoint-v01.zip
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- Every result remains `do_not_publish` and requires human review.
