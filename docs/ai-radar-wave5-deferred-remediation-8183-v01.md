# AI Radar Wave 5: 8,183 deferred remediation tasks v0.1

## Scope

Wave 5 is derived from the verified Wave 4 calibrated assessment and legacy QA result.
It carries every deferred content-research item forward in one recoverable package instead of requiring four separate user exports.

```text
Research tasks: 8,183
Policy-only ABO resolutions: 3
Subwaves: 33
Full subwaves: 32 × 250
Final subwave: 183
Five-row chunks: 1,637
```

## Queue order

1. Two newly assessed works deferred for ending or male-involvement evidence.
2. One unresolved ABO plus mother/daughter relationship conflict.
3. Thirty-two multi-route or multi-ending reviews.
4. All S/A/E/F evidence gaps.
5. Rows with primary or multiple-secondary evidence that are closest to validation.
6. Remaining evidence refresh rows ordered by grade impact and likely remediation value.

## Policy-only resolutions

Three historical rows had grade `E` paired only with rule `D-ABO`.
They are reconciled locally to `D / D-ABO`, remain `do_not_publish`, and retain a separate ABO preference-profile signal.

`Sakura no Kioku` is not automatically reconciled because its existing source summary also describes a mother/daughter relationship. It remains a highest-priority targeted research item.

## Recovery model

Each subwave contains:

- an independently hashed source JSONL;
- a handoff manifest;
- one to fifty five-row chunks;
- an exact identity set;
- partial, complete and failed recovery states.

Completed subwaves may be skipped only when the manifest, source, chunks and every declared SHA-256 still match. A partial aggregate must list missing subwaves and identities.

## Windows installation

Save this file in Downloads without extracting it:

```text
RADAR-WAVE5-DEFERRED-REMEDIATION-8183-input-v01.zip
```

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File `
  ".\scripts\radar\run-ai-radar-wave5-deferred-remediation-8183-start-v01.ps1"
```

The runner verifies:

- the fixed package and upstream QA/checkpoint SHA-256 chain;
- all package hashes;
- 8,183 unique task identities;
- 33 subwaves and 1,637 chunks;
- the exact category partitions;
- the three local-only ABO policy resolutions;
- zero formal or human-track writes.

It produces:

```text
data_local/outputs/ai-radar/checkpoints/
RADAR-WAVE5-DEFERRED-REMEDIATION-8183-input-checkpoint-v01.zip
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- All installed artifacts remain under `data_local`.
