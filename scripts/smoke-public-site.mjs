import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const host = '127.0.0.1'
const port = Number(process.env.PUBLIC_SMOKE_PORT || 3100)
const base = `http://${host}:${port}`
let serverOutput = ''

const server = spawn(process.execPath, ['scripts/start-production.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HOSTNAME: host, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-12_000)
  })
}

async function stopServer() {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(2_000),
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
}

async function response(path, init) {
  return fetch(`${base}${path}`, init)
}

async function json(path) {
  const result = await response(path)
  assert.equal(result.status, 200, `${path} should return 200`)
  return result.json()
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) break
    try {
      const health = await response('/api/health')
      if (health.ok) {
        ready = true
        break
      }
    } catch {}
    await delay(250)
  }
  assert.ok(ready, `production server did not become ready\n${serverOutput}`)

  const pages = [
    '/',
    '/works',
    '/works/w-36946',
    '/works/w-4971',
    '/works/w-18556',
    '/ratings',
    '/rules',
    '/radar',
    '/feedback',
    '/creators',
    '/organizations',
  ]
  for (const path of pages) {
    const result = await response(path)
    assert.equal(result.status, 200, `${path} should return 200`)
  }

  const correctionFeedback = await (
    await response('/feedback?workId=18556&title=%E5%AE%89%E9%81%94%E3%81%A8%E3%81%97%E3%81%BE%E3%82%80%E3%82%89')
  ).text()
  for (const expected of [
    '填写并提交线索',
    '打开作品补充与纠错表',
    'github.com/wtyliangtingRe/baihepailei/issues/new',
    'work-correction.yml',
    'work_id=18556',
    '匿名文字表单',
    '不接收图片或任何附件',
    '投稿与图片证据',
  ]) {
    assert.ok(correctionFeedback.includes(expected), `correction feedback should include ${expected}`)
  }

  const newWorkFeedback = await (await response('/feedback?type=new_work')).text()
  for (const expected of ['打开新作品提交表', 'new-work.yml', '推荐收录新作品']) {
    assert.ok(newWorkFeedback.includes(expected), `new-work feedback should include ${expected}`)
  }

  const redirects = new Map([
    ['/browse', '/works'],
    ['/evidence', '/feedback'],
  ])
  for (const [path, destination] of redirects) {
    const result = await response(path, { redirect: 'manual' })
    assert.ok([307, 308].includes(result.status), `${path} should redirect`)
    assert.equal(new URL(result.headers.get('location'), base).pathname, destination)
  }

  const health = await json('/api/health')
  assert.deepEqual(
    {
      ok: health.ok,
      catalogWorks: health.catalogWorks,
      visibleWorks: health.visibleWorks,
      mergedAway: health.mergedAway,
      mergedGroups: health.mergedGroups,
      largestMergedGroup: health.largestMergedGroup,
      ratedWorks: health.ratedWorks,
    },
    {
      ok: true,
      catalogWorks: 35_411,
      visibleWorks: 34_940,
      mergedAway: 471,
      mergedGroups: 471,
      largestMergedGroup: 2,
      ratedWorks: 4_001,
    },
  )
  assert.equal(health.visibleWorks + health.mergedAway, health.catalogWorks)

  for (const query of ['男性替身', 'NTR', '岸 虎次郎', '安達としまむら', 'Adachi and Shimamura', '安达与岛村']) {
    const result = await json(`/api/work-lineage/works?q=${encodeURIComponent(query)}&limit=2`)
    assert.ok(result.total > 0, `${query} should return matching works`)
  }

  const taggedWork = await json('/api/work-lineage/works/18556')
  assert.equal(taggedWork.rating.grade, 'D')
  assert.ok(taggedWork.publicTags.some((tag) => tag.key === 'setting-otokonoko-crossdressing'))
  assert.equal('identity' in taggedWork, false)
  assert.equal('ordinal' in taggedWork, false)

  const uncertainWork = await json('/api/work-lineage/works/4971')
  assert.equal(uncertainWork.rating.class, undefined)
  assert.equal(uncertainWork.rating.uncertaintyKind, 'evidence_insufficient')
  assert.equal(uncertainWork.rating.needsMoreResearch, true)

  // Punctuation and exact-provider identity must keep distinct seasons/works distinct.
  // These pairs were concrete false merges under the retired punctuation-stripping policy.
  const yuruYuri = await json('/api/work-lineage/works/29857')
  const yuruYuriSeason2 = await json('/api/work-lineage/works/29865')
  assert.equal(yuruYuri.title, 'Yuru Yuri')
  assert.equal(yuruYuri.rating.state, 'not_assessed')
  assert.equal(yuruYuriSeason2.title, 'Yuru Yuri♪♪')
  assert.equal(yuruYuriSeason2.rating.grade, 'D')
  assert.notEqual(yuruYuri.workId, yuruYuriSeason2.workId)

  const showByRock = await json('/api/work-lineage/works/25024')
  const showByRockSeason2 = await json('/api/work-lineage/works/25027')
  assert.equal(showByRock.title, 'SHOW BY ROCK!!')
  assert.equal(showByRock.rating.state, 'not_assessed')
  assert.equal(showByRockSeason2.title, 'SHOW BY ROCK!!#')
  assert.equal(showByRockSeason2.rating.grade, 'D')
  assert.notEqual(showByRock.workId, showByRockSeason2.workId)

  // Evidence-backed cross-provider aliases resolve to one public work from every old Work ID.
  for (const [left, right] of [
    ['5409', '30268'], // Adachi and Shimamura / 安達としまむら
    ['25236', '31618'], // Sky Girls 2007 TV
    ['25237', '31619'], // Sky Girls 2006 OVA
    ['17930', '31034'], // Lycoris Recoil WEB shorts
  ]) {
    const leftWork = await json(`/api/work-lineage/works/${left}`)
    const rightWork = await json(`/api/work-lineage/works/${right}`)
    assert.equal(leftWork.workId, rightWork.workId, `${left}/${right} should resolve to one public work`)
  }

  // Stale crosswalks and same-provider partial identities stay separate.
  for (const [left, right] of [
    ['25237', '31618'],
    ['17926', '31034'],
    ['4142', '4978'],
    ['4918', '4979'],
  ]) {
    const leftWork = await json(`/api/work-lineage/works/${left}`)
    const rightWork = await json(`/api/work-lineage/works/${right}`)
    assert.notEqual(leftWork.workId, rightWork.workId, `${left}/${right} should remain separate`)
  }

  const enrichedDetail = await (await response('/works/w-36946')).text()
  for (const expected of ['岸 虎次郎', '集英社', '2011-03-18', '作品介绍']) {
    assert.ok(enrichedDetail.includes(expected), `enriched detail should include ${expected}`)
  }

  const creditedWork = await json('/api/work-lineage/works/36946')
  for (const credit of [creditedWork.creators[0], creditedWork.organizations[0]]) {
    assert.ok(credit.creatorId, 'Credits must expose stable CreatorIds')
    const organization = credit.creatorKind === 'organization'
    const path = `/${organization ? 'organizations/o' : 'creators/c'}-${credit.creatorId}`
    assert.ok(enrichedDetail.includes(`href="${path}"`), 'Work credits link to internal creator pages')
    const result = await response(path)
    assert.equal(result.status, 200)
    const creatorPage = await result.text()
    assert.ok(creatorPage.includes('按首次发行年份排列'))
    assert.ok(/href="\/works\/w-\d+"/.test(creatorPage), 'Creator pages link back to real Works')
    const wrongKind = `/${organization ? 'creators/c' : 'organizations/o'}-${credit.creatorId}`
    assert.equal((await response(wrongKind)).status, 404)
  }
  assert.equal((await response('/creators/c-999999999999')).status, 404)
  assert.ok(enrichedDetail.includes('role="doc-noteref"'))
  assert.ok(enrichedDetail.includes('id="ref-1"'))
  assert.ok(enrichedDetail.includes('资料来源与获取方式'))

  const taggedDetail = await (await response('/works/w-18556')).text()
  for (const expected of [
    'AI 综合，待复核',
    '作品基本资料',
    '作者与创作机构',
    '排雷结论',
    '男娘 / 女装设定',
    '查看这条规则的判定边界',
    '资料来源',
  ]) {
    assert.ok(taggedDetail.includes(expected), `tagged detail should include ${expected}`)
  }
  assert.ok(taggedDetail.indexOf('作品基本资料') < taggedDetail.indexOf('排雷结论'))
  assert.ok(taggedDetail.indexOf('作品介绍') < taggedDetail.indexOf('排雷结论'))
  assert.ok(taggedDetail.indexOf('排雷结论') < taggedDetail.indexOf('资料来源'))
  for (const forbidden of ['目录序号', '身份状态', '外部提供方', '外部站点 ID', '研究覆盖']) {
    assert.equal(taggedDetail.includes(forbidden), false, `detail should hide ${forbidden}`)
  }

  const ratings = await (await response('/ratings')).text()
  for (const expected of ['独立偏好层', 'TS / 性别转换', '扶她设定', 'ABO 设定', '成人 / 性描写']) {
    assert.ok(ratings.includes(expected), `ratings should include ${expected}`)
  }

  console.log(JSON.stringify({
    pages: pages.length,
    redirects: redirects.size,
    searches: 6,
    visibleWorks: health.visibleWorks,
    mergedAway: health.mergedAway,
    mergedGroups: health.mergedGroups,
    largestMergedGroup: health.largestMergedGroup,
    identitySafeFalseMergeRegressions: 'PASS',
    enrichedWorkDetails: 'PASS',
    ratingWarnings: 'PASS',
    structuredFeedbackIssueForms: 'PASS',
    anonymousWriteBoundary: 'PASS',
    publicFieldBoundary: 'PASS',
    creatorNavigationAndFootnotes: 'PASS',
    status: 'PASS',
  }, null, 2))
} catch (error) {
  console.error(error)
  if (serverOutput) console.error(`\nProduction server output:\n${serverOutput}`)
  process.exitCode = 1
} finally {
  await stopServer()
}
