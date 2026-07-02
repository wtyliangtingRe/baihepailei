# Merge Groups v2 Dry-run v0.2 Ready

Status:
- Merge Groups v2 dry-run v0.2 generated successfully.
- Radar seed attachment duplicate issue fixed.
- QA passed with 0 blockers.
- Ready for preview / human review.
- Not ready for importer yet.

Result:
- sourceCandidatesGrouped: 1246
- mergeGroups: 1241
- multiSourceGroups: 5
- radarSeeds: 68
- radarSeedAttachments: 46
- uniqueRadarSeedsAttached: 46
- radarOnlyReviewQueueRows: 22
- radarAttachmentAmbiguityQueueRows: 2

QA:
- readyForMergeGroupsV2Preview: true
- blockers: 0
- warnings: 1

Expected warning:
- radar attachment ambiguity rows: 2

Resolved:
- seed-0017-百合男子 is no longer attached to multiple merge groups.
- weak row-* localWorkKey matches no longer trigger automatic attachment by themselves.
- exact normalized title match has priority.
- ambiguous radar attachment candidates are routed to radarAttachmentAmbiguityQueue.

Use policy:
- This is staging / dry-run / QA only.
- Do not write Payload.
- Do not write PostgreSQL.
- Do not import yet.
- Do not use Wikidata for radar rating.
- Public radar wording must remain: AI 综合，待复核.
- Do not use 最终 / final / permanent wording.

Outputs:
- merge-groups-v2-dryrun-v02.jsonl
- merge-groups-v2-dryrun-v02.json
- merge-groups-v2-dryrun-v02-summary.json
- merge-groups-v2-dryrun-v02-preview.md
- merge-groups-v2-dryrun-v02-qa.json
- merge-groups-v2-dryrun-v02-qa.md
- merge-groups-v2-radar-attachment-decisions-v02.csv
- merge-groups-v2-radar-attachment-ambiguity-queue-v02.csv
- merge-groups-v2-radar-only-review-queue-v02.csv

Safety:
- No Payload write.
- No PostgreSQL write.
- No production code change.
