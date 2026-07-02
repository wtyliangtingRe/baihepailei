# Inspect Radar Seed Attachment Duplicate

## Target

- seedId: seed-0017-百合男子
- canonicalReviewTitle: 百合男子
- reviewGroupKey: 百合男子
- displayTitles: 百合男子 | 百合男子 1 | 百合男子 2 | 百合男子 3 | 百合男子 4
- localWorkKeys: stg_86eb8a83 | MANGA-59631 | row-646 | row-222 | row-294 | row-337 | row-1193

## Current attachments

- mgv2-00287-百合男子: 百合男子 | localWorkKeys=stg_86eb8a83 | row-646
- mgv2-01039-旅人的紫阳: 旅人的紫阳 | localWorkKeys=stg_e2dcd5eb | row-294

## Exact normalized title matches

- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子
- mgv2-00287-百合男子: 百合男子 | seedTitle=百合男子 | normalized=百合男子

## Local work key matches

- stg_86eb8a83 -> mgv2-00287-百合男子: 百合男子
- row-646 -> mgv2-00287-百合男子: 百合男子
- row-294 -> mgv2-01039-旅人的紫阳: 旅人的紫阳

## Extra local key matches outside exact title match

- row-294 -> mgv2-01039-旅人的紫阳: 旅人的紫阳

## Conclusion

Exact normalized title uniquely points to one group, but at least one broad localWorkKey points to another group. Prefer the unique exact title match and route the extra key hit to a review/ambiguity queue.

## Safety

- No Payload write.
- No PostgreSQL write.
- No production code change.