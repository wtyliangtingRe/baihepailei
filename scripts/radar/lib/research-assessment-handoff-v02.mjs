import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const VERSION = 'ai-radar-research-assessment-handoff-v0.2'
export const GRADE_ORDER = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']
export const DISPOSITIONS = new Set(['ready_for_ai_assessment', 'needs_more_research', 'identity_review'])
export const MODES = new Set(['exact', 'bounded_range', 'labels_only'])
const SEXUAL = new Set(['none_found', 'suggestive', 'present', 'explicit', 'unknown'])
const PARTICIPANTS = new Set(['none', 'female_female', 'female_male', 'male_male', 'mixed', 'unknown'])
const RISK = new Set(['none_found', 'present', 'severe', 'unknown'])
const CONSENT = new Set(['none_found', 'possible', 'confirmed', 'unknown'])

export const val = (value) => String(value ?? '').trim()
export const list = (value) => Array.isArray(value) ? value : []
export const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
export const sha256Text = (value) => createHash('sha256').update(String(value)).digest('hex')
export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
export function readJsonl(file) { return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse) }
export function assertRelative(value, label = 'path') {
  const normalized = val(value).replace(/\\/gu, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized) || normalized.split('/').includes('..')) throw new Error(`Unsafe ${label}: ${value}`)
  return normalized
}
export function rejectWriteFlags(args) {
  for (const key of ['execute', 'apply', 'write', 'patch', 'confirm', 'gate', 'approval-token', 'production-apply']) if (args[key]) throw new Error(`Local review handoff rejects --${key}`)
}
export function parseArgs(argv) { const result = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const k = argv[i].slice(2); result[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true } return result }
export function normalizeContentProfile(row) {
  const raw = row?.riskFindings && typeof row.riskFindings === 'object' ? row.riskFindings : {}
  const setting = list(raw.settingProfiles).map(val).map((x) => x.toLowerCase())
  const adult = val(raw.adultContent) || 'unknown'
  const sexualContent = SEXUAL.has(adult) ? adult : 'unknown'
  const male = val(raw.maleInvolvement)
  const participants = sexualContent === 'none_found' ? 'none' : male === 'none_found' ? 'female_female' : ['sexual', 'significant', 'romantic'].includes(male) ? 'mixed' : 'unknown'
  return {
    sexualContent,
    sexualParticipants: PARTICIPANTS.has(participants) ? participants : 'unknown',
    violenceOrHorror: RISK.has(val(raw.violenceOrHorror)) ? val(raw.violenceOrHorror) : 'unknown',
    ageOrConsentRisk: CONSENT.has(val(raw.ageOrConsentRisk)) ? val(raw.ageOrConsentRisk) : 'unknown',
    coercionRisk: CONSENT.has(val(raw.coercionRisk)) ? val(raw.coercionRisk) : (setting.some((x) => /coerc|rape|forced/u.test(x)) ? 'possible' : 'unknown'),
    rawAdultContent: raw,
  }
}
export function allowedModes(disposition) {
  if (disposition === 'ready_for_ai_assessment') return ['exact', 'bounded_range']
  if (disposition === 'needs_more_research') return ['bounded_range', 'labels_only']
  return ['labels_only']
}
export function validateOutcome(outcome, disposition) {
  const mode = val(outcome?.assessmentMode); if (!MODES.has(mode) || !allowedModes(disposition).includes(mode)) throw new Error(`Invalid assessment mode for ${disposition}`)
  const exact = outcome?.exactGradeSuggestion == null ? null : val(outcome.exactGradeSuggestion)
  const range = outcome?.gradeRange
  if (mode === 'exact' && (!GRADE_ORDER.includes(exact) || exact === 'X' || range)) throw new Error('exact requires one non-X grade and no range')
  if (mode === 'labels_only' && exact) throw new Error('labels_only forbids exact grade')
  if (mode === 'bounded_range') {
    if (!range || !GRADE_ORDER.includes(val(range.best)) || !GRADE_ORDER.includes(val(range.likely)) || !GRADE_ORDER.includes(val(range.worst))) throw new Error('bounded_range requires grades')
    if (GRADE_ORDER.indexOf(val(range.best)) > GRADE_ORDER.indexOf(val(range.likely)) || GRADE_ORDER.indexOf(val(range.likely)) > GRADE_ORDER.indexOf(val(range.worst))) throw new Error('grade range is unordered')
  }
  return true
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function safeExtract(zip, root) {
  const names = execFileSync('tar', ['-tf', zip], { encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean)
  const seen = new Set(); for (const name of names) { const safe = assertRelative(name, 'ZIP entry'); if (seen.has(safe)) throw new Error(`Duplicate ZIP entry: ${safe}`); seen.add(safe) }
  fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true }); execFileSync('tar', ['-xf', zip, '-C', root])
}
export function loadResearchPackage(input, expectedSha, scratch) {
  const source = path.resolve(input); if (!fs.existsSync(source)) throw new Error(`Research input not found: ${input}`)
  if (expectedSha && sha256File(source).toUpperCase() !== val(expectedSha).toUpperCase()) throw new Error('Outer research ZIP SHA-256 mismatch')
  let root = source
  if (fs.statSync(source).isFile()) { if (!/\.zip$/iu.test(source)) throw new Error('Research input must be ZIP or extracted directory'); safeExtract(source, scratch); root = scratch }
  const review = readJson(path.join(root, 'review-manifest.json'))
  for (const entry of list(review)) { const rel = assertRelative(entry?.file, 'review manifest entry'); const file = path.join(root, rel); if (!fs.existsSync(file) || fs.statSync(file).size !== Number(entry.bytes) || sha256File(file) !== val(entry.sha256)) throw new Error(`Review manifest mismatch: ${rel}`) }
  const waves = []
  for (let n = 1; n <= 10; n += 1) {
    const wave = `wave-${String(n).padStart(2, '0')}`; const base = path.join(root, 'waves', wave, 'assembled'); const summary = readJson(path.join(base, 'assembly-summary.json'))
    if (!summary.complete || Number(summary.assembledRows) !== 250) throw new Error(`Invalid assembly summary: ${wave}`)
    waves.push({ wave, summary, rows: readJsonl(path.join(base, 'research-results-v01.jsonl')), source: readJsonl(path.join(root, 'waves', wave, `radar-remaining-canonical-research-0001-${wave}.source.jsonl`)) })
  }
  const rows = waves.flatMap((wave) => wave.rows); const sourceRows = waves.flatMap((wave) => wave.source)
  if (rows.length !== 2500 || sourceRows.length !== 2500) throw new Error('Expected exactly 2,500 rows')
  const ids = new Set(); const sites = new Set(); for (let i = 0; i < rows.length; i += 1) { const key = `${val(rows[i].workId)}|${val(rows[i].siteId)}`; if (!val(rows[i].workId) || !val(rows[i].siteId) || ids.has(key) || sites.has(val(rows[i].siteId))) throw new Error('Work/site identities must be unique'); ids.add(key); sites.add(val(rows[i].siteId)); if (val(rows[i].workId) !== val(sourceRows[i].workId) || val(rows[i].siteId) !== val(sourceRows[i].siteId)) throw new Error('Source-to-assembled identity/order mismatch') }
  const counts = Object.fromEntries([...DISPOSITIONS].map((d) => [d, rows.filter((r) => r.researchStatus === d).length]))
  if (counts.ready_for_ai_assessment !== 962 || counts.needs_more_research !== 1311 || counts.identity_review !== 227) throw new Error('Accepted package disposition counts mismatch')
  return { root, rows, waves, counts }
}
export function inputRow(row) {
  const disposition = val(row.researchStatus); if (!DISPOSITIONS.has(disposition)) throw new Error('Unknown research disposition')
  return { workId: val(row.workId), siteId: val(row.siteId), title: val(row.title), researchDisposition: disposition, allowedAssessmentModes: allowedModes(disposition), contentProfile: normalizeContentProfile(row), research: { identityStatus: val(row.identityStatus), sourceSummary: val(row.sourceSummary), contentSummary: val(row.contentSummary), relationshipSummary: val(row.relationshipSummary), endingSummary: val(row.endingSummary), sources: list(row.sources), unresolvedQuestions: list(row.unresolvedQuestions), researchNotes: list(row.researchNotes), riskFindings: row.riskFindings || {} }, requiresHumanReview: true, publicationEligible: false, pageNotice: 'AI 综合，待复核', writeProtection: row.writeProtection || { protected: false, reasons: [] } }
}
