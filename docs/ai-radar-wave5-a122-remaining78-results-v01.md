# Wave 5 A122 Remaining 78 Results v01

This recovery flow installs one complete result package for every unprocessed
A122 audit row after the critical/high-44 batch.

## Fixed package

```text
RADAR-WAVE5-A122-REMAINING78-RESEARCH-RESULTS-v01.zip
SHA-256: 8890a2afc4c16e9c90fcf03d6d922dececb129d3c1359931c3cf8155f1de0ee1
```

## Verified outcome

```text
Rows: 78
AI QA passed: 72
AI QA deferred: 6
S: 21
A: 47
B: 5
D: 5
```

## Main calibration behavior

- Established female relationships and marriages are promoted to S only when
  the relationship evidence is explicit.
- All-female multi-route works remain A-YURI-HAREM rather than being reduced
  mechanically for having multiple endings.
- Light relationship evidence, female triangle risk, or an abruptly unfinished
  work can reduce a prior A row to B.
- Generic titles, mismatched external IDs, and unresolved aliases remain
  D-UNCLEAR and AI-QA deferred.
- This one package closes audit orders 45 through 122 in a single recovery run.

## Fixed source chain

```text
A122 input ZIP:
903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb

A122 input checkpoint:
9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e

Critical/high-44 result ZIP:
2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d

Critical/high-44 checkpoint:
5e23e6da9b767362a1a44580b6f325904e70d44d1028efac7d4c4acbd6ade46e

Policy commit:
ebd74a16fa0fec25b794ee84a728ccbcd5009457
```

## Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave5-a122-remaining78-results-v01.ps1"
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- All artifacts remain under `data_local`.
