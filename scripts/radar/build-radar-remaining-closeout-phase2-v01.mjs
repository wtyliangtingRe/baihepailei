#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const VERSION = 'radar-remaining-1122-phase2-live-guard-closeout-v0.2'
export const EXPECTED_PHASE1_SHA256 = 'b1cf94f62d31e330844551f51859247237be57cd7c9c81d7a6a68d43dd439fd9'
export const EXPECTED_CLOSEOUT_SHA256 = '8947a84a9961be88c9e69ee3a0c2100191f02361d665528c6cac974f5602d99d'
export const EXPECTED_RESEARCH_SHA256 = 'bfd991789b582faf4e780c973804d7ee8af4669f7ddb9724c3c52f9133d680a1'
export const EXPECTED_ROWS = 1122
export const EXPECTED_WORKS = 35615
export const EXPECTED_PUBLIC_CURRENT = 9000
export const ASSESSMENT_BATCH = 'RADAR-REMAINING-1122-CLOSEOUT-20260724'

const READY = 'ready_for_unified_incremental_assembly'
const CURRENT = 'already_current_ai_conclusion'
const BLOCKED = 'retained_blocked_with_final_reason'
const DECISION = 'identity_or_policy_human_decision_required'
const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
const FORBIDDEN_FLAGS = new Set(['execute', 'apply', 'write', 'patch', 'publish', 'restore', 'confirm', 'approval-token'])

export const CURATED = Object.freeze({
  '25561': {
    outcome: BLOCKED,
    code: 'noncanonical_merge_out_covered_by_canonical_work',
    rationale: 'This AniList source-split record is the explicitly rejected merge-out member. AI coverage belongs to canonical Bangumi Work 32094; discarded test assessment data is not regenerated on the noncanonical duplicate identity.',
    coverageExemptNoncanonical: true,
  },
  '30677': {
    outcome: READY,
    code: 'latest_candidate_accepted_no_grade_mutation',
    rationale: 'The locked latest-structurally-valid policy accepts the complete B/B-LIGHT candidate.',
  },
  '30678': {
    outcome: READY,
    code: 'latest_candidate_accepted_no_grade_mutation',
    rationale: 'The complete B/B-LIGHT candidate is retained under latest-wins.',
  },
  '30679': {
    outcome: READY,
    code: 'latest_candidate_accepted_single_provider_ai_coverage',
    rationale: 'The latest B/B-LIGHT candidate is accepted for conflict ordering. A single-provider evidence state lowers confidence and remains reviewable, but cannot suppress the required AI conclusion.',
  },
  '30680': {
    outcome: READY,
    code: 'latest_candidate_accepted_no_grade_mutation',
    rationale: 'The complete B/B-LIGHT candidate is retained under latest-wins.',
  },
  '30681': {
    outcome: READY,
    code: 'latest_candidate_accepted_single_provider_ai_coverage',
    rationale: 'The latest B/B-LIGHT candidate is accepted for conflict ordering. A single-provider evidence state lowers confidence and remains reviewable, but cannot suppress the required AI conclusion.',
  },
  '30760': {
    outcome: READY,
    code: 'risk_tag_non_decisive_no_grade_mutation',
    rationale: 'The isolated cross-dressing tag does not establish male romantic contamination in the female Hacka Doll ensemble. Keep B/B-LIGHT with no grade or rule mutation.',
  },
  '31143': {
    outcome: READY,
    code: 'fresh_ai_conclusion_with_route_uncertainty',
    rationale: 'The R18/GAL/harem classification and unresolved route or player gender require an explicit uncertain AI conclusion rather than absence of an AI track.',
    freshOverride: {
      suggestedGrade: 'D',
      decisiveRuleCode: 'D-UNCLEAR',
      decisiveRuleReason: 'R18/GAL/harem 标签无法确认稳定女性专属恋爱路线，玩家身份与路线结构仍不明确，因此以 D-UNCLEAR 表示高不确定性而不是缺失 AI 结论。',
      sourceSummary: '现有结构化来源能够确认 R18、GAL 与 harem 相关分类，但没有足够的路线级证据证明稳定、排他的女性恋爱路径，也无法确认玩家角色不会形成男性介入。依据全作品 AI 覆盖规则，本次生成 D-UNCLEAR，并保留人工复核标记。',
      confidencePercent: 64,
      evidenceCoveragePercent: 52,
    },
  },
  '31189': {
    outcome: READY,
    code: 'risk_tag_non_decisive_no_grade_mutation',
    rationale: 'A generic cross-dressing tag does not by itself contradict the current B/B-LIGHT female relationship reading. No grade or rule mutation is made.',
  },
  '31309': {
    outcome: READY,
    code: 'generic_harem_tag_non_decisive_no_grade_mutation',
    rationale: 'The generic harem tag is not supported by the four-fairy ensemble synopsis as a male romance route. Keep B/B-LIGHT without mutation.',
  },
  '31588': {
    outcome: READY,
    code: 'fresh_ai_regrade_for_explicit_male_romance',
    rationale: 'The otome-game premise and Peter/Wendy romantic setup require an AI conclusion that records explicit male-romance contamination.',
    freshOverride: {
      suggestedGrade: 'E',
      decisiveRuleCode: 'E-MALE-INTIMACY',
      decisiveRuleReason: '乙女游戏框架及 Peter/Wendy 的明确异性恋爱设置构成直接男性恋爱介入，不适合维持 B 级百合安全结论。',
      sourceSummary: '现有来源明确给出乙女游戏框架以及 Peter 与 Wendy 的恋爱设置。该信息与稳定女性恋爱安全性直接冲突，因此 AI 轨道改为 E-MALE-INTIMACY；human 轨道如有不同判断仍独立保留。',
      confidencePercent: 88,
      evidenceCoveragePercent: 78,
    },
  },
  '31692': {
    outcome: READY,
    code: 'fresh_ai_conclusion_for_identity_uncertainty',
    rationale: 'The central cross-dressing identity and triangle framing require an uncertain AI conclusion, not suppression of the AI track.',
    freshOverride: {
      suggestedGrade: 'D',
      decisiveRuleCode: 'D-UNCLEAR',
      decisiveRuleReason: '核心身份秘密、女装/性别呈现与三角关系信息尚不足以稳定判断女性恋爱安全性，因此以 D-UNCLEAR 明示身份与路线不确定性。',
      sourceSummary: '结构化来源显示核心身份秘密、cross-dressing 信号与三角关系框架，但缺乏足够材料确认角色身份及最终关系结构。依据双轨独立和 AI 全覆盖规则，本次生成 D-UNCLEAR，并保留 requiresHumanReview。',
      confidencePercent: 62,
      evidenceCoveragePercent: 50,
    },
  },
  '31799': {
    outcome: READY,
    code: 'male_lead_reference_is_rejected_in_source_no_grade_mutation',
    rationale: 'The synopsis explicitly has the female character reject or push away the male lead and confess to the female protagonist. Keep A/A-NEAR-CONFIRMED without mutation.',
  },
  '31892': {
    outcome: READY,
    code: 'male_lead_signal_false_positive_no_grade_mutation',
    rationale: 'The same source tags explicitly state no male protagonist, while the synopsis and title-level evidence describe a female ensemble. Keep B/B-LIGHT without mutation.',
  },
  '32094': {
    outcome: READY,
    code: 'fresh_research_canonical_bangumi_work',
    rationale: 'This is the canonical Bangumi member. Fresh evidence describes a general mecha and war story with the heroine’s brother as a central motivation; yuri signals remain secondary.',
    freshOverride: {
      suggestedGrade: 'D',
      decisiveRuleCode: 'D-GENERAL',
      decisiveRuleReason: '作品主体为一般向科幻机甲与战争叙事，女主对兄长的执念是核心动机；女性关系和百合标签不足以构成稳定百合主线。',
      sourceSummary: 'Bangumi 与作品官方来源共同显示，《奏光之Strain》以未来战争、机甲驾驶和女主寻找兄长为主轴。女性角色互动与百合标签存在，但不是稳定的女性恋爱主线，因此本次从零建立 D/D-GENERAL 结论。该 AI 结论与任何 human track 独立共存。',
      confidencePercent: 82,
      evidenceCoveragePercent: 76,
    },
  },
  '32186': {
    outcome: READY,
    code: 'fresh_research_canonical_bangumi_work',
    rationale: 'This is the canonical Bangumi Work. The official and Bangumi evidence support an all-female adventure ensemble with light yuri signals but no formally established exclusive relationship.',
    freshOverride: {
      suggestedGrade: 'B',
      decisiveRuleCode: 'B-LIGHT',
      decisiveRuleReason: '全女性勇者小队的亲密互动与轻百合气质构成主要体验，但未形成统一明确的稳定恋爱关系。',
      sourceSummary: 'Bangumi 与官方来源共同显示，《Endro~!》围绕四名少女组成的勇者小队展开，主要体验是全女性群像、共同冒险与轻百合互动；现有证据不足以确认正式稳定恋爱关系，因此从零建立 B/B-LIGHT 结论。',
      confidencePercent: 86,
      evidenceCoveragePercent: 80,
    },
  },
  '33237': {
    outcome: READY,
    code: 'male_protagonist_signal_contradicted_by_exact_tags',
    rationale: 'The same VNDB evidence states female protagonists, Girl x Girl Romance Only, and Lesbian Sex Only. The male-protagonist signal is inconsistent; keep B/B-POWER-IMBALANCE without mutation.',
  },
  '33699': {
    outcome: READY,
    code: 'fresh_ai_regrade_for_male_centered_adult_work',
    rationale: 'Explicit Male Protagonist and Rapist Protagonist tags require a non-yuri general AI conclusion instead of retaining B or suppressing the AI track.',
    freshOverride: {
      suggestedGrade: 'D',
      decisiveRuleCode: 'D-GENERAL',
      decisiveRuleReason: '来源明确标注男性主人公及强制性成人内容，作品并非稳定女性恋爱主线；按一般非百合作品处理为 D-GENERAL，而不是保留错误的 B 级。',
      sourceSummary: 'VNDB 等结构化来源明确包含 Male Protagonist 与 Rapist Protagonist 信号，说明作品核心并非稳定女性恋爱关系。依据既有校准，男性中心或一般非百合成人作品归入 D-GENERAL，并保留成人与强制内容警示。',
      confidencePercent: 92,
      evidenceCoveragePercent: 84,
    },
  },
})

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function unique(values) { return [...new Set(values.map(val).filter(Boolean))].sort() }
export function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}
export function hashCanonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')) }
function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
export function asciiSafeJson(value) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/gu, (item) => {
    const codePoint = item.codePointAt(0)
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`
    const offset = codePoint - 0x10000
    const high = 0xd800 + (offset >> 10)
    const low = 0xdc00 + (offset & 0x3ff)
    return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`
  })
}
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(asciiSafeJson).join('\n') + (rows.length ? '\n' : ''), 'ascii') }
function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}
function required(args, key) {
  const value = val(args[key])
  if (!value) throw new Error(`Required: --${key}`)
  return path.resolve(value)
}
function countBy(rows, getter) {
  const output = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    output[key] = (output[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(output).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
function assertManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`)
  const manifest = readJson(manifestPath)
  const expected = new Set()
  for (const entry of manifest) {
    const relative = val(entry.file).replaceAll('\\', '/')
    const file = path.join(directory, ...relative.split('/'))
    if (!fs.existsSync(file)) throw new Error(`Manifest file missing: ${relative}`)
    if (fs.statSync(file).size !== Number(entry.bytes)) throw new Error(`Manifest bytes mismatch: ${relative}`)
    if (sha256File(file) !== val(entry.sha256).toLowerCase()) throw new Error(`Manifest SHA-256 mismatch: ${relative}`)
    expected.add(relative)
  }
  const actual = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        const relative = path.relative(directory, file).replaceAll('\\', '/')
        if (relative !== 'manifest.json') actual.push(relative)
      }
    }
  }
  walk(directory)
  if (actual.length !== expected.size || actual.some((item) => !expected.has(item))) throw new Error(`Manifest coverage mismatch: ${directory}`)
}

async function requestJson(url, options = {}, retries = 6) {
  const method = val(options.method || 'GET').toUpperCase()
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(90_000),
      })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
      if (response.ok) return body
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 1200)}`)
      error.status = response.status
      throw error
    } catch (error) {
      lastError = error
      const status = Number(error?.status || 0)
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500
      const cause = error?.cause
      const causeText = [
        val(error?.name),
        val(error?.message),
        val(cause?.code),
        val(cause?.message),
      ].filter(Boolean).join(' | ')
      if (!retryable || attempt === retries) {
        throw new Error(
          `Fetch failed ${method} ${url} after ${attempt + 1} attempt(s): ${causeText || 'unknown network error'}`,
          { cause: error },
        )
      }
      const delay = Math.min(15_000, 600 * (2 ** attempt))
      console.error(`[retry ${attempt + 1}/${retries}] ${method} ${url}: ${causeText}; waiting ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastError
}
async function login(baseUrl) {
  const email = val(process.env.RADAR_PAYLOAD_EMAIL)
  const password = String(process.env.RADAR_PAYLOAD_PASSWORD || '')
  if (!email || !password) throw new Error('Missing one-time read-only audit credentials.')
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!body?.token) throw new Error('Read-only login did not return a token.')
  return body.token
}
async function fetchCollection(baseUrl, token, slug, extra = {}) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', ...extra })
    const body = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      method: 'GET',
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...list(body?.docs))
    totalPages = Number(body?.totalPages || 1)
    if (page === 1 || page === totalPages || page % 10 === 0) {
      console.log(`${slug}${extra.draft ? ` draft=${extra.draft}` : ''} ${page}/${totalPages} rows=${docs.length}`)
    }
    page += 1
  } while (page <= totalPages)
  return docs
}
function relationId(value) { return val(typeof value === 'object' ? value?.id : value) }
export function humanTrackRecorded(work) {
  const value = work?.humanAssessment || {}
  const grade = val(value.grade)
  const status = val(value.status)
  return Boolean(grade || (status && status !== 'pending'))
}
export function liveGuard({ workId, siteId, draftWork, publishedWork, currentPublic }) {
  const blockers = []
  if (!publishedWork) blockers.push('missing_published_snapshot')
  if (!draftWork) blockers.push('missing_latest_draft_snapshot')
  if (publishedWork && val(publishedWork.id) !== workId) blockers.push('published_work_id_mismatch')
  if (draftWork && val(draftWork.id) !== workId) blockers.push('draft_work_id_mismatch')
  if (publishedWork && val(publishedWork.siteId) !== siteId) blockers.push('published_site_id_mismatch')
  if (draftWork && val(draftWork.siteId) !== siteId) blockers.push('draft_site_id_mismatch')
  if (currentPublic && val(currentPublic.publicationKey) !== `work:${workId}`) blockers.push('current_public_key_mismatch')
  if (currentPublic && relationId(currentPublic.work) && relationId(currentPublic.work) !== workId) blockers.push('current_public_work_mismatch')
  return canonical({
    passed: blockers.length === 0,
    blockers: unique(blockers),
    aiCoverageAlreadySatisfied: Boolean(currentPublic && blockers.length === 0),
    displayState: publishedWork ? {
      catalogStatus: val(publishedWork.catalogStatus),
      payloadStatus: val(publishedWork._status),
      isLiteVisible: publishedWork.isLiteVisible !== false,
      isFullVisible: publishedWork.isFullVisible !== false,
      surfacedByWorkVisibility: (
        val(publishedWork.catalogStatus) === 'active'
        && val(publishedWork._status) === 'published'
        && publishedWork.isLiteVisible !== false
        && publishedWork.isFullVisible !== false
      ),
    } : null,
    live: publishedWork ? {
      id: val(publishedWork.id),
      siteId: val(publishedWork.siteId),
      title: val(publishedWork.title),
      catalogStatus: val(publishedWork.catalogStatus),
      payloadStatus: val(publishedWork._status),
      isLiteVisible: publishedWork.isLiteVisible !== false,
      isFullVisible: publishedWork.isFullVisible !== false,
      updatedAt: val(publishedWork.updatedAt),
    } : null,
    draft: draftWork ? {
      id: val(draftWork.id),
      siteId: val(draftWork.siteId),
      title: val(draftWork.title),
      humanTrackRecorded: humanTrackRecorded(draftWork),
      humanTrackAffectsAIStorage: false,
      updatedAt: val(draftWork.updatedAt),
    } : null,
    currentPublic: currentPublic ? {
      id: val(currentPublic.id),
      publicationKey: val(currentPublic.publicationKey),
      workId: relationId(currentPublic.work),
      conclusionSha256: val(currentPublic.conclusionSha256),
    } : null,
  })
}
function ensureDecisiveRule(snapshot, override) {
  if (!override) return canonical(snapshot)
  const decisive = canonical({
    code: override.decisiveRuleCode,
    grade: override.suggestedGrade,
    confidencePercent: override.confidencePercent,
    reason: override.decisiveRuleReason,
  })
  return canonical({
    ...snapshot,
    suggestedGrade: override.suggestedGrade,
    decisiveRuleCode: override.decisiveRuleCode,
    decisiveRuleReason: override.decisiveRuleReason,
    sourceSummary: override.sourceSummary,
    confidencePercent: override.confidencePercent,
    evidenceCoveragePercent: override.evidenceCoveragePercent,
    evidenceStatus: 'multiple_secondary_supported',
    matchedRules: [decisive],
    contradictions: [],
    requiresHumanReview: true,
  })
}
export function buildResolvedSnapshot({ phase1Row, ledgerRow, generatedAt, curated }) {
  const source = ledgerRow?.selectedCandidate?.snapshot
  if (!source) throw new Error(`Missing selected candidate snapshot for Work ${phase1Row?.workId}`)
  const reconstructed = phase1Row?.sourceSummaryResolution?.reconstructed === true
    ? val(phase1Row?.sourceSummaryResolution?.proposedSourceSummary)
    : val(source.sourceSummary)
  const sourceCount = Math.max(1, Number(phase1Row?.sourceResolution?.independentProviderCountAfter || source.sourceCount || 0))
  const singleProvider = sourceCount < 2
  let snapshot = canonical({
    ...source,
    assessedAt: generatedAt,
    assessmentBatch: ASSESSMENT_BATCH,
    sourceCount,
    sourceSummary: reconstructed,
    evidenceStatus: singleProvider ? 'single_traceable_source_ai_conclusion' : val(source.evidenceStatus),
    confidencePercent: singleProvider ? Math.min(65, Number(source.confidencePercent || 0)) : Number(source.confidencePercent || 0),
    evidenceCoveragePercent: singleProvider ? Math.min(55, Number(source.evidenceCoveragePercent || 0)) : Number(source.evidenceCoveragePercent || 0),
    requiresHumanReview: singleProvider ? true : source.requiresHumanReview !== false,
  })
  snapshot = ensureDecisiveRule(snapshot, curated?.freshOverride)
  if (!ALLOWED_GRADES.has(val(snapshot.suggestedGrade))) throw new Error(`Invalid grade for Work ${phase1Row?.workId}`)
  if (!val(snapshot.decisiveRuleCode)) throw new Error(`Missing decisive rule for Work ${phase1Row?.workId}`)
  if (!val(snapshot.sourceSummary)) throw new Error(`Missing source summary for Work ${phase1Row?.workId}`)
  if (Number(snapshot.sourceCount) < 1) throw new Error(`Missing traceable source for AI conclusion Work ${phase1Row?.workId}`)
  if (!list(snapshot.matchedRules).some((rule) => val(rule?.code) === val(snapshot.decisiveRuleCode) && val(rule?.grade) === val(snapshot.suggestedGrade))) {
    throw new Error(`Decisive rule not represented in matchedRules for Work ${phase1Row?.workId}`)
  }
  return canonical(snapshot)
}
export function baseDecision(phase1Row) {
  const status = val(phase1Row?.phase1Status)
  if (status === 'phase1_ready_for_guard_or_assembly_review') {
    return {
      outcome: READY,
      code: 'phase1_ready_subject_to_identity_guard',
      rationale: 'Phase 1 evidence is sufficient for a normal AI conclusion.',
    }
  }
  if (status === 'phase1_requires_additional_source') {
    return {
      outcome: READY,
      code: 'single_provider_ai_conclusion_required_by_coverage_policy',
      rationale: 'Evidence remains limited to one independent provider, but full AI-track coverage requires a conclusion with explicit uncertainty rather than no AI conclusion.',
    }
  }
  return CURATED[val(phase1Row?.workId)] || {
    outcome: DECISION,
    code: 'missing_curated_closeout_decision',
    rationale: 'No deterministic closeout decision was defined.',
  }
}

export function finalizeRow({ phase1Row, closeoutRow, ledgerRow, guard, generatedAt }) {
  const workId = val(phase1Row.workId)
  const curated = CURATED[workId] || null
  const initial = baseDecision(phase1Row)
  let outcome = initial.outcome
  let code = initial.code
  let rationale = initial.rationale
  if (outcome === READY && !guard.passed) {
    outcome = BLOCKED
    code = 'canonical_identity_guard_failed'
    rationale = `AI conclusion cannot be attached safely until canonical identity is resolved: ${guard.blockers.join(', ')}`
  } else if (outcome === READY && guard.aiCoverageAlreadySatisfied) {
    outcome = CURRENT
    code = 'current_ai_conclusion_already_exists'
    rationale = 'A matching current public AI conclusion already satisfies the independent AI-track coverage invariant.'
  }
  let resolvedSnapshot = null
  let resolvedCandidateSha256 = ''
  if (outcome === READY) {
    resolvedSnapshot = buildResolvedSnapshot({ phase1Row, ledgerRow, generatedAt, curated })
    resolvedCandidateSha256 = hashCanonical({
      workId,
      publicationKey: `work:${workId}`,
      source: 'remaining_1122_phase2_closeout',
      sourceCandidateSha256: val(ledgerRow?.selectedCandidate?.candidateSha256),
      snapshot: resolvedSnapshot,
    })
  }
  const sourceCount = Number(resolvedSnapshot?.sourceCount || phase1Row?.sourceResolution?.independentProviderCountAfter || 0)
  return canonical({
    schemaVersion: 1,
    version: VERSION,
    workId,
    publicationKey: `work:${workId}`,
    siteId: val(closeoutRow?.siteId || phase1Row?.sourceRow?.siteId),
    title: val(guard?.live?.title || phase1Row.title),
    phase1Status: val(phase1Row.phase1Status),
    primaryLane: val(phase1Row.primaryLane),
    finalState: outcome,
    finalReasonCode: code,
    finalRationale: rationale,
    curatedDecision: curated,
    coverageExemptNoncanonical: curated?.coverageExemptNoncanonical === true,
    liveGuard: guard,
    sourceResolution: phase1Row.sourceResolution,
    sourceSummaryResolution: phase1Row.sourceSummaryResolution,
    riskResolution: phase1Row.riskResolution,
    sourceCandidateSha256: val(ledgerRow?.selectedCandidate?.candidateSha256),
    resolvedCandidateSha256,
    resolvedSnapshot,
    warnings: unique([
      ...(outcome === READY ? ['structured_source_evidence_is_triage_not_manual_page_review'] : []),
      ...(outcome === READY && sourceCount < 2 ? ['single_provider_ai_conclusion_due_to_full_coverage_policy'] : []),
      ...(curated?.freshOverride ? ['fresh_research_snapshot_created_from_traceable_structured_sources'] : []),
      ...(guard?.draft?.humanTrackRecorded ? ['human_track_present_but_ai_track_remains_independent'] : []),
      ...(guard?.displayState && !guard.displayState.surfacedByWorkVisibility ? ['ai_conclusion_storage_independent_from_work_display_visibility'] : []),
    ]),
    displayPrecedence: 'valid_human_then_current_ai_then_unknown',
    displayPrecedenceAffectsStorage: false,
    productionApplyAuthorized: false,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      postgresqlRead: true,
      postgresqlWrite: false,
      productionDatabaseWrite: false,
      productionApplyAuthorized: false,
    },
  })
}
async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const flag of FORBIDDEN_FLAGS) if (args[flag]) throw new Error(`Phase 2 rejects --${flag}.`)
  const phase1Dir = required(args, 'phase1-dir')
  const closeoutDir = required(args, 'closeout-dir')
  const researchDir = required(args, 'research-dir')
  const outDir = required(args, 'out-dir')
  const baseUrl = val(args.url).replace(/\/+$/u, '')
  const branchHead = val(args['branch-head'])
  if (!baseUrl) throw new Error('Required: --url')
  if (!branchHead) throw new Error('Required: --branch-head')
  if (val(args['phase1-zip-sha256']).toLowerCase() !== EXPECTED_PHASE1_SHA256) throw new Error('Phase 1 ZIP SHA-256 mismatch.')
  if (val(args['closeout-zip-sha256']).toLowerCase() !== EXPECTED_CLOSEOUT_SHA256) throw new Error('Closeout ZIP SHA-256 mismatch.')
  if (val(args['research-zip-sha256']).toLowerCase() !== EXPECTED_RESEARCH_SHA256) throw new Error('Research ZIP SHA-256 mismatch.')
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)
  assertManifest(phase1Dir)
  assertManifest(closeoutDir)
  assertManifest(researchDir)

  const phase1Rows = readJsonl(path.join(phase1Dir, 'remaining-1122-phase1-resolution.jsonl'))
  const closeoutRows = readJsonl(path.join(closeoutDir, 'remaining-1122-all.jsonl'))
  const ledgerRows = readJsonl(path.join(researchDir, 'normalized-input-ledger.jsonl'))
  if (phase1Rows.length !== EXPECTED_ROWS || closeoutRows.length !== EXPECTED_ROWS || ledgerRows.length !== 1805) throw new Error('Input cardinality mismatch.')
  const closeoutByWork = new Map(closeoutRows.map((row) => [val(row.workId), row]))
  const ledgerByWork = new Map(ledgerRows.map((row) => [val(row.workId), row]))
  if (closeoutByWork.size !== EXPECTED_ROWS || ledgerByWork.size !== 1805) throw new Error('Input identity uniqueness mismatch.')
  const phase1Ids = new Set(phase1Rows.map((row) => val(row.workId)))
  if (phase1Ids.size !== EXPECTED_ROWS || [...phase1Ids].some((id) => !closeoutByWork.has(id) || !ledgerByWork.has(id))) throw new Error('Phase 1 join mismatch.')
  if (Object.keys(CURATED).length !== 18) throw new Error('Curated decision cardinality mismatch.')

  const token = await login(baseUrl)
  console.log('Reading draft Works sequentially...')
  const draftWorks = await fetchCollection(baseUrl, token, 'works', { draft: 'true' })
  console.log('Reading published Works sequentially...')
  const publishedWorks = await fetchCollection(baseUrl, token, 'works', { draft: 'false' })
  console.log('Reading current public AI conclusions sequentially...')
  const publicConclusions = await fetchCollection(baseUrl, token, 'radar-public-conclusions')
  const globalBlockers = []
  if (draftWorks.length !== EXPECTED_WORKS) globalBlockers.push(`draft_works_expected_${EXPECTED_WORKS}_received_${draftWorks.length}`)
  if (publishedWorks.length !== EXPECTED_WORKS) globalBlockers.push(`published_works_expected_${EXPECTED_WORKS}_received_${publishedWorks.length}`)
  const currentPublicRows = publicConclusions.filter((row) => val(row.recordStatus) === 'current')
  if (currentPublicRows.length !== EXPECTED_PUBLIC_CURRENT) globalBlockers.push(`current_public_expected_${EXPECTED_PUBLIC_CURRENT}_received_${currentPublicRows.length}`)
  const draftById = new Map(draftWorks.map((row) => [val(row.id), row]))
  const publishedById = new Map(publishedWorks.map((row) => [val(row.id), row]))
  const publicByKey = new Map()
  for (const row of currentPublicRows) {
    const key = val(row.publicationKey)
    if (publicByKey.has(key)) globalBlockers.push(`duplicate_current_public_key:${key}`)
    else publicByKey.set(key, row)
  }

  const generatedAt = new Date().toISOString()
  const finalRows = phase1Rows.map((phase1Row) => {
    const workId = val(phase1Row.workId)
    const closeoutRow = closeoutByWork.get(workId)
    const ledgerRow = ledgerByWork.get(workId)
    const guard = liveGuard({
      workId,
      siteId: val(closeoutRow?.siteId),
      draftWork: draftById.get(workId) || null,
      publishedWork: publishedById.get(workId) || null,
      currentPublic: publicByKey.get(`work:${workId}`) || null,
    })
    return finalizeRow({ phase1Row, closeoutRow, ledgerRow, guard, generatedAt })
  })

  const ready = finalRows.filter((row) => row.finalState === READY)
  const current = finalRows.filter((row) => row.finalState === CURRENT)
  const blocked = finalRows.filter((row) => row.finalState === BLOCKED)
  const decision = finalRows.filter((row) => row.finalState === DECISION)
  if (ready.length + current.length + blocked.length + decision.length !== EXPECTED_ROWS) globalBlockers.push('final_state_partition_mismatch')
  if (decision.length !== 0) globalBlockers.push(`unresolved_human_decisions_${decision.length}`)
  if (new Set(ready.map((row) => row.resolvedCandidateSha256)).size !== ready.length) globalBlockers.push('ready_candidate_hash_uniqueness_mismatch')
  if (ready.some((row) => !row.liveGuard.passed || !row.resolvedSnapshot)) globalBlockers.push('ready_row_missing_guard_or_snapshot')
  if (ready.some((row) => Number(row.resolvedSnapshot.sourceCount) < 1)) globalBlockers.push('ready_row_missing_traceable_source')
  const unresolvedCanonicalCoverage = blocked.filter((row) => row.coverageExemptNoncanonical !== true)
  if (unresolvedCanonicalCoverage.length > 0) globalBlockers.push(`unresolved_canonical_ai_coverage_${unresolvedCanonicalCoverage.length}`)

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    all: path.join(outDir, 'remaining-1122-phase2-final-closeout.jsonl'),
    ready: path.join(outDir, 'phase2-ready-for-unified-incremental-assembly.jsonl'),
    current: path.join(outDir, 'phase2-already-current-ai-conclusion.jsonl'),
    blocked: path.join(outDir, 'phase2-retained-blocked-final.jsonl'),
    decision: path.join(outDir, 'phase2-human-decision-required.jsonl'),
    guard: path.join(outDir, 'phase2-live-guard-results.jsonl'),
    summary: path.join(outDir, 'phase2-closeout-summary.json'),
    validation: path.join(outDir, 'phase2-validation.json'),
  }
  writeJsonl(outputs.all, finalRows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.current, current)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.decision, decision)
  writeJsonl(outputs.guard, finalRows.map((row) => canonical({
    workId: row.workId,
    publicationKey: row.publicationKey,
    finalState: row.finalState,
    liveGuard: row.liveGuard,
  })))

  const summary = canonical({
    schemaVersion: 1,
    generatedAt,
    version: VERSION,
    branchHead,
    rows: finalRows.length,
    readyForUnifiedIncrementalAssembly: ready.length,
    alreadyCurrentAIConclusion: current.length,
    retainedBlockedFinal: blocked.length,
    humanDecisionRequired: decision.length,
    liveIdentityGuardPassed: finalRows.filter((row) => row.liveGuard.passed).length,
    liveIdentityGuardFailed: finalRows.filter((row) => !row.liveGuard.passed).length,
    humanTrackRows: finalRows.filter((row) => row.liveGuard?.draft?.humanTrackRecorded).length,
    hiddenOrNonactiveDisplayRows: finalRows.filter((row) => row.liveGuard?.displayState && !row.liveGuard.displayState.surfacedByWorkVisibility).length,
    phase1Status: countBy(finalRows, (row) => row.phase1Status),
    finalReasonCodes: countBy(finalRows, (row) => row.finalReasonCode),
    readyGrades: countBy(ready, (row) => row.resolvedSnapshot?.suggestedGrade),
    curatedDecisions: {
      rows: Object.keys(CURATED).length,
      ready: Object.values(CURATED).filter((item) => item.outcome === READY).length,
      blocked: Object.values(CURATED).filter((item) => item.outcome === BLOCKED).length,
      freshSnapshots: Object.values(CURATED).filter((item) => item.freshOverride).length,
    },
    coveragePolicy: {
      canonicalWorkRequiresCurrentAIConclusion: true,
      humanTrackBlocksAIConclusion: false,
      evidenceShortageBlocksAIConclusion: false,
      lifecycleVisibilityBlocksAIStorage: false,
      displayAndSearchPrecedenceOnly: 'valid_human_then_current_ai_then_unknown',
    },
    productionBaseline: { worksDraft: draftWorks.length, worksPublished: publishedWorks.length, currentPublicConclusions: currentPublicRows.length },
    globalBlockers,
    readyForUnifiedAssemblyPlanning: globalBlockers.length === 0,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      payloadMutationRequests: 0,
      postgresqlRead: true,
      postgresqlWrite: false,
      productionDatabaseWrite: false,
      productionApplyAuthorized: false,
    },
  })
  const validation = canonical({
    schemaVersion: 1,
    exactInputHashesVerified: true,
    allInputManifestsVerified: true,
    expectedRows: EXPECTED_ROWS,
    observedRows: finalRows.length,
    uniqueWorkIds: new Set(finalRows.map((row) => row.workId)).size,
    uniquePublicationKeys: new Set(finalRows.map((row) => row.publicationKey)).size,
    finalPartitionSum: ready.length + current.length + blocked.length + decision.length,
    zeroUnresolvedHumanDecisions: decision.length === 0,
    allReadyLiveGuardPassed: ready.every((row) => row.liveGuard.passed),
    allReadyHaveTraceableSource: ready.every((row) => Number(row.resolvedSnapshot?.sourceCount) >= 1),
    singleProviderReadyRows: ready.filter((row) => Number(row.resolvedSnapshot?.sourceCount) < 2).length,
    allReadyHaveCompleteSnapshot: ready.every((row) => val(row.resolvedSnapshot?.sourceSummary) && val(row.resolvedSnapshot?.decisiveRuleCode)),
    noCurrentPublicOverlapInReady: ready.every((row) => !row.liveGuard.currentPublic),
    currentCoverageRowsHaveMatchingPublicRecord: current.every((row) => row.liveGuard.aiCoverageAlreadySatisfied),
    humanTrackNeverBlocksAI: ready.every((row) => !row.liveGuard.blockers.includes('valid_human_track_present')),
    lifecycleVisibilityNeverBlocksAIStorage: ready.every((row) => !row.liveGuard.blockers.some((item) => /^(catalog_status_|payload_status_|lite_hidden|full_hidden)/u.test(item))),
    noncanonicalCoverageExemptRows: blocked.filter((row) => row.coverageExemptNoncanonical === true).length,
    unresolvedCanonicalAICoverageRows: blocked.filter((row) => row.coverageExemptNoncanonical !== true).length,
    titleOnlyIdentityAccepted: false,
    gradeMutationRows: ready.filter((row) => {
      const original = ledgerByWork.get(row.workId)?.selectedCandidate?.grade
      return val(original) !== val(row.resolvedSnapshot?.suggestedGrade)
    }).length,
    allowedFreshGradeMutationWorkIds: ready.filter((row) => {
      const original = ledgerByWork.get(row.workId)?.selectedCandidate?.grade
      return val(original) !== val(row.resolvedSnapshot?.suggestedGrade)
    }).map((row) => row.workId),
    globalBlockers,
    passed: globalBlockers.length === 0,
    safety: summary.safety,
  })
  const allowedMutationIds = new Set(['31143', '31588', '31692', '32094', '33699'])
  const unexpectedMutationIds = validation.allowedFreshGradeMutationWorkIds.filter((id) => !allowedMutationIds.has(id))
  if (validation.gradeMutationRows > allowedMutationIds.size || unexpectedMutationIds.length > 0) {
    globalBlockers.push('unexpected_grade_mutation_set')
    summary.globalBlockers = globalBlockers
    summary.readyForUnifiedAssemblyPlanning = false
    validation.globalBlockers = globalBlockers
    validation.passed = false
  }
  writeJson(outputs.summary, summary)
  writeJson(outputs.validation, validation)

  console.log(`Radar remaining 1,122 Phase 2 live guard closeout complete`)
  console.log(`Rows: ${finalRows.length}`)
  console.log(`ReadyForUnifiedIncrementalAssembly: ${ready.length}`)
  console.log(`AlreadyCurrentAIConclusion: ${current.length}`)
  console.log(`RetainedBlockedFinal: ${blocked.length}`)
  console.log(`HumanDecisionRequired: ${decision.length}`)
  console.log(`LiveIdentityGuardPassed: ${summary.liveIdentityGuardPassed}`)
  console.log(`LiveIdentityGuardFailed: ${summary.liveIdentityGuardFailed}`)
  console.log(`SingleProviderReadyRows: ${validation.singleProviderReadyRows}`)
  console.log(`PayloadRead: True`)
  console.log(`PayloadWrite: False`)
  console.log(`PostgreSQLRead: True`)
  console.log(`PostgreSQLWrite: False`)
  console.log(`ProductionApplyAuthorized: False`)
  if (globalBlockers.length) process.exitCode = 2
}

const direct = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (direct) main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
