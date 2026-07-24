#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function normalizeEol(value) {
  return String(value).replace(/\r\n?/gu, '\n').replace(/^\uFEFF/u, '')
}

function countLine(text, line) {
  return text.split('\n').filter((item) => item === line).length
}

function resolveBoundary(text, candidates, file, label) {
  const values = Array.isArray(candidates) ? candidates : [candidates]
  const matches = values.flatMap((heading) => Array.from(
    { length: countLine(text, heading) },
    () => heading,
  ))
  if (matches.length !== 1) {
    throw new Error(
      `Section boundary mismatch in ${file}; ${label}=${values.join(' | ')}; found=${matches.length}`,
    )
  }
  return matches[0]
}

function replaceSection(text, startCandidates, endCandidates, replacement, file) {
  const startHeading = resolveBoundary(text, startCandidates, file, 'start')
  const endHeading = resolveBoundary(text, endCandidates, file, 'end')
  const start = text.indexOf(`${startHeading}\n`)
  const end = text.indexOf(`${endHeading}\n`, start + startHeading.length + 1)
  if (start < 0 || end <= start) {
    throw new Error(`Invalid section order in ${file}: ${startHeading} -> ${endHeading}`)
  }
  return `${text.slice(0, start)}${replacement.trimEnd()}\n\n${text.slice(end)}`
}

function patchFile(file, edits) {
  const raw = fs.readFileSync(file, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  let text = normalizeEol(raw)
  const before = text
  for (const edit of edits) {
    text = replaceSection(text, edit.start, edit.end, edit.replacement, file)
  }
  if (text !== before) {
    fs.writeFileSync(file, text.replace(/\n/gu, eol), 'utf8')
    return true
  }
  return false
}

const ASSESSMENT_TRACKS = `### Assessment tracks

A Work exposes two fully independent reference tracks:

1. Human assessment track
2. Public AI Radar assessment track

Neither track is presented as an absolute verdict. Both retain evidence, uncertainty, source coverage, contradictions, and assessment provenance when available.

Every canonical Work must converge to exactly one current public AI Radar conclusion. A human grade, human verification state, low source count, low confidence, lifecycle state, or visibility state must not suppress, delete, overwrite, or prevent the AI track. The AI track likewise must not mutate the human track.

The public presentation shape is identical for both tracks:

- \`track\`
- \`state\`
- \`grade\`
- \`summary\`
- \`sourceSummary\`
- \`sourceLinks\`
- \`evidenceStatus\`
- \`evidenceStrength\`
- \`confidencePercent\`
- \`evidenceCoveragePercent\`
- \`sourceCount\`
- \`policyVersion\`
- \`assessmentBatch\`
- \`decisiveRuleCode\`
- \`decisiveRuleReason\`
- \`matchedRules\`
- \`contradictions\`
- \`requiresHumanReview\`
- \`assessedAt\`
- \`assessedBy\`
- \`bestGrade\`
- \`likelyGrade\`
- \`worstGrade\`
- \`provenance\`

A missing value remains empty. Missing fields are not converted into zero, false, or a fabricated conclusion.`

const ASSESSMENT_DISPLAY = `### Display and search grade

The primary grade shown in Work windows and search results is derived in this order:

1. A valid human assessment grade whose state is assessed or disputed.
2. Otherwise, a current public AI Radar grade.
3. Otherwise, \`unknown\`.

This precedence is a presentation and search rule only. It may drive cards, filters, sorting, aggregation, and compatibility output, but it does not control whether either track is stored, published, updated, or considered current.

The stored legacy \`rank\` field is not an assessment source. During transition, public exports may continue emitting \`rank\`, but it is recomputed from the display rule above and marked compatibility-only.

A pending human grade remains visible as reference material but does not replace the current public AI grade. When valid human and AI grades disagree, both tracks remain visible and independently auditable; only the primary display grade prefers human.`

const ASSESSMENT_AI = `### Public AI isolation

Public AI conclusions remain in \`radar-public-conclusions\` and never publish, patch, or restore Works drafts.

A private or stale \`works.radarAssessment\` value is not a public AI conclusion. Only the current record in \`radar-public-conclusions\` may become the public AI track.

Evidence shortage changes uncertainty metadata, not AI-track existence. A single-source or low-confidence conclusion must retain its true source count, lower confidence and coverage, warnings, and \`requiresHumanReview\`, while still producing the required current AI conclusion for the canonical Work. Noncanonical merge-out records are covered by their explicit canonical Work rather than receiving duplicate current records.

Every canonical Work must receive at least one standardized multilingual external research scan. The scan attempts Chinese, Japanese, and English queries across official material, structured databases, walkthroughs, Wikis, long reviews, and community discussion. A bootstrap AI conclusion may exist before that scan is complete, but it must expose explicit uncertainty and remain queued for research supersession; \`no discussion found\` must never be confused with \`not searched\`.`

const SAFETY_HUMAN = `### 人工审核轨道

权威位置：\`humanAssessment\`。

人工轨道可以包含等级、证据、来源、冲突、说明和审核人。人工轨道与公共 AI 轨道在存储、生成、更新和审计上完全独立。人工轨道的存在、等级或状态不得阻止公共 AI 结论生成或更新；公共 AI 也不得改写人工轨道。human 优先只用于窗口与搜索的主显示等级。`

const SAFETY_AI = `### 公共 AI Radar 轨道

权威位置：\`radar-public-conclusions\`。

要求：

- 与 Works 分表；
- 无 drafts；
- 无 versions；
- 每个 Work 使用稳定 \`publicationKey = work:<id>\`；
- 只有 \`current\` 记录作为当前公共 AI 轨道；
- 每个 canonical Work 必须收敛到一条 \`current\` 公共 AI 结论；
- 已有 human track、单来源、低置信度、隐藏或归档状态均不得让 AI 轨道缺失；
- 新 AI 结论更新同一条当前记录；
- 写入该集合不得触碰、发布或恢复 Works；
- 公开导出只允许 GET 读取；
- 每部作品的标准化多语言搜索扫描和研究账本必须可追溯；
- 搜不到攻略、Wiki、长评或讨论时，以低置信度和未完成深挖状态表达，不得伪造安全结论或留下空 AI 轨道。`

const SAFETY_DISPLAY = `### 窗口与搜索主显示等级

\`\`\`text
有效人工等级
→ 否则当前公共 AI 等级
→ 否则 unknown
\`\`\`

这只是窗口与搜索展示优先级，不是轨道存储或发布优先级。它可以用于详情窗口、搜索卡片、过滤、排序、聚合和旧客户端兼容输出，但不能阻止 AI 结论存在，也不能让 human 或 AI 轨道覆盖另一条轨道。

\`rank\` 只作为旧客户端兼容输出，由上述展示规则重新计算，不是第三个评级来源。

退役 \`rank\` 不代表允许丢失历史值。所有非 \`unknown\` 历史 \`rank\` 必须先确定来源：

- canonical 人工结论；
- 私有 AI 候选，仍需独立公开审查；
- 来源未知的旧等级；
- 无有效等级来源。

来源未知的旧等级不能自动冒充人工结论或公共 AI 结论，也不能静默删除。`

const RUNBOOK_DUAL = `### 1.1 人工与 AI 双轨

- 人工结论保存在 canonical \`humanAssessment\` 轨道；
- 私有 AI 研究结果保存在 Work 的 \`radarAssessment\` 轨道；
- 公共 AI 结论保存在独立、versionless 的 \`radar_public\` 集合；
- 每个 canonical Work 必须收敛到恰好一条 current 公共 AI 结论；
- human 与 AI 在存储、更新和审计上互不覆盖、互不阻塞；
- 窗口与搜索的主显示等级优先级固定为：

\`\`\`text
valid human assessment
→ current public AI conclusion
→ unknown
\`\`\`

该顺序只决定窗口与搜索的主显示等级，不决定 AI 轨道是否存在。AI 写入不得覆盖人工字段，也不得通过发布 Works 草稿来公开 AI 结论；human track 的存在或冲突也不得阻止 AI 结论生成或更新。`

const RUNBOOK_INCREMENTAL = `### 1.2 增补，不是每轮全量重写

每一轮可以输入一份新增或更新研究包，但执行计划必须重新对照当前生产状态：

\`\`\`text
新增结论          → ready
内容已一致        → already_current
证据不足          → ready_with_explicit_uncertainty
canonical 身份不足 → blocked_identity
\`\`\`

已经完成且 \`conclusionSha256\`、来源包、规则版本和目标 Work 身份均未变化的作品不重新写入。只有以下情况进入新一轮更新：

- 新增作品或此前无结论；
- 新证据改变判断；
- 规则版本改变并影响结论；
- canonical Work 身份发生修正；
- 旧公共结论需要被新 AI 结论 supersede；
- 人工审核要求重新研究；
- 标准化多语言扫描或深挖找到新事实；
- 旧结论的研究账本仍标记为未扫描或扫描不完整。

首轮建表后，后续增补通常不再生成 schema migration，只生成数据 upsert/supersede 计划。`

const RUNBOOK_RESEARCH = `### 3.2 来源与证据门槛

只有以下情况可以暂缓绑定公共 AI 结论：

- canonical Work 身份无法唯一确认；
- 记录是明确的 noncanonical merge-out，且已有 canonical target；
- 已确认作废的测试 assessment 尚未产生新的 canonical 研究结果。

单来源、低覆盖度、规则冲突或仍需人工复核时，必须生成带显式不确定性的 AI 结论，而不是保持 AI 轨道为空。此类结论保留真实 sourceCount、较低 confidence / coverage、warnings 与 \`requiresHumanReview = true\`。

publication guard、human track、\`catalogStatus\` 与 visibility 进入展示和审计元数据，不得单独阻止 AI 结论存在。

旧测试记录不能通过 ID remap 重新成为 canonical Work 的结论，必须产生新的研究结果。

### 3.3 每部作品的标准化多语言扫描

每个 canonical Work 至少执行一次中文、日文、英文标准扫描，使用原名、译名、英文名、罗马字、别名、系列名和重要角色名，尝试以下来源类别：

- 官方资料；
- 结构化数据库；
- 攻略、路线和全结局资料；
- Wiki、章节或逐话摘要；
- 长评、通关报告和完结分析；
- 社区讨论与排雷线索。

所有作品都执行标准扫描；拟评 S/A、拟评 E/F、多路线游戏、男性风险、版本冲突、单来源和身份不稳定作品必须进入更深的作品级调查。

社区材料不得整段直接成为自动结论。先拆成具体剧情事实，核对媒介、版本、路线、章节和时间点；严重雷点通常需要直接证据或至少两份独立、具体且一致的二手来源。

研究必须同时执行支持证据搜索、反证搜索和冲突搜索。搜不到讨论时记录 \`searched_no_public_discussion_found\`，不得记成 \`not_searched\`。标准扫描尚未完成的 AI snapshot 可以作为 bootstrap 结论存在，但必须降低置信度、标记仍需研究，并在扫描完成后被新 snapshot supersede。

详细规则与研究账本字段见：

\`\`\`text
docs/guides/radar-work-level-multilingual-research-policy-v01.md
\`\`\``

const RUNBOOK_PUBLIC = `### 5.2 公共候选门槛

公共 AI create/update 必须同时满足：

- canonical Work 身份唯一且可绑定；
- compatibility grade 为 \`S/A/B/C/D/E/F\`；
- 规则、sourceSummary、assessedAt 与完整 snapshot 结构有效；
- 不是未重建的作废测试 assessment；
- \`publicationKey = work:<canonical Work ID>\`；
- \`work = workIdSnapshot\`；
- \`conclusionSha256\` 有效且唯一。

单来源、低 confidence、human 冲突、\`catalogStatus\`、Payload \`_status\` 与 lite/full visibility 不阻止 AI 存储。它们必须被准确记录，并在展示层决定是否以及如何向用户呈现。生命周期与 visibility 决定界面是否展示 Work，不决定独立 AI 记录是否存在。

标准化多语言扫描状态属于研究完整性元数据。扫描尚未完成时允许生成 bootstrap AI conclusion，但必须明确较低 confidence / coverage、真实 sourceCount、\`requiresHumanReview\` 和待 supersede 状态，不能把 bootstrap 误称为完成深挖。

公共分类：

\`\`\`text
ready_public_ai_after_schema
ready_public_ai_create
ready_public_ai_update
ready_public_ai_low_evidence
already_current_public_ai
blocked_identity_public_ai
blocked_discarded_test_assessment
\`\`\`

审计输出必须区分 canonical identity blockers、AI evidence warnings、research scan status 与 display/lifecycle state。不得把 human、证据强度或生命周期展示状态误写成 AI 轨道缺失原因。`

const INDEX_RESEARCH = `### 作品评级与审核

- [Work 评级与结构规范模型 v0.1](./work-assessment-model-v01.md)
  - 人工审核轨道与公共 AI Radar 轨道
  - 双轨存储完全独立，human 优先仅用于窗口与搜索展示
  - 每个 canonical Work 的公共 AI 全覆盖要求
  - 生命周期字段与废止字段
  - 人工审核新旧字段统一原则
  - 历史 \`rank\` 来源保护

- [Radar human/AI 双轨与 AI 全覆盖规则 v0.1](./radar-dual-track-ai-coverage-policy-v01.md)
  - human 与 AI 互不覆盖、互不阻塞
  - 每个 canonical Work 恰好一条 current AI 结论
  - 单来源与低置信度使用显式不确定性，而不是缺失 AI 结论
  - lifecycle/visibility 只控制界面展示，不控制 AI 存储

- [Radar 作品级多语言研究与深挖规则 v0.1](./radar-work-level-multilingual-research-policy-v01.md)
  - 每部作品至少一次中文、日文、英文标准扫描
  - 官方、结构化数据库、攻略、Wiki、长评和社区六类来源
  - S/A、E/F、多路线、男性风险、冲突与单来源的深挖触发条件
  - 支持证据、反证与冲突并行搜索
  - 搜不到讨论与尚未搜索严格分离
  - 每个 canonical Work 的可追溯研究账本

- [Radar AI 增补与公共发布运行手册 v0.1](./radar-ai-incremental-publication-runbook-v01.md)
  - 新研究包、私有 AI 与公共 AI 的双轨增补路线
  - 已完成结论保持 \`already_current\`，只写新增或变化记录
  - 每部作品标准扫描与高影响作品深挖
  - 双快照全局审计、publication guard 与 canonical Work 身份门槛
  - 首次 schema、隔离往返演练、生产 apply-once 与独立 rollback 授权
  - 大波次内部可恢复子批次、证据包与不可变 receipt`

export function applyPolicyDocs(root) {
  const guides = path.join(root, 'docs', 'guides')
  const assessment = path.join(guides, 'work-assessment-model-v01.md')
  const safety = path.join(guides, 'radar-publication-safety-v01.md')
  const runbook = path.join(guides, 'radar-ai-incremental-publication-runbook-v01.md')
  const index = path.join(guides, 'README.md')
  const researchPolicy = path.join(guides, 'radar-work-level-multilingual-research-policy-v01.md')
  const dualTrackPolicy = path.join(guides, 'radar-dual-track-ai-coverage-policy-v01.md')

  for (const file of [assessment, safety, runbook, index, researchPolicy, dualTrackPolicy]) {
    if (!fs.existsSync(file)) throw new Error(`Missing policy document: ${file}`)
  }

  const assessmentChanged = patchFile(assessment, [
    { start: '### Assessment tracks', end: ['### Effective grade', '### Display and search grade'], replacement: ASSESSMENT_TRACKS },
    { start: ['### Effective grade', '### Display and search grade'], end: '### Historical rank preservation', replacement: ASSESSMENT_DISPLAY },
    { start: '### Public AI isolation', end: '## Human assessment normalization', replacement: ASSESSMENT_AI },
  ])

  const safetyChanged = patchFile(safety, [
    { start: '### 人工审核轨道', end: '### 公共 AI Radar 轨道', replacement: SAFETY_HUMAN },
    { start: '### 公共 AI Radar 轨道', end: ['### 有效公开等级', '### 窗口与搜索主显示等级'], replacement: SAFETY_AI },
    { start: ['### 有效公开等级', '### 窗口与搜索主显示等级'], end: '## 双轨展示要求', replacement: SAFETY_DISPLAY },
  ])

  const runbookChanged = patchFile(runbook, [
    { start: '### 1.1 人工与 AI 双轨', end: '### 1.2 增补，不是每轮全量重写', replacement: RUNBOOK_DUAL },
    { start: '### 1.2 增补，不是每轮全量重写', end: '### 1.3 全量对照与增量执行并存', replacement: RUNBOOK_INCREMENTAL },
    { start: '### 3.2 来源与证据门槛', end: '## 4. 阶段 B：私有 AI 轨道', replacement: RUNBOOK_RESEARCH },
    { start: '### 5.2 公共候选门槛', end: '## 6. 阶段 D：公共 schema review', replacement: RUNBOOK_PUBLIC },
  ])

  const indexChanged = patchFile(index, [
    { start: '### 作品评级与审核', end: '### 数据库结构整理', replacement: INDEX_RESEARCH },
  ])

  const policyChecks = [
    [assessment, 'Every canonical Work must converge to exactly one current public AI Radar conclusion.'],
    [assessment, 'standardized multilingual external research scan'],
    [safety, '人工轨道的存在、等级或状态不得阻止公共 AI 结论生成或更新'],
    [runbook, '每个 canonical Work 至少执行一次中文、日文、英文标准扫描'],
    [runbook, 'searched_no_public_discussion_found'],
    [index, 'Radar 作品级多语言研究与深挖规则 v0.1'],
    [researchPolicy, '每部作品都必须被搜索'],
    [dualTrackPolicy, '每部作品的外部研究责任'],
  ]
  for (const [file, marker] of policyChecks) {
    if (!normalizeEol(fs.readFileSync(file, 'utf8')).includes(marker)) {
      throw new Error(`Policy marker missing after patch: ${file}; marker=${marker}`)
    }
  }

  return { assessmentChanged, safetyChanged, runbookChanged, indexChanged }
}

const direct = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (direct) {
  const root = path.resolve(process.argv[2] || process.cwd())
  const result = applyPolicyDocs(root)
  console.log(JSON.stringify({ ok: true, ...result }, null, 2))
}
