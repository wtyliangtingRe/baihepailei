# Work merge four-stage summary

This note records the current outcome of the work-merge automation pass.

## Current status

| Stage | Input groups | Result | Data write |
|---|---:|---|---|
| Stage 1: strict-safe | 18 | completed | yes |
| Stage 2: strict-review | 19 | completed | yes |
| Stage 3: review | 28 | all deferred | no |
| Stage 4: held/id-conflict | 231 | all bucketed as id_conflict | no |

## Completed merge scope

The completed automatic merge scope is 37 groups:

- 18 strict-safe groups.
- 19 strict-review groups.

For those 37 groups, the selected master record stayed visible, supplement records were hidden from the lite surface, and search/detail indexes were reconciled to 28,814 work items.

This is the completed safe automatic merge pass. It is not a claim that every candidate group has been merged.

## Remaining possible duplicates

Remaining group-level candidates are split into two kinds:

1. 28 deferred groups.
   - These may still contain real duplicates.
   - They were not safe enough for automatic writes under the current rules.
   - 21 of them involved multiple supplement candidates.

2. 231 id-conflict groups.
   - These all have external_id_conflict and strong cross-source evidence.
   - They are not suitable for ordinary automatic merging.
   - 20 of them also have a multi-member shape.

A practical estimate is therefore:

- confirmed and completed duplicate merges: 37 groups;
- unresolved possible duplicate groups: 28 groups;
- conflict candidates that need a separate id-conflict policy: 231 groups.

The 231 id-conflict groups should be treated as a separate research/rules task rather than as ordinary remaining duplicate groups.

## Search and localized titles

The lite search index supports work `aliases` and `localizedTitles`, and includes them in `searchText`.

Important consequence:

- If a translated title or alias is present on the visible master record, search should be able to find it.
- If a translated title or alias only existed on a hidden supplement record and was not copied to the visible master, it will not help search after the supplement is hidden.

Follow-up needed:

- Add a read-only title/alias coverage report for the 37 completed groups.
- Compare hidden supplements against visible masters.
- List missing `aliases` / `localizedTitles` / `originalTitle` values that should be copied safely.
- Only after that, create a controlled apply script for safe alias/title enrichment.

## Source records

The visible canonical record is still the selected master, normally the Bangumi-side record for the completed automatic merge pass.

However, the completed merge pass was designed to preserve extra source traces on the master through fields such as:

- `externalIds`
- `sourceLinks`
- `candidateSources`

So the data model can keep AniList and other source traces on the visible master. If the UI only displays the primary source or `siteId`, the page may still look Bangumi-only even when extra source metadata exists.

Follow-up needed:

- Verify whether the public work detail UI displays `sourceLinks` / `candidateSources`.
- If not, add a UI enhancement so merged source traces are visible.
- For other sources beyond Bangumi/AniList, only merge source records that actually exist in imported data or candidate source fields. Missing upstream data should not be fabricated.

## Recommended next work

1. Title and alias coverage report for the 37 completed groups.
2. Source display coverage report for completed groups.
3. A separate id-conflict analysis plan for the 231 held groups.
4. A stricter multi-member strategy for deferred groups.

## Safety notes

This summary is documentation only. It does not modify Payload, PostgreSQL, indexes, or generated local reports.
