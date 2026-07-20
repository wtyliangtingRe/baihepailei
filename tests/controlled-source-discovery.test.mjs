import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result
}

test('controlled discovery names the four approved sources and forbids writes', () => {
  const source = fs.readFileSync('scripts/radar/prepare-controlled-source-discovery-v01.mjs', 'utf8')
  for (const key of ['bangumi', 'yurizukan', 'vndb', 'steam']) assert.match(source, new RegExp(`['\"]${key}['\"]`, 'u'))
  assert.match(source, /externalFetch: false/u)
  assert.match(source, /payloadWrite: false/u)
  assert.match(source, /mutatesHumanAssessment: false/u)
  assert.match(source, /sourceSnapshotHashesRequired: true/u)
})

test('candidate planner emits create, update, duplicate and blocked plans in fixed identity order', () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'data_local', 'test-discovery-plan-'))
  try {
    const candidates = path.join(root, 'candidates.jsonl')
    const works = path.join(root, 'works.jsonl')
    const outDir = path.join(root, 'plan')
    writeJsonl(works, [
      {
        workId: '1', siteId: 'work:one', slug: 'work-one', title: 'Existing One',
        mediaGroup: 'game', mediaType: 'visual_novel', firstPublishedAt: '2024-01-01',
        externalIds: { vndbId: 'v1' },
      },
      {
        workId: '2', siteId: 'work:two', slug: 'work-two', title: 'Same Title',
        mediaGroup: 'anime', mediaType: 'anime', firstPublishedAt: '2025',
        externalIds: {},
      },
    ])
    writeJsonl(candidates, [
      {
        discoveryId: 'vndb:v1', source: 'vndb', title: 'Existing One', mediaGroup: 'game', mediaType: 'visual_novel',
        externalIds: { vndbId: 'v1' }, sourceLinks: [{ url: 'https://vndb.org/v1' }],
      },
      {
        discoveryId: 'bangumi:2', source: 'bangumi', title: 'Same Title', mediaGroup: 'anime', mediaType: 'anime',
        firstPublishedAt: '2025-01', externalIds: { bangumiSubjectId: '2' }, sourceLinks: [{ url: 'https://bgm.tv/subject/2' }],
      },
      {
        discoveryId: 'steam:3', source: 'steam', title: 'Brand New', mediaGroup: 'game', mediaType: 'game',
        externalIds: { steamAppId: '3' }, sourceLinks: [{ url: 'https://store.steampowered.com/app/3' }],
      },
      {
        discoveryId: 'yurizukan:4', source: 'yurizukan', title: 'Blocked', mediaGroup: 'manga', mediaType: 'manga',
        externalIds: { yurizukanArticleIds: ['4'] }, sourceLinks: [{ url: 'https://www.yurizukan.com/articles/articleDetail/4' }],
        discoveryBlockers: ['source_policy_blocked'],
      },
    ])

    runNode('scripts/radar/prepare-discovered-work-candidates-v01.mjs', [
      '--candidates', candidates,
      '--works', works,
      '--out-dir', outDir,
    ])
    const summary = readJson(path.join(outDir, 'discovered-work-candidate-plan-v01-summary.json'))
    assert.deepEqual(summary.identityPriority, ['site_id', 'external_id', 'slug', 'title_media_date'])
    assert.equal(summary.wouldCreateDraft, 1)
    assert.equal(summary.wouldUpdateExisting, 1)
    assert.equal(summary.possibleDuplicate, 1)
    assert.equal(summary.blocked, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('controlled discovery normalizes a Yurizukan snapshot, hashes it, and runs the read-only planner', () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'data_local', 'test-controlled-discovery-'))
  try {
    const source = path.join(root, 'yurizukan-create.jsonl')
    const works = path.join(root, 'works.jsonl')
    const runDir = path.join(root, 'run')
    writeJsonl(works, [])
    writeJsonl(source, [{
      action: 'yurizukan_create_work',
      planStatus: 'ready_for_create_review',
      yurizukanIds: ['42'],
      firstYurizukanId: '42',
      title: '百合测试作品',
      mediaGroup: 'manga',
      mediaType: 'manga',
      format: 'manga_series',
      groupPreview: {
        sourceLinks: [{ label: 'Yurizukan #42', url: 'https://www.yurizukan.com/articles/articleDetail/42' }],
        evidenceNoteAppend: 'Yurizukan lists this work as yuri-related.',
      },
      createPayload: {
        title: '百合测试作品',
        originalTitle: '百合测试作品',
        mediaGroup: 'manga',
        mediaType: 'manga',
        format: 'manga_series',
      },
    }])

    runNode('scripts/radar/prepare-controlled-source-discovery-v01.mjs', [
      '--works', works,
      '--yurizukan', source,
      '--out-dir', runDir,
    ])
    const summary = readJson(path.join(runDir, 'summary.json'))
    const plan = readJson(path.join(runDir, 'candidate-plan', 'discovered-work-candidate-plan-v01-summary.json'))
    assert.equal(summary.counts.normalized, 1)
    assert.equal(summary.counts.bySource.yurizukan, 1)
    assert.match(summary.sourceInputs[0].sha256, /^[a-f0-9]{64}$/u)
    assert.equal(plan.wouldCreateDraft, 1)
    assert.equal(summary.safety.payloadWrite, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
