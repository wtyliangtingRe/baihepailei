# Wave 5 High-Impact Extremes 9 Results v01

This flow installs the fixed result package for the single previous-S row and all
eight previous-F rows in the Wave 5 high-impact 230 batch.

## Fixed package

```text
RADAR-WAVE5-HIGH-IMPACT-EXTREMES9-RESEARCH-RESULTS-v01.zip
SHA-256: 9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578
```

## Source chain

```text
High-impact input ZIP:
323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3

High-impact input checkpoint:
60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb

Policy commit:
2b3f6a088b1c91889e10738c362e8350468477fd
```

## Verified outcome

```text
Rows: 9
AI QA passed: 9
AI QA deferred: 0
S: 1
F: 8
```

## Rule distribution

```text
S-RELATIONSHIP: 1
S-CREATOR-SAFE: 1
F-MALE-NTR: 2
F-PROJECT-CONTAMINATION: 6
```

## Calibration notes

- `安达与岛村SS` remains S based on official relationship, cohabitation, and
  long-term continuity material.
- The first two `捏造トラップ -NTR-` volumes remain F, while the rule set is
  narrowed to the directly supported `F-MALE-NTR`.
- Six Uma Musume records retain `F-PROJECT-CONTAMINATION` because they directly
  inherit the same cross-media project. This does not assert that each individual
  anime contains male romance.
- Two cross-catalog records for the ROAD TO THE TOP theatrical re-edit are marked
  as duplicate candidates.

## Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave5-high-impact-extremes9-results-v01.ps1"
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- All artifacts remain under `data_local`.
