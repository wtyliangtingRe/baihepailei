# Merge Groups v2 Dry-run v0.2 QA

readyForMergeGroupsV2Preview: true

## Checks

- mergeGroups: 1241
- sourceCandidatesGrouped: 1246
- multiSourceGroups: 5
- radarSeedsInput: 68
- radarSeedAttachments: 46
- uniqueRadarSeedsAttached: 46
- groupsWithRadarSeedRefs: 46
- radarOnlyQueueRows: 22
- radarAttachmentAmbiguityQueueRows: 2
- uniqueRadarSeedsInAttachmentAmbiguityQueue: 2
- duplicateMergeGroupIds: 0
- duplicateAttachedSeedIds: 0
- missingRadarSeeds: 0
- radarSeedsBothAttachedAndRadarOnly: 0

## Blockers

- none

## Warnings

- radar attachment ambiguity rows: 2

## Safety

- No Payload write.
- No PostgreSQL write.
- No production code change.