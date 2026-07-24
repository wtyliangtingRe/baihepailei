import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { applyPolicyDocs } from '../scripts/radar/apply-radar-dual-track-ai-coverage-policy-v01.mjs'

const researchPolicySource = fs.readFileSync(
  path.join(process.cwd(), 'docs/guides/radar-work-level-multilingual-research-policy-v01.md'),
  'utf8',
)
const dualTrackPolicySource = fs.readFileSync(
  path.join(process.cwd(), 'docs/guides/radar-dual-track-ai-coverage-policy-v01.md'),
  'utf8',
)

function writeFixture(root, relative, content, crlf = false) {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, crlf ? content.replace(/\n/gu, '\r\n') : content, 'utf8')
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-policy-v03-'))
  writeFixture(root, 'docs/guides/work-assessment-model-v01.md', `# Model

### Assessment tracks

Legacy tracks text.

### Effective grade

Legacy precedence text.

### Historical rank preservation

Historical text.

### Public AI isolation

Legacy AI isolation.

## Human assessment normalization

Human text.
`, true)
  writeFixture(root, 'docs/guides/radar-publication-safety-v01.md', `# Safety

### 人工审核轨道

旧人工规则。

### 公共 AI Radar 轨道

旧 AI 规则。

### 有效公开等级

旧展示规则。

## 双轨展示要求

展示字段。
`)
  writeFixture(root, 'docs/guides/radar-ai-incremental-publication-runbook-v01.md', `# Runbook

### 1.1 人工与 AI 双轨

旧双轨。

### 1.2 增补，不是每轮全量重写

旧增补。

### 1.3 全量对照与增量执行并存

保留。

### 3.2 来源与证据门槛

旧来源门槛。

## 4. 阶段 B：私有 AI 轨道

保留阶段 B。

### 5.2 公共候选门槛

旧公共门槛。

## 6. 阶段 D：公共 schema review

保留阶段 D。
`)
  writeFixture(root, 'docs/guides/README.md', `# 项目指南索引

### 作品评级与审核

旧索引。

### 数据库结构整理

保留数据库索引。
`)
  writeFixture(root, 'docs/guides/radar-work-level-multilingual-research-policy-v01.md', researchPolicySource)
  writeFixture(root, 'docs/guides/radar-dual-track-ai-coverage-policy-v01.md', dualTrackPolicySource)
  return root
}

test('heading-boundary patch installs dual-track and multilingual research rules', () => {
  const root = makeRepo()
  const result = applyPolicyDocs(root)
  assert.equal(result.assessmentChanged, true)
  assert.equal(result.safetyChanged, true)
  assert.equal(result.runbookChanged, true)
  assert.equal(result.indexChanged, true)

  const assessment = fs.readFileSync(path.join(root, 'docs/guides/work-assessment-model-v01.md'), 'utf8')
  const safety = fs.readFileSync(path.join(root, 'docs/guides/radar-publication-safety-v01.md'), 'utf8')
  const runbook = fs.readFileSync(path.join(root, 'docs/guides/radar-ai-incremental-publication-runbook-v01.md'), 'utf8')
  const index = fs.readFileSync(path.join(root, 'docs/guides/README.md'), 'utf8')

  assert.match(assessment, /Every canonical Work must converge to exactly one current public AI Radar conclusion/u)
  assert.match(assessment, /standardized multilingual external research scan/u)
  assert.match(safety, /human 优先只用于窗口与搜索的主显示等级/u)
  assert.match(runbook, /每个 canonical Work 至少执行一次中文、日文、英文标准扫描/u)
  assert.match(runbook, /支持证据搜索、反证搜索和冲突搜索/u)
  assert.match(runbook, /searched_no_public_discussion_found/u)
  assert.match(index, /Radar 作品级多语言研究与深挖规则 v0\.1/u)
  assert.match(index, /每个 canonical Work 的可追溯研究账本/u)
})

test('patch is idempotent and preserves original line-ending style', () => {
  const root = makeRepo()
  applyPolicyDocs(root)
  const assessmentPath = path.join(root, 'docs/guides/work-assessment-model-v01.md')
  const first = fs.readFileSync(assessmentPath)
  assert.ok(first.includes(Buffer.from('\r\n')))

  const result = applyPolicyDocs(root)
  const second = fs.readFileSync(assessmentPath)
  assert.deepEqual(second, first)
  assert.equal(result.assessmentChanged, false)
  assert.equal(result.safetyChanged, false)
  assert.equal(result.runbookChanged, false)
  assert.equal(result.indexChanged, false)
})

test('missing or duplicate heading boundaries fail closed', () => {
  const root = makeRepo()
  const file = path.join(root, 'docs/guides/work-assessment-model-v01.md')
  fs.appendFileSync(file, '\n### Effective grade\nDuplicate.\n')
  assert.throws(
    () => applyPolicyDocs(root),
    /Section boundary mismatch/u,
  )
})

test('long-lived research policy requires every work to be searched', () => {
  assert.match(researchPolicySource, /每部作品都必须被搜索/u)
  assert.match(researchPolicySource, /中文、日文、英文三种语言/u)
  assert.match(researchPolicySource, /支持证据搜索/u)
  assert.match(researchPolicySource, /反证搜索/u)
  assert.match(researchPolicySource, /社区材料的使用方式/u)
  assert.match(researchPolicySource, /searched_no_public_discussion_found/u)
  assert.match(researchPolicySource, /研究账本/u)
  assert.match(researchPolicySource, /严重雷点没有仅凭一条模糊社区短评定案/u)
})

test('dual-track policy keeps bootstrap AI while tracking scan completion', () => {
  assert.match(dualTrackPolicySource, /每部作品的外部研究责任/u)
  assert.match(dualTrackPolicySource, /标准化的中文、日文、英文外部研究扫描/u)
  assert.match(dualTrackPolicySource, /bootstrap snapshot/u)
  assert.match(dualTrackPolicySource, /AI 轨道始终不得为空/u)
})
