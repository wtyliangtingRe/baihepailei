import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const PUBLIC_RELEASE_VERSION = 'radar-public-release-v01'
export const PUBLIC_RECORD_VERSION = 'radar-public-record-v01'
export const PUBLIC_STATES = new Set(['verified', 'partial', 'needs_more_research'])
export const RESEARCH_STATUSES = new Set(['ready_for_publication', 'partially_verified', 'needs_more_research'])
export const SOURCE_TIERS = new Set(['A', 'B', 'C', 'D', 'E'])
export const EVIDENCE_ROLES = new Set(['primary', 'supplemental', 'lead_only'])
export const ASSESSMENT_TRACKS = new Set(['human', 'radar'])
export const ASSESSMENT_REVIEW_STATUSES = new Set(['human_verified', 'approved_for_publication'])

const WRITE_FLAGS = new Set([
  'execute', 'apply', 'write', 'patch', 'confirm', 'publish', 'release',
  'production-apply', 'approval-token', 'migrate', 'schema-push',
])
const REQUIRED_FILES = new Set(['manifest.json', 'records.jsonl', 'SHA256SUMS'])
const REQUIRED_CHECKSUM_TARGETS = new Set(['manifest.json', 'records.jsonl'])
const FORBIDDEN_PUBLIC_ASSESSMENT_FIELDS = new Set([
  'suggestedGrade', 'provisionalExactSuggestion', 'boundedRange', 'gradeRange',
  'confidenceRange', 'labelsOnly', 'automaticGrade', 'autoSuggestedGrade',
])

export const val = (value) => String(value ?? '').trim()
export const sha256Buffer = (value) => crypto.createHash('sha256').update(value).digest('hex')
export const sha256File = (file) => sha256Buffer(fs.readFileSync(file))

export function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

export function rejectWriteFlags(args) {
  const rejected = Object.keys(args).filter((key) => WRITE_FLAGS.has(key))
  if (rejected.length) throw new Error(`Public release validation is dry-run only; rejected flags: ${rejected.join(', ')}`)
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function requireObject(value, label) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value
}

function requireString(value, label) {
  const normalized = val(value)
  requireCondition(Boolean(normalized), `${label} must be a non-empty string`)
  return normalized
}

function requireIsoDate(value, label) {
  const normalized = requireString(value, label)
  requireCondition(!Number.isNaN(Date.parse(normalized)), `${label} must be an ISO-compatible date`)
  return normalized
}

function requireHttpsUrl(value, label) {
  const normalized = requireString(value, label)
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  requireCondition(parsed.protocol === 'https:', `${label} must use https`)
  return normalized
}

function assertSafeRelativePath(value, label) {
  const normalized = requireString(value, label).replaceAll('\\', '/').normalize('NFC')
  const parts = normalized.split('/')
  requireCondition(
    !normalized.startsWith('/')
      && !normalized.startsWith('//')
      && !/^[a-z]:/iu.test(normalized)
      && !parts.some((part) => part === '' || part === '.' || part === '..')
      && !normalized.includes('\0'),
    `${label} is unsafe: ${value}`,
  )
  return normalized
}

function listFilesRecursively(root) {
  const found = []
  function visit(directory, relativeRoot = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name
      const absolute = path.join(directory, entry.name)
      requireCondition(!entry.isSymbolicLink(), `Package contains a symlink: ${relative}`)
      if (entry.isDirectory()) visit(absolute, relative)
      else {
        requireCondition(entry.isFile(), `Package contains a non-regular entry: ${relative}`)
        found.push(relative.replaceAll('\\', '/'))
      }
    }
  }
  visit(root)
  return found.sort()
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`)
  }
}

function readLfJsonl(file) {
  const bytes = fs.readFileSync(file)
  requireCondition(!bytes.includes(13), 'records.jsonl must use LF line endings')
  const text = bytes.toString('utf8')
  requireCondition(!text.startsWith('\uFEFF'), 'records.jsonl must not contain a BOM')
  if (!text) return []
  requireCondition(text.endsWith('\n'), 'records.jsonl must end with LF')
  const lines = text.slice(0, -1).split('\n')
  return lines.map((line, index) => {
    requireCondition(Boolean(line), `records.jsonl contains an empty line at ${index + 1}`)
    try {
      const value = JSON.parse(line)
      return requireObject(value, `records.jsonl:${index + 1}`)
    } catch (error) {
      if (error.message.startsWith('records.jsonl:')) throw error
      throw new Error(`Invalid records.jsonl:${index + 1}: ${error.message}`)
    }
  })
}

function readChecksums(file) {
  const text = fs.readFileSync(file, 'utf8')
  requireCondition(!text.includes('\r'), 'SHA256SUMS must use LF line endings')
  requireCondition(text.endsWith('\n'), 'SHA256SUMS must end with LF')
  const rows = text.slice(0, -1).split('\n').filter(Boolean)
  const result = new Map()
  for (const [index, row] of rows.entries()) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(row)
    requireCondition(Boolean(match), `Invalid SHA256SUMS line ${index + 1}`)
    const relative = assertSafeRelativePath(match[2], `SHA256SUMS line ${index + 1} path`)
    requireCondition(!result.has(relative), `Duplicate SHA256SUMS path: ${relative}`)
    result.set(relative, match[1])
  }
  requireCondition(
    result.size === REQUIRED_CHECKSUM_TARGETS.size
      && [...REQUIRED_CHECKSUM_TARGETS].every((item) => result.has(item)),
    'SHA256SUMS must list exactly manifest.json and records.jsonl',
  )
  return result
}

function validateEvidence(evidence, recordLabel) {
  requireCondition(Array.isArray(evidence), `${recordLabel}.evidence must be an array`)
  const refs = new Map()
  for (const [index, source] of evidence.entries()) {
    const label = `${recordLabel}.evidence[${index}]`
    requireObject(source, label)
    const sourceRef = requireString(source.sourceRef, `${label}.sourceRef`)
    requireCondition(!refs.has(sourceRef), `${recordLabel} has duplicate sourceRef: ${sourceRef}`)
    requireCondition(SOURCE_TIERS.has(source.tier), `${label}.tier is invalid`)
    requireCondition(EVIDENCE_ROLES.has(source.role), `${label}.role is invalid`)
    requireHttpsUrl(source.url, `${label}.url`)
    requireString(source.title, `${label}.title`)
    requireCondition(source.exactIdentityBound === true, `${label}.exactIdentityBound must be true`)
    if (source.retrievedAt != null) requireIsoDate(source.retrievedAt, `${label}.retrievedAt`)
    refs.set(sourceRef, source)
  }
  return refs
}

function validateSourceRefs(sourceRefs, evidenceByRef, label) {
  requireCondition(Array.isArray(sourceRefs) && sourceRefs.length > 0, `${label} must be a non-empty array`)
  const unique = new Set()
  let hasPublishableEvidence = false
  for (const [index, sourceRefValue] of sourceRefs.entries()) {
    const sourceRef = requireString(sourceRefValue, `${label}[${index}]`)
    requireCondition(!unique.has(sourceRef), `${label} contains duplicate sourceRef: ${sourceRef}`)
    unique.add(sourceRef)
    const evidence = evidenceByRef.get(sourceRef)
    requireCondition(Boolean(evidence), `${label} references missing evidence: ${sourceRef}`)
    if (evidence.role !== 'lead_only') hasPublishableEvidence = true
  }
  requireCondition(hasPublishableEvidence, `${label} cannot rely only on lead_only evidence`)
}

function validateFacts(facts, evidenceByRef, recordLabel) {
  requireCondition(Array.isArray(facts), `${recordLabel}.facts must be an array`)
  const ids = new Set()
  for (const [index, fact] of facts.entries()) {
    const label = `${recordLabel}.facts[${index}]`
    requireObject(fact, label)
    const factId = requireString(fact.factId, `${label}.factId`)
    requireCondition(!ids.has(factId), `${recordLabel} has duplicate factId: ${factId}`)
    ids.add(factId)
    requireString(fact.type, `${label}.type`)
    requireCondition(fact.value !== undefined && fact.value !== null, `${label}.value is required`)
    validateSourceRefs(fact.sourceRefs, evidenceByRef, `${label}.sourceRefs`)
  }
}

function validateAssessment(assessment, evidenceByRef, recordLabel) {
  requireObject(assessment, `${recordLabel}.assessment`)
  for (const key of FORBIDDEN_PUBLIC_ASSESSMENT_FIELDS) {
    requireCondition(!(key in assessment), `${recordLabel}.assessment contains provisional field: ${key}`)
  }
  requireCondition(ASSESSMENT_TRACKS.has(assessment.track), `${recordLabel}.assessment.track is invalid`)
  requireCondition(
    ASSESSMENT_REVIEW_STATUSES.has(assessment.reviewStatus),
    `${recordLabel}.assessment.reviewStatus is not publication-approved`,
  )
  requireString(assessment.gradeLabel, `${recordLabel}.assessment.gradeLabel`)
  requireString(assessment.policyVersion, `${recordLabel}.assessment.policyVersion`)
  requireIsoDate(assessment.reviewedAt, `${recordLabel}.assessment.reviewedAt`)
  validateSourceRefs(assessment.sourceRefs, evidenceByRef, `${recordLabel}.assessment.sourceRefs`)
}

export function validatePublicRecord(record, index) {
  const label = `record[${index}]`
  requireObject(record, label)
  requireCondition(record.schemaVersion === PUBLIC_RECORD_VERSION, `${label}.schemaVersion is invalid`)
  const workId = requireString(record.workId, `${label}.workId`)
  const siteId = requireString(record.siteId, `${label}.siteId`)
  requireCondition(record.identityKey === `${workId}|${siteId}`, `${label}.identityKey does not match workId/siteId`)
  requireString(record.title, `${label}.title`)
  requireCondition(PUBLIC_STATES.has(record.publicState), `${label}.publicState is invalid`)
  requireCondition(RESEARCH_STATUSES.has(record.researchStatus), `${label}.researchStatus is invalid`)
  requireIsoDate(record.lastReviewedAt, `${label}.lastReviewedAt`)
  requireString(record.pageNotice, `${label}.pageNotice`)

  requireCondition(Array.isArray(record.aliases), `${label}.aliases must be an array`)
  const aliases = record.aliases.map((item, aliasIndex) => requireString(item, `${label}.aliases[${aliasIndex}]`))
  requireCondition(new Set(aliases).size === aliases.length, `${label}.aliases contains duplicates`)

  requireObject(record.externalIds, `${label}.externalIds`)
  for (const [key, value] of Object.entries(record.externalIds)) {
    requireString(key, `${label}.externalIds key`)
    requireString(value, `${label}.externalIds.${key}`)
  }

  const evidenceByRef = validateEvidence(record.evidence, label)
  validateFacts(record.facts, evidenceByRef, label)

  if (record.publicState === 'needs_more_research') {
    requireCondition(record.researchStatus === 'needs_more_research', `${label} needs_more_research state/status mismatch`)
    requireCondition(record.assessment == null, `${label} must not publish an assessment while needs_more_research`)
  }
  if (record.publicState === 'verified') {
    requireCondition(record.researchStatus === 'ready_for_publication', `${label} verified state/status mismatch`)
  }
  if (record.publicState === 'partial') {
    requireCondition(record.researchStatus === 'partially_verified', `${label} partial state/status mismatch`)
  }
  if (record.assessment != null) validateAssessment(record.assessment, evidenceByRef, label)

  return {
    identityKey: record.identityKey,
    publicState: record.publicState,
    rated: record.assessment != null,
    factCount: record.facts.length,
    evidenceCount: record.evidence.length,
  }
}

function validateManifest(manifest, records, recordsSha256) {
  requireObject(manifest, 'manifest')
  requireCondition(manifest.schemaVersion === PUBLIC_RELEASE_VERSION, 'manifest.schemaVersion is invalid')
  requireString(manifest.releaseId, 'manifest.releaseId')
  requireIsoDate(manifest.generatedAt, 'manifest.generatedAt')

  const source = requireObject(manifest.source, 'manifest.source')
  requireCondition(
    source.repository === 'wtyliangtingRe/baihepailei-research-data',
    'manifest.source.repository is not the accepted research repository',
  )
  requireCondition(/^[a-f0-9]{40}$/u.test(val(source.commitSha)), 'manifest.source.commitSha must be a 40-character lowercase SHA')
  requireString(source.policyVersion, 'manifest.source.policyVersion')
  requireString(source.researchSnapshotId, 'manifest.source.researchSnapshotId')

  const files = requireObject(manifest.files, 'manifest.files')
  const recordsFile = requireObject(files.records, 'manifest.files.records')
  requireCondition(recordsFile.path === 'records.jsonl', 'manifest.files.records.path must be records.jsonl')
  requireCondition(recordsFile.rowCount === records.length, 'manifest.files.records.rowCount mismatch')
  requireCondition(recordsFile.sha256 === recordsSha256, 'manifest.files.records.sha256 mismatch')

  const counts = requireObject(manifest.counts, 'manifest.counts')
  const actual = {
    records: records.length,
    verified: records.filter((row) => row.publicState === 'verified').length,
    partial: records.filter((row) => row.publicState === 'partial').length,
    needsMoreResearch: records.filter((row) => row.publicState === 'needs_more_research').length,
    rated: records.filter((row) => row.assessment != null).length,
    unrated: records.filter((row) => row.assessment == null).length,
  }
  for (const [key, value] of Object.entries(actual)) {
    requireCondition(counts[key] === value, `manifest.counts.${key} mismatch: ${counts[key]} != ${value}`)
  }

  const gates = requireObject(manifest.gates, 'manifest.gates')
  const requiredTrue = ['dryRunOnly', 'sourceEvidenceRequired', 'identityReviewExcluded']
  const requiredFalse = [
    'payloadWrite', 'postgresqlWrite', 'automaticPublication', 'humanVerifiedOverwrite',
    'provisionalRatingPublic', 'identitySubstitution', 'titleBasedIdentityMatch',
  ]
  for (const key of requiredTrue) requireCondition(gates[key] === true, `manifest.gates.${key} must be true`)
  for (const key of requiredFalse) requireCondition(gates[key] === false, `manifest.gates.${key} must be false`)

  return actual
}

export function validatePublicReleaseDirectory(inputDirectory) {
  const root = path.resolve(inputDirectory)
  requireCondition(fs.existsSync(root) && fs.statSync(root).isDirectory(), `Input directory does not exist: ${root}`)

  const inventory = listFilesRecursively(root)
  requireCondition(
    inventory.length === REQUIRED_FILES.size && inventory.every((item) => REQUIRED_FILES.has(item)),
    `Closed-world inventory mismatch: ${inventory.join(', ')}`,
  )

  const checksums = readChecksums(path.join(root, 'SHA256SUMS'))
  for (const [relative, expected] of checksums.entries()) {
    const actual = sha256File(path.join(root, relative))
    requireCondition(actual === expected, `SHA-256 mismatch for ${relative}`)
  }

  const manifest = readJson(path.join(root, 'manifest.json'), 'manifest.json')
  const records = readLfJsonl(path.join(root, 'records.jsonl'))
  requireCondition(records.length > 0, 'Public release must contain at least one record')

  const identities = new Set()
  const summaries = records.map((record, index) => {
    const summary = validatePublicRecord(record, index)
    requireCondition(!identities.has(summary.identityKey), `Duplicate identityKey: ${summary.identityKey}`)
    identities.add(summary.identityKey)
    return summary
  })

  const counts = validateManifest(manifest, records, checksums.get('records.jsonl'))
  return {
    schemaVersion: 'radar-public-release-validation-v01',
    releaseId: manifest.releaseId,
    sourceCommitSha: manifest.source.commitSha,
    policyVersion: manifest.source.policyVersion,
    inputDirectory: root,
    inventory,
    counts,
    totalFacts: summaries.reduce((sum, item) => sum + item.factCount, 0),
    totalEvidence: summaries.reduce((sum, item) => sum + item.evidenceCount, 0),
    blockers: [],
    gates: {
      dryRunOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      websiteMutation: false,
      publicationAction: false,
      canImport: false,
    },
    decision: 'accept_public_release_dry_run',
  }
}

export function assertReportPath(output, cwd = process.cwd()) {
  const dataLocalRoot = path.resolve(cwd, 'data_local')
  const resolved = path.resolve(cwd, output)
  requireCondition(
    resolved === dataLocalRoot || resolved.startsWith(`${dataLocalRoot}${path.sep}`),
    `Dry-run report must remain under data_local: ${output}`,
  )
  return resolved
}
