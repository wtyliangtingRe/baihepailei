import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const layout = read('src/app/(frontend)/layout.tsx')
const home = read('src/app/(frontend)/page.tsx')
const works = read('src/app/(frontend)/works/page.tsx')
const detail = read('src/app/(frontend)/works/[slug]/page.tsx')
const ratings = read('src/app/(frontend)/ratings/page.tsx')
const rules = read('src/app/(frontend)/rules/page.tsx')
const feedback = read('src/app/(frontend)/feedback/page.tsx')
const feedbackCss = read('src/app/(frontend)/feedback.css')
const deploymentProfile = read('src/lib/deploymentProfile.ts')
const correctionIssueForm = read('.github/ISSUE_TEMPLATE/work-correction.yml')
const newWorkIssueForm = read('.github/ISSUE_TEMPLATE/new-work.yml')
const publicRelease = read('src/lib/publicRelease.ts')
const publicTags = read('src/lib/radar/publicTags.ts')
const publicSearchTerms = read('src/lib/radar/publicSearchTerms.ts')
const releaseCss = read('src/app/(frontend)/release.css')

assert.match(layout, /AI 综合，待复核/)
assert.match(layout, /评级与资料会随核验结果更新/)

for (const source of [home, works, detail]) {
  for (const internalLabel of ['目录序号', '身份状态', '外部提供方', '外部站点 ID', '研究覆盖']) {
    assert.doesNotMatch(source, new RegExp(internalLabel))
  }
}

assert.ok(
  detail.indexOf('译名与别名') < detail.indexOf('作品基本资料'),
  'translated titles and aliases must have a dedicated reader-facing section before work basics',
)
assert.ok(
  detail.indexOf('作品基本资料') < detail.indexOf('排雷结论'),
  'basic work information must appear before the detailed rating section',
)
assert.ok(
  detail.indexOf('作品介绍') < detail.indexOf('排雷结论'),
  'work summary must appear before the detailed rating section',
)
assert.ok(
  detail.indexOf('排雷结论') < detail.indexOf('资料来源'),
  'sources must remain available after the rating explanation',
)

for (const expected of [
  '译名与别名',
  '其他别名',
  '作者与创作机构',
  'release-work-cover',
  '日期精度',
  '为什么这样评',
  '查看这条规则的判定边界',
  '独立设定与内容提示',
  '官方名',
  '罗马字',
]) {
  assert.match(detail, new RegExp(expected))
}
assert.match(detail, /permanentRedirect\(canonicalContentUrl\('works', work\.workId\)\)/)
assert.match(home, /getPublicCatalogMergeStats/)
assert.match(home, /merge\.visibleWorks/)

for (const expected of [
  'S–F 核心等级',
  '具体警示标签',
  '独立偏好层',
]) {
  assert.match(ratings, new RegExp(expected))
}

for (const expected of ['TS / 性别转换', '扶她设定', 'ABO 设定', '男娘 / 女装设定', '成人 / 性描写']) {
  assert.match(publicTags, new RegExp(expected))
}

assert.match(rules, /50 条细则，完整公开/)
assert.match(publicRelease, /deduplicateCatalog\(/)
assert.match(publicRelease, /normalizeIdentityMergeTitle\(/)
assert.match(publicRelease, /ambiguousTitleKeys/)
assert.match(publicRelease, /unionTitleSafe/)
assert.match(publicRelease, /otherSiteId && otherSiteId !== siteId/)
assert.match(publicRelease, /memberIdsByPrimary/)
assert.match(publicRelease, /radarClassDefinitions\[ratingClass\]/)
assert.match(publicRelease, /record\.publicTags\.flatMap/)
assert.match(publicRelease, /record\.localizedTitles\.flatMap/)
assert.match(publicRelease, /publicSearchTermsForRatingClass\(ratingClass\)/)
assert.match(publicSearchTerms, /'E-MALE-SUBSTITUTE': \['男性替身'/)

assert.match(deploymentProfile, /DEFAULT_PUBLIC_FEEDBACK_ISSUE_URL/)
assert.match(deploymentProfile, /https:\/\/github\.com\/wtyliangtingRe\/baihepailei\/issues\/new/)
assert.match(deploymentProfile, /parsed\.protocol === 'https:'/)
assert.match(feedback, /issueSubmissionHref/)
assert.match(feedback, /work-correction\.yml/)
assert.match(feedback, /new-work\.yml/)
assert.match(feedback, /work_id/)
assert.match(feedback, /work_title/)
assert.match(feedback, /slice\(0, maxLength\)/)
assert.match(feedback, /\^\\d\{1,12\}\$/)
assert.match(feedback, /登录 GitHub 即可提交/)
assert.match(feedback, /匿名文字表单/)
assert.match(feedback, /不接收图片或任何附件/)
assert.match(feedback, /anonymousSubmissionHref/)
assert.doesNotMatch(feedback, /api\/feedback-submissions/)
assert.match(feedbackCss, /\.feedback-channel-grid/)
for (const issueForm of [correctionIssueForm, newWorkIssueForm]) {
  assert.match(issueForm, /id: work_title/)
  assert.match(issueForm, /id: sources/)
  assert.match(issueForm, /required: true/)
  assert.match(issueForm, /不会自动/)
}
assert.match(correctionIssueForm, /id: work_id/)
assert.match(correctionIssueForm, /id: spoilers/)

assert.match(releaseCss, /@media \(max-width: 680px\)/)
for (const responsiveSelector of [
  '.site-footer',
  '.release-public-info-grid',
  '.release-preference-grid',
  '.release-title-table',
]) {
  assert.match(releaseCss, new RegExp(responsiveSelector.replaceAll('.', '\\.')))
}

for (const path of [
  'src/app/(frontend)/browse/page.tsx',
  'src/app/(frontend)/evidence/page.tsx',
]) {
  assert.match(read(path), /redirect\('/)
}

assert.match(read('src/app/(frontend)/creators/page.tsx'), /CreatorDirectory kind="person"/)
assert.match(read('src/app/(frontend)/organizations/page.tsx'), /CreatorDirectory kind="organization"/)
assert.match(read('src/app/(frontend)/_components/CreatorDetail.tsx'), /canonicalContentUrl\('works', work\.workId\)/)
assert.match(detail, /role="doc-noteref"/)

console.log(JSON.stringify({
  siteNotice: 'PASS',
  publicFieldBoundary: 'PASS',
  translatedTitleAndAliasSection: 'PASS',
  mergedWorkCanonicalRouting: 'PASS',
  mergedWorkPublicCounts: 'PASS',
  identitySafeCatalogMerging: 'PASS',
  publicCatalogDeduplicationBoundary: 'PASS',
  detailInformationOrder: 'PASS',
  ratingAndWarningLayers: 'PASS',
  structuredFeedbackIssueForms: 'PASS',
  anonymousWriteBoundary: 'PASS',
  responsiveStructure: 'PASS',
  retiredPublicRoutes: 'PASS',
  status: 'PASS',
}, null, 2))
