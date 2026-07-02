# Merge Groups v2 Dry-run v0.2 Preview

## Summary

- mergeGroups: 1241
- sourceCandidatesGrouped: 1246
- multiSourceGroups: 5
- radarSeeds: 68
- radarSeedAttachments: 46
- uniqueRadarSeedsAttached: 46
- radarOnlyReviewQueueRows: 22
- radarAttachmentAmbiguityQueueRows: 2
- uniqueRadarSeedsInAttachmentAmbiguityQueue: 2

## Attachment methods

- exact_normalized_title_unique: 46

## Ambiguity queue sample

- seed-0002-出轨-ntr百合短篇集: selected=none conflict=mgv2-01146-女装少年短发妹 key=row-912 reason=weak row localWorkKey match only and no exact title match
- seed-0017-百合男子: selected=mgv2-00287-百合男子 conflict=mgv2-01039-旅人的紫阳 key=row-294 reason=ignored_local_work_key_hit_because_exact_title_was_unique

## Safety

- No Payload write.
- No PostgreSQL write.
- No production code change.