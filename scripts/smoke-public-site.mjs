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
  ]
  for (const path of pages) {
    const result = await response(path)
    assert.equal(result.status, 200, `${path} should return 200`)
  }

  const redirects = new Map([
    ['/browse', '/works'],
    ['/evidence', '/feedback'],
    ['/creators', '/works'],
    ['/organizations', '/works'],
  ])
  for (const [path, destination] of redirects) {
    const result = await response(path, { redirect: 'manual' })
    assert.ok([307, 308].includes(result.status), `${path} should redirect`)
    assert.equal(new URL(result.headers.get('location'), base).pathname, destination)
  }

  const health = await json('/api/health')
  assert.deepEqual(
    { ok: health.ok, catalogWorks: health.catalogWorks, ratedWorks: health.ratedWorks },
    { ok: true, catalogWorks: 35_411, ratedWorks: 4_001 },
  )
  assert.ok(Number.isInteger(health.visibleWorks) && health.visibleWorks > 0)
  assert.ok(Number.isInteger(health.mergedAway) && health.mergedAway >= 0)
  assert.equal(health.visibleWorks + health.mergedAway, health.catalogWorks)
  assert.ok(Number.isInteger(health.mergedGroups) && health.mergedGroups >= 0)
  assert.ok(Number.isInteger(health.largestMergedGroup) && health.largestMergedGroup >= 1)

  for (const query of ['男性替身', 'NTR', '岸 虎次郎']) {
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

  const enrichedDetail = await (await response('/works/w-36946')).text()
  for (const expected of ['岸 虎次郎', '集英社', '2011-03-18', '作品介绍']) {
    assert.ok(enrichedDetail.includes(expected), `enriched detail should include ${expected}`)
  }

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
    searches: 3,
    visibleWorks: health.visibleWorks,
    mergedAway: health.mergedAway,
    mergedGroups: health.mergedGroups,
    largestMergedGroup: health.largestMergedGroup,
    enrichedWorkDetails: 'PASS',
    ratingWarnings: 'PASS',
    publicFieldBoundary: 'PASS',
    status: 'PASS',
  }, null, 2))
} catch (error) {
  console.error(error)
  if (serverOutput) console.error(`\nProduction server output:\n${serverOutput}`)
  process.exitCode = 1
} finally {
  await stopServer()
}
