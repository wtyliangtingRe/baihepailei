# Source-review deltas

`reviews.jsonl` and its manifest remain the frozen base snapshot. The optional `review-deltas.jsonl` is a JSONL overlay consumed by the public release loader. Each row contains `prior` (the exact previous source-review record, or null if absent) and `review` (the replacement or new record). The loader refuses duplicate IDs, identity mismatches and stale replacements. Identical already-integrated records are no-ops.

The first two rows concern one canonical anthology (6400, member 37354). The E warning concerns the Canno short only; seven other shorts have not been individually assessed. No new catalog IDs are allocated.

When regenerating the base snapshot from research, reconcile/remove any integrated or superseded deltas in the same commit. Do not adjust the old base manifest to count overlays. Runtime counts include the effective rows; the source-review test checks both base integrity and effective counts.
