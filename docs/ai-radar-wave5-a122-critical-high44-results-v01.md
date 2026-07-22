# Wave 5 A122 Critical + High 44 Results v01

This flow installs the researched results for audit orders 1–44 from the verified
A122 safety-audit package.

## Fixed result package

```text
RADAR-WAVE5-A122-CRITICAL-HIGH44-RESEARCH-RESULTS-v01.zip
SHA-256: 2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d
```

## Source chain

```text
A122 input ZIP:
903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb

A122 input checkpoint:
9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e

Policy commit:
0091143a6417d28b08a731bbe659cc506e0efa08
```

## Verified outcome

```text
Rows: 44
AI QA passed: 39
AI QA deferred: 5

S: 3
A: 33
B: 5
D: 2
F: 1
```

## Main calibration changes

- Seven inherited route-conflict rows were individually rechecked instead of
  being mechanically reduced for having multiple endings.
- `艾蜜莉` and `HONEY CRUSH` move to `B-FEMALE-NTR`.
- `风岬` and `魔女狂花` move to `B-POWER-IMBALANCE`.
- `零碎的梦` moves to `F-HET-END`.
- Three completed, explicitly established relationships move to
  `S-RELATIONSHIP`.
- Five rows remain deferred because reliable identity, ending, or current-state
  evidence is still insufficient.

## Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave5-a122-critical-high44-results-v01.ps1"
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- Every result remains `do_not_publish`.
