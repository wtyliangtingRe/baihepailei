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
const VIOLENCE = new Set(['none_found', 'present', 'severe', 'unknown'])
const RISK = new Set(['none_found', 'possible', 'confirmed', 'unknown'])
const WRITE_FLAGS = ['execute', 'apply', 'write', 'patch', 'confirm', 'gate', 'approval-token', 'production-apply', 'publish']

export const val = (value) => String(value ?? '').trim()
export const list = (value) => Array.isArray(value) ? value : []
export const sha256Buffer = (value) => createHash('sha256').update(value).digest('hex')
export const sha256File = (file) => sha256Buffer(fs.readFileSync(file))
export const sha256Text = (value) => sha256Buffer(Buffer.from(String(value)))
export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
export function readJsonl(file) { const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim(); return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line, index) => { try { return JSON.parse(line) } catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) } }) : [] }
export function parseArgs(argv) { const result = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true } return result }
export function rejectWriteFlags(args) { for (const key of WRITE_FLAGS) if (args[key]) throw new Error(`Local review handoff rejects --${key}`) }
export function assertRelative(value, label = 'path') { const normalized = val(value).replace(/\\/gu, '/'); if (!normalized || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized) || normalized.split('/').some((part) => part === '..') || normalized.includes('\0')) throw new Error(`Unsafe ${label}: ${value}`); return normalized }
export function assertConfined(root, relative, label = 'path') { const safe = assertRelative(relative, label); const resolvedRoot = path.resolve(root); const resolved = path.resolve(resolvedRoot, safe); if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} escaped root: ${relative}`); return resolved }
export function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value }
export const sameJson = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

export function allowedModes(disposition) { if (disposition === 'ready_for_ai_assessment') return ['exact', 'bounded_range']; if (disposition === 'needs_more_research') return ['bounded_range', 'labels_only']; if (disposition === 'identity_review') return ['labels_only']; return [] }
export function validateOutcome(outcome, disposition) {
  const mode = val(outcome?.assessmentMode); if (!MODES.has(mode) || !allowedModes(disposition).includes(mode)) throw new Error(`Invalid assessment mode for ${disposition}`)
  const exact = outcome?.exactGradeSuggestion == null ? null : val(outcome.exactGradeSuggestion); const range = outcome?.gradeRange ?? null
  if (mode === 'exact' && (!GRADE_ORDER.includes(exact) || exact === 'X' || range != null)) throw new Error('exact requires one non-X exact grade and no range')
  if (mode !== 'exact' && exact != null) throw new Error(`${mode} forbids exact grade`)
  if (mode === 'labels_only' && range != null) throw new Error('labels_only forbids grade range')
  if (mode === 'bounded_range') { const grades = range && [val(range.best), val(range.likely), val(range.worst)]; if (!grades || grades.some((grade) => !GRADE_ORDER.includes(grade) || grade === 'X')) throw new Error('bounded_range requires three non-X grades'); const indexes = grades.map((grade) => GRADE_ORDER.indexOf(grade)); if (indexes[0] > indexes[1] || indexes[1] > indexes[2]) throw new Error('grade range is unordered') }
  if (!Array.isArray(outcome?.riskLabels) || !Array.isArray(outcome?.ruleAssessments)) throw new Error('riskLabels and ruleAssessments must be arrays')
  if (outcome?.requiresHumanReview !== true || outcome?.publicationEligible !== false) throw new Error('responses must require human review and be publication-ineligible')
  return true
}

function explicitSettingFlags(settings) { const values = list(settings).map((item) => val(item).toLowerCase()); const has = (pattern) => values.some((item) => pattern.test(item)); return { ts: has(/(^|[^a-z])ts([^a-z]|$)|transsexual/u), futa: has(/futa|futanari/u), abo: has(/(^|[^a-z])abo([^a-z]|$)|omegaverse/u), crossdressingOrOtokonoko: has(/crossdress|otokonoko|男の娘/u) } }
export function normalizeContentProfile(row) {
  const raw = row?.riskFindings && typeof row.riskFindings === 'object' && !Array.isArray(row.riskFindings) ? row.riskFindings : {}
  const sexualContent = SEXUAL.has(val(raw.sexualContent || raw.adultContent)) ? val(raw.sexualContent || raw.adultContent) : 'unknown'
  const explicitParticipants = val(raw.sexualParticipants); const sexualParticipants = sexualContent === 'none_found' ? 'none' : PARTICIPANTS.has(explicitParticipants) && explicitParticipants !== 'none' ? explicitParticipants : 'unknown'
  const settings = explicitSettingFlags(raw.settingProfiles)
  return { sexualContent, sexualParticipants, violenceOrHorror: VIOLENCE.has(val(raw.violenceOrHorror)) ? val(raw.violenceOrHorror) : 'unknown', ageOrConsentRisk: RISK.has(val(raw.ageOrConsentRisk)) ? val(raw.ageOrConsentRisk) : 'unknown', coercionRisk: RISK.has(val(raw.coercionRisk)) ? val(raw.coercionRisk) : 'unknown', ts: settings.ts, futa: settings.futa, abo: settings.abo, crossdressingOrOtokonoko: settings.crossdressingOrOtokonoko, ntrRisk: val(raw.ntrRisk) || 'unknown', maleInvolvement: val(raw.maleInvolvement) || 'unknown', rawAdultContent: structuredClone(raw) }
}
export function contentRiskLabels(profile) { return [`sexual_content:${profile.sexualContent}`, `sexual_participants:${profile.sexualParticipants}`, `violence_or_horror:${profile.violenceOrHorror}`, `age_or_consent_risk:${profile.ageOrConsentRisk}`, `coercion_risk:${profile.coercionRisk}`, `ntr_risk:${profile.ntrRisk}`, `male_involvement:${profile.maleInvolvement}`, ...['ts', 'futa', 'abo', 'crossdressingOrOtokonoko'].filter((key) => profile[key]).map((key) => `setting:${key}`)] }
export function inputRow(row) { const disposition = val(row.researchStatus); if (!DISPOSITIONS.has(disposition)) throw new Error(`Unknown research disposition: ${disposition}`); const profile = normalizeContentProfile(row); return { workId: val(row.workId), siteId: val(row.siteId), title: val(row.title), researchDisposition: disposition, allowedAssessmentModes: allowedModes(disposition), identity: { identityStatus: val(row.identityStatus) }, writeProtection: structuredClone(row.writeProtection || { protected: false, reasons: [] }), research: { evidenceCoverage: row.evidenceCoverage, evidenceStatus: val(row.evidenceStatus), sourceSummary: val(row.sourceSummary), contentSummary: val(row.contentSummary), relationshipSummary: val(row.relationshipSummary), endingSummary: val(row.endingSummary), sources: structuredClone(list(row.sources)), contradictions: structuredClone(list(row.contradictions)), unresolvedQuestions: structuredClone(list(row.unresolvedQuestions)), researchNotes: structuredClone(list(row.researchNotes)), riskFindings: structuredClone(row.riskFindings || {}) }, contentProfile: profile, riskLabels: contentRiskLabels(profile), requiresHumanReview: true, publicationEligible: false, pageNotice: 'AI 综合，待复核' } }

export function archiveInventory(zip) {
  const buffer = fs.readFileSync(zip); let eocd = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory missing')
  const count = buffer.readUInt16LE(eocd + 10); let offset = buffer.readUInt32LE(eocd + 16); const seen = new Set()
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central-directory entry')
    const flags = buffer.readUInt16LE(offset + 8); const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32); const external = buffer.readUInt32LE(offset + 38); const nameBuffer = buffer.subarray(offset + 46, offset + 46 + nameLength); const name = nameBuffer.toString(flags & 0x800 ? 'utf8' : 'utf8'); const safe = assertRelative(name, 'ZIP entry').replace(/\/$/u, ''); const unixMode = (external >>> 16) & 0xffff; const fileType = unixMode & 0xf000
    if (fileType === 0xa000) throw new Error(`ZIP symlink entry forbidden: ${safe}`)
    if (safe && seen.has(safe)) throw new Error(`Duplicate ZIP entry: ${safe}`)
    if (safe) seen.add(safe); offset += 46 + nameLength + extraLength + commentLength
  }
  return seen
}function filesUnder(root) { const output = []; const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isSymbolicLink()) throw new Error(`Extracted symlink forbidden: ${file}`); if (entry.isDirectory()) walk(file); else output.push(path.relative(root, file).replace(/\\/gu, '/')) } }; walk(root); return new Set(output) }
export function loadResearchPackage(input, expectedSha, scratch, acceptance = {}) {
  const source = path.resolve(input); if (!fs.existsSync(source)) throw new Error(`Research input not found: ${input}`); if (expectedSha && fs.statSync(source).isFile() && sha256File(source).toUpperCase() !== val(expectedSha).toUpperCase()) throw new Error('Outer research ZIP SHA-256 mismatch')
  let root = source; let inventory = null
  if (fs.statSync(source).isFile()) { if (!/\.zip$/iu.test(source)) throw new Error('Research input must be ZIP or extracted directory'); inventory = archiveInventory(source); fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true }); execFileSync('tar', ['-xf', source, '-C', scratch]); root = scratch }
  const canonicalRoot = fs.realpathSync(root); for (const rel of filesUnder(root)) { const canonical = fs.realpathSync(assertConfined(root, rel)); if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error(`Canonical path escaped root: ${rel}`) }
  const manifestFile = path.join(root, 'review-manifest.json'); if (!fs.existsSync(manifestFile)) throw new Error('review-manifest.json missing'); const review = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); const listed = new Set(['review-manifest.json'])
  for (const entry of list(review)) { const rel = assertRelative(entry?.file, 'review manifest entry'); if (listed.has(rel)) throw new Error(`Duplicate review manifest entry: ${rel}`); listed.add(rel); const file = assertConfined(root, rel); if (!fs.existsSync(file) || fs.statSync(file).size !== Number(entry.bytes) || sha256File(file) !== val(entry.sha256)) throw new Error(`Review manifest mismatch: ${rel}`) }
  const actual = filesUnder(root); for (const rel of actual) if (!listed.has(rel)) throw new Error(`Unlisted payload file: ${rel}`); for (const rel of listed) if (!actual.has(rel)) throw new Error(`Listed payload file missing: ${rel}`); if (inventory) { for (const rel of actual) if (!inventory.has(rel)) throw new Error(`Extracted file absent from ZIP inventory: ${rel}`) }
  const waveCount = Number(acceptance.waveCount); if (!Number.isInteger(waveCount) || waveCount < 1) throw new Error('Acceptance binding requires waveCount'); const waves = []
  for (let number = 1; number <= waveCount; number += 1) { const wave = `wave-${String(number).padStart(2, '0')}`; const waveRoot = path.join(root, 'waves', wave); const assembledRoot = path.join(waveRoot, 'assembled'); const summary = JSON.parse(fs.readFileSync(path.join(assembledRoot, 'assembly-summary.json'), 'utf8')); const sourceFile = fs.readdirSync(waveRoot).find((name) => name.endsWith('.source.jsonl')); if (!sourceFile) throw new Error(`Source file missing: ${wave}`); const rows = readJsonl(path.join(assembledRoot, 'research-results-v01.jsonl')); const sourceRows = readJsonl(path.join(waveRoot, sourceFile)); if (!summary.complete || rows.length !== Number(acceptance.rowsPerWave) || sourceRows.length !== rows.length) throw new Error(`Wave acceptance mismatch: ${wave}`); waves.push({ wave, rows, sourceRows }) }
  const rows = waves.flatMap((wave) => wave.rows); const sourceRows = waves.flatMap((wave) => wave.sourceRows); if (rows.length !== Number(acceptance.rowCount)) throw new Error('Package row count mismatch'); const workIds = new Set(); const siteIds = new Set(); let identityOrderMismatches = 0
  for (let index = 0; index < rows.length; index += 1) { const row = rows[index], sourceRow = sourceRows[index]; if (!val(row.workId) || !val(row.siteId) || workIds.has(val(row.workId)) || siteIds.has(val(row.siteId))) throw new Error('Work IDs and site IDs must be unique'); workIds.add(val(row.workId)); siteIds.add(val(row.siteId)); if (val(row.workId) !== val(sourceRow.workId) || val(row.siteId) !== val(sourceRow.siteId) || val(row.title) !== val(sourceRow.title)) identityOrderMismatches += 1; for (const key of ['sourceSummary', 'sources', 'unresolvedQuestions', 'researchNotes', 'riskFindings']) if (row[key] == null) throw new Error(`Missing research field ${key}:${row.workId}`) }
  if (identityOrderMismatches) throw new Error(`Source-to-assembled identity/order mismatches: ${identityOrderMismatches}`); const counts = Object.fromEntries([...DISPOSITIONS].map((lane) => [lane, rows.filter((row) => row.researchStatus === lane).length])); for (const [lane, count] of Object.entries(acceptance.laneCounts || {})) if (counts[lane] !== Number(count)) throw new Error(`Lane acceptance mismatch: ${lane}`)
  return { root, rows, waves, counts, identityOrderMismatches, inputSha256: fs.statSync(source).isFile() ? sha256File(source) : null }
}