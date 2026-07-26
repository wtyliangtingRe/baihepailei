import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const VERSION = 'radar-research-campaign-v0.1'
export const DEFAULT_TARGET_ROWS = 10_000
export const DEFAULT_WAVE_SIZE = 250
export const DEFAULT_CHUNK_SIZE = 25
export const DEFAULT_WAVE_COUNT = 40
export const DEFAULT_CHUNKS_PER_WAVE = 10
export const DEFAULT_CHUNK_COUNT = 400
export const IMMUTABLE_ROOT_FILE = 'immutable-root-manifest-v01.json'
export const IMMUTABLE_RECEIPT_FILE = 'SHA256SUMS'

export const CAMPAIGN_SAFETY = Object.freeze({
  networkFetch: false,
  payloadRead: false,
  payloadWrite: false,
  directPostgresqlRead: false,
  directPostgresqlWrite: false,
  modifiesWorks: false,
  publishesRatings: false,
  normalReleaseGatePass: false,
  createsProductionApplyPackage: false,
  migrationOrSchemaPush: false,
  syntheticGenuineResponses: false,
  automaticXAllowed: false,
  generatedDataConfinedToDataLocal: true,
  reviewArtifactsWrittenUnderExports: true,
  arbitraryOutputPathsAllowed: false,
  reviewOnly: true,
})

const WRITE_FLAGS = [
  'execute', 'apply', 'write', 'patch', 'confirm', 'publish', 'release',
  'production-apply', 'approval-token', 'migrate', 'schema-push',
]
const FORBIDDEN_ASSESSMENT_FIELDS = new Set([
  'assessmentMode', 'exactGradeSuggestion', 'gradeRange', 'finalGrade',
  'suggestedGrade', 'compatibilityGrade', 'rating',
])

export const val = (value) => String(value ?? '').trim()
export const list = (value) => Array.isArray(value) ? value : []
export const sha256Buffer = (value) => crypto.createHash('sha256').update(value).digest('hex')
export const sha256File = (file) => sha256Buffer(fs.readFileSync(file))
export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
export const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}
export const sameJson = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right))

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
  const rejected = WRITE_FLAGS.filter((key) => args[key] !== undefined)
  if (rejected.length) throw new Error(`Research campaign is review-only; rejected flags: ${rejected.join(', ')}`)
}

export function assertRelative(value, label = 'path') {
  const normalized = val(value).replaceAll('\\', '/').normalize('NFC')
  const parts = normalized.split('/')
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[a-z]:/iu.test(normalized)
    || parts.some((part) => part === '..' || part === '.' || part === '')
    || normalized.includes('\0')
  ) throw new Error(`Unsafe ${label}: ${value}`)
  return normalized
}

export function assertConfined(root, relative, label = 'path') {
  const safe = assertRelative(relative, label)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, safe)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escaped root: ${relative}`)
  }
  return resolved
}

export function assertOutputPath(output, cwd = process.cwd(), kind = 'data_local') {
  const root = path.resolve(cwd, kind)
  const resolved = path.resolve(cwd, output)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Output must remain under ${kind}: ${output}`)
  }
  return resolved
}

export function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!text) return []
  return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`)
    }
  })
}

export function normalizeIdentityPart(value) {
  return val(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
}

export function identityKey(row) {
  const workId = val(row?.workId ?? row?.id)
  const siteId = val(row?.siteId)
  if (!workId || !siteId) throw new Error('Campaign identity requires workId and siteId')
  return `${workId}|${siteId}`
}

export function normalizedIdentityKey(row) {
  const siteId = normalizeIdentityPart(row?.siteId)
  const title = normalizeIdentityPart(row?.title)
  if (!siteId && !title) return ''
  return `${siteId}|${title}`
}

export function compareIds(left, right) {
  const a = val(left)
  const b = val(right)
  if (/^\d+$/u.test(a) && /^\d+$/u.test(b)) {
    const delta = BigInt(a) - BigInt(b)
    return delta < 0n ? -1 : delta > 0n ? 1 : 0
  }
  return a.localeCompare(b)
}

export function compareCampaignRows(left, right) {
  const priority = Number(left?.researchPriority ?? 2) - Number(right?.researchPriority ?? 2)
  return priority || compareIds(left?.workId ?? left?.id, right?.workId ?? right?.id)
    || val(left?.siteId).localeCompare(val(right?.siteId))
    || val(left?.title).localeCompare(val(right?.title))
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function humanVerified(row) {
  return val(row?.humanAssessment?.status) === 'reviewed'
    || val(row?.reviewStatus) === 'reviewed'
    || Boolean(val(row?.humanReviewedAt))
    || Boolean(val(row?.humanReviewedBy))
}

function protectionState(row) {
  const protectedValue = row?.writeProtection?.protected === true
    || list(row?.writeProtection?.reasons).length > 0
    || row?.existingState?.locked === true
  return {
    protected: protectedValue,
    reasons: unique([
      ...list(row?.writeProtection?.reasons).map(val),
      row?.existingState?.locked === true ? 'existing_state_locked' : '',
    ]),
  }
}

function sourceIdentity(sourceRow) {
  return {
    workId: val(sourceRow?.workId ?? sourceRow?.id),
    siteId: val(sourceRow?.siteId),
    title: val(sourceRow?.title),
  }
}

export function buildCoverageLedger({
  canonicalRows,
  coverageSources = [],
  targetRows = DEFAULT_TARGET_ROWS,
}) {
  if (!Array.isArray(canonicalRows)) throw new TypeError('canonicalRows must be an array')
  if (!Number.isInteger(targetRows) || targetRows < 1) throw new Error('targetRows must be a positive integer')

  const coverageByWorkId = new Map()
  const coverageBySiteId = new Map()
  const coveredByPackage = {}
  const warnings = []
  for (const source of coverageSources) {
    const packageId = val(source?.packageId)
    const manifestSource = val(source?.manifestSource)
    if (!packageId || !manifestSource || !Array.isArray(source?.rows)) {
      throw new Error('Coverage sources require packageId, manifestSource, and rows')
    }
    const sourceSeen = new Set()
    for (const row of source.rows) {
      const identity = sourceIdentity(row)
      if (!identity.workId && !identity.siteId) {
        warnings.push(`coverage_source_identity_missing:${packageId}`)
        continue
      }
      const sourceKey = `${identity.workId}|${identity.siteId}`
      if (sourceSeen.has(sourceKey)) continue
      sourceSeen.add(sourceKey)
      const evidence = {
        packageId,
        manifestSource,
        coverageType: val(source.coverageType) || 'accepted_or_completed_workflow',
        workId: identity.workId || null,
        siteId: identity.siteId || null,
      }
      if (identity.workId) {
        const entries = coverageByWorkId.get(identity.workId) || []
        entries.push(evidence)
        coverageByWorkId.set(identity.workId, entries)
      }
      if (identity.siteId) {
        const entries = coverageBySiteId.get(identity.siteId) || []
        entries.push(evidence)
        coverageBySiteId.set(identity.siteId, entries)
      }
      coveredByPackage[packageId] = (coveredByPackage[packageId] || 0) + 1
    }
  }

  const ordered = [...canonicalRows].sort(compareCampaignRows)
  const countValues = (getter) => {
    const counts = new Map()
    for (const row of ordered) {
      const key = getter(row)
      if (key) counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }
  const workIdCounts = countValues((row) => val(row?.workId ?? row?.id))
  const siteIdCounts = countValues((row) => val(row?.siteId))
  const normalizedIdentityCounts = countValues(normalizedIdentityKey)
  const exclusionLedger = []
  const eligibleRows = []
  let protectedExclusions = 0
  let humanVerifiedExclusions = 0
  let duplicateWorkIdExclusions = 0
  let duplicateSiteIdExclusions = 0
  let duplicateNormalizedIdentityExclusions = 0
  let missingIdentityExclusions = 0
  let totalPriorCoveredExclusions = 0
  const uniqueCandidateIdentities = new Set()

  for (const row of ordered) {
    const workId = val(row?.workId ?? row?.id)
    const siteId = val(row?.siteId)
    const title = val(row?.title)
    const normalizedIdentity = normalizedIdentityKey(row)
    const reasons = []
    const priorSources = unique([
      ...(coverageByWorkId.get(workId) || []),
      ...(coverageBySiteId.get(siteId) || []),
    ].map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry))
    const protection = protectionState(row)
    const verified = humanVerified(row)

    if (!workId || !siteId || !title) {
      reasons.push('missing_required_canonical_identity')
      missingIdentityExclusions += 1
    } else uniqueCandidateIdentities.add(`${workId}|${siteId}`)

    if (workId && workIdCounts.get(workId) > 1) {
      reasons.push('duplicate_work_id')
      duplicateWorkIdExclusions += 1
    }
    if (siteId && siteIdCounts.get(siteId) > 1) {
      reasons.push('duplicate_site_id')
      duplicateSiteIdExclusions += 1
    }
    if (normalizedIdentity && normalizedIdentityCounts.get(normalizedIdentity) > 1) {
      reasons.push('duplicate_normalized_identity')
      duplicateNormalizedIdentityExclusions += 1
    }
    if (priorSources.length) {
      reasons.push('prior_accepted_or_completed_coverage')
      totalPriorCoveredExclusions += 1
    }
    if (protection.protected) {
      reasons.push('write_protected')
      protectedExclusions += 1
    }
    if (verified) {
      reasons.push('human_verified')
      humanVerifiedExclusions += 1
    }

    if (reasons.length) {
      exclusionLedger.push(stable({
        workId,
        siteId,
        title,
        exclusionReasons: unique(reasons),
        priorPackageOrManifestSources: priorSources,
        writeProtection: protection,
        humanVerification: {
          verified,
          reviewStatus: val(row?.reviewStatus) || null,
          humanAssessmentStatus: val(row?.humanAssessment?.status) || null,
          humanReviewedAt: val(row?.humanReviewedAt) || null,
          humanReviewedBy: val(row?.humanReviewedBy) || null,
        },
        normalizedIdentity,
      }))
    } else eligibleRows.push(row)
  }

  const selectedSourceRows = eligibleRows.slice(0, targetRows)
  const shortfall = Math.max(0, targetRows - selectedSourceRows.length)
  const blockers = shortfall ? [`eligible_rows_shortfall:${eligibleRows.length}/${targetRows}`] : []
  const counts = stable({
    canonicalRowsScanned: canonicalRows.length,
    uniqueCandidateIdentities: uniqueCandidateIdentities.size,
    totalPriorCoveredExclusions,
    coveredByPackage,
    protectedExclusions,
    humanVerifiedExclusions,
    duplicateWorkIdExclusions,
    duplicateSiteIdExclusions,
    duplicateNormalizedIdentityExclusions,
    missingIdentityExclusions,
    totalUniqueExcludedRows: exclusionLedger.length,
    remainingEligibleRows: eligibleRows.length,
    selectedRows: selectedSourceRows.length,
    targetRows,
    shortfall,
  })
  return {
    exclusionLedger,
    eligibleRows,
    selectedSourceRows,
    counts,
    blockers,
    warnings: unique(warnings),
    canPrepare: blockers.length === 0,
    ordering: {
      algorithm: 'researchPriority ascending, numeric workId ascending, siteId ascending, title ascending',
      implementation: 'compareCampaignRows',
      deterministic: true,
    },
  }
}

export function campaignInputRow(row, ordinal, options = {}) {
  const workId = val(row?.workId ?? row?.id)
  const siteId = val(row?.siteId)
  const title = val(row?.title)
  if (!workId || !siteId || !title) throw new Error(`Selected row lacks canonical identity at ordinal ${ordinal}`)
  const waveSize = Number(options.waveSize ?? DEFAULT_WAVE_SIZE)
  const chunkSize = Number(options.chunkSize ?? DEFAULT_CHUNK_SIZE)
  const waveNumber = Math.floor((ordinal - 1) / waveSize) + 1
  const waveOrdinal = ((ordinal - 1) % waveSize) + 1
  const chunkNumber = Math.floor((waveOrdinal - 1) / chunkSize) + 1
  const chunkOrdinal = ((waveOrdinal - 1) % chunkSize) + 1
  const waveId = `wave-${String(waveNumber).padStart(2, '0')}`
  const chunkId = `${waveId}-chunk-${String(chunkNumber).padStart(2, '0')}`
  return stable({
    campaignId: val(options.packageId),
    campaignOrdinal: ordinal,
    waveId,
    waveOrdinal,
    chunkId,
    chunkOrdinal,
    workId,
    siteId,
    title,
    publicationKey: val(row?.publicationKey) || `work:${workId}`,
    slug: val(row?.slug) || null,
    catalogStatus: val(row?.catalogStatus) || null,
    payloadStatusSnapshot: val(row?.payloadStatus ?? row?._status) || null,
    mediaGroup: val(row?.mediaGroup) || null,
    mediaType: val(row?.mediaType) || null,
    researchPriority: Number(row?.researchPriority ?? 2),
    canonicalProvenance: {
      sourcePackageId: val(options.sourcePackageId),
      sourceManifestSha256: val(options.sourceManifestSha256).toLowerCase(),
      sourceRowIdentity: `${workId}|${siteId}`,
      normalizedIdentity: normalizedIdentityKey(row),
      orderingAlgorithm: 'researchPriority ascending, numeric workId ascending, siteId ascending, title ascending',
    },
    writeProtection: { protected: false, reasons: [] },
    humanVerification: { verified: false },
    researchOnly: true,
    requiresGenuineExternalResearch: true,
    assessmentOutcomesAllowed: false,
    publicationEligible: false,
    releaseEligible: false,
    pageNotice: 'AI 研究输入，待外部事实核验',
  })
}

export function validateSelection(rows, expectedRows = rows.length) {
  if (!Array.isArray(rows) || rows.length !== expectedRows) {
    throw new Error(`Selection row count mismatch: ${rows?.length ?? 'invalid'}/${expectedRows}`)
  }
  const workIds = new Set()
  const siteIds = new Set()
  const normalized = new Set()
  for (const [index, row] of rows.entries()) {
    const workId = val(row?.workId)
    const siteId = val(row?.siteId)
    const normalizedIdentity = normalizedIdentityKey(row)
    if (!workId || !siteId || !val(row?.title)) throw new Error(`Selection identity missing:${index + 1}`)
    if (workIds.has(workId)) throw new Error(`Duplicate selected workId:${workId}`)
    if (siteIds.has(siteId)) throw new Error(`Duplicate selected siteId:${siteId}`)
    if (normalized.has(normalizedIdentity)) throw new Error(`Duplicate selected normalized identity:${normalizedIdentity}`)
    if (row?.writeProtection?.protected === true) throw new Error(`Protected row selected:${workId}`)
    if (row?.humanVerification?.verified === true) throw new Error(`Human-verified row selected:${workId}`)
    if (row?.assessmentOutcomesAllowed !== false) throw new Error(`Assessment outcome gate opened:${workId}`)
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_ASSESSMENT_FIELDS.has(key)) throw new Error(`Assessment field forbidden in research input:${key}:${workId}`)
    }
    workIds.add(workId)
    siteIds.add(siteId)
    normalized.add(normalizedIdentity)
  }
  return true
}

export function researchResponseSchema() {
  const riskFields = [
    'femaleFemaleRelationship', 'maleInvolvement', 'ntrRisk', 'endingStatus',
    'sexualContent', 'sexualParticipants', 'violenceOrHorror', 'ageOrConsentRisk',
    'coercionRisk', 'rawAdultContent', 'ts', 'futa', 'abo',
    'crossdressingOrOtokonoko',
  ]
  return stable({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Radar external factual research response v0.1',
    description: 'Research facts only. Adult content is factual metadata and must not determine a future grade.',
    type: 'object',
    additionalProperties: false,
    required: [
      'workId', 'siteId', 'title', 'identityStatus', 'researchStatus',
      'evidenceCoverage', 'evidenceStatus', 'sourceSummary', 'contentSummary',
      'relationshipSummary', 'endingSummary', 'sources', 'unresolvedQuestions',
      'researchNotes', 'contradictions', 'riskFindings',
    ],
    properties: {
      workId: { type: 'string', minLength: 1 },
      siteId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1 },
      identityStatus: { enum: ['confirmed', 'ambiguous', 'not_found', 'conflicting'] },
      researchStatus: { enum: ['ready_for_ai_assessment', 'needs_more_research', 'identity_review'] },
      evidenceCoverage: { type: 'number', minimum: 0, maximum: 1 },
      evidenceStatus: { type: 'string', minLength: 1 },
      sourceSummary: { type: 'string', minLength: 1 },
      contentSummary: { type: 'string', minLength: 1 },
      relationshipSummary: { type: 'string', minLength: 1 },
      endingSummary: { type: 'string', minLength: 1 },
      sources: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['label', 'url', 'sourceType', 'supports'],
          properties: {
            label: { type: 'string', minLength: 1 },
            url: { type: 'string', minLength: 1 },
            sourceType: { enum: ['official', 'primary', 'secondary', 'community'] },
            supports: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      unresolvedQuestions: { type: 'array', items: { type: 'string' } },
      researchNotes: { type: 'array', minItems: 1, items: { type: 'string' } },
      contradictions: { type: 'array', items: { type: 'string' } },
      riskFindings: {
        type: 'object',
        additionalProperties: false,
        required: riskFields,
        properties: Object.fromEntries(riskFields.map((key) => [
          key,
          ['ts', 'futa', 'abo', 'crossdressingOrOtokonoko'].includes(key)
            ? { type: 'boolean' }
            : key === 'rawAdultContent'
              ? { type: 'object' }
              : { type: 'string', minLength: 1 },
        ])),
      },
    },
    forbiddenAssessmentFields: [...FORBIDDEN_ASSESSMENT_FIELDS].sort(),
  })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, jsonl(rows), 'utf8')
}

export function filesUnder(root) {
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden in campaign package: ${absolute}`)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll('\\', '/'))
      else throw new Error(`Non-regular entry forbidden in campaign package: ${absolute}`)
    }
  }
  walk(root)
  return files.sort()
}

function fileReceipt(root, relative) {
  const absolute = assertConfined(root, relative, 'receipt entry')
  const stat = fs.statSync(absolute)
  if (!stat.isFile()) throw new Error(`Receipt entry is not a regular file: ${relative}`)
  return { file: relative, bytes: stat.size, sha256: sha256File(absolute) }
}

export function writeImmutableRootReceipt(root, immutableFiles, evidence = {}) {
  const uniqueFiles = [...new Set(immutableFiles.map((file) => assertRelative(file, 'immutable root entry')))].sort()
  const rootManifest = stable({
    version: VERSION,
    receiptVersion: 1,
    excludesExternalResponseFiles: true,
    preparedZipOuterSha256: evidence.preparedZipOuterSha256 || null,
    files: uniqueFiles.map((file) => fileReceipt(root, file)),
  })
  writeJson(path.join(root, IMMUTABLE_ROOT_FILE), rootManifest)
  const rootSha256 = sha256File(path.join(root, IMMUTABLE_ROOT_FILE))
  const receiptLines = [
    `${rootSha256}  ${IMMUTABLE_ROOT_FILE}`,
    ...rootManifest.files.map((entry) => `${entry.sha256}  ${entry.file}`),
  ]
  fs.writeFileSync(path.join(root, IMMUTABLE_RECEIPT_FILE), `${receiptLines.join('\n')}\n`, 'utf8')
  return { rootManifest, rootSha256 }
}

export function verifyImmutableRootReceipt(root) {
  const receiptFile = path.join(root, IMMUTABLE_RECEIPT_FILE)
  const rootFile = path.join(root, IMMUTABLE_ROOT_FILE)
  if (!fs.existsSync(receiptFile) || !fs.existsSync(rootFile)) throw new Error('Immutable campaign receipt missing')
  const lines = fs.readFileSync(receiptFile, 'utf8').trim().split(/\r?\n/u).filter(Boolean)
  if (!lines.length) throw new Error('SHA256SUMS immutable-root receipt is empty')
  const match = /^([0-9a-f]{64})  (.+)$/iu.exec(lines[0])
  if (!match || assertRelative(match[2], 'immutable receipt entry') !== IMMUTABLE_ROOT_FILE) {
    throw new Error('Invalid immutable campaign receipt')
  }
  if (sha256File(rootFile) !== match[1].toLowerCase()) throw new Error('Immutable root manifest SHA-256 mismatch')
  const manifest = JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  if (
    manifest.version !== VERSION
    || manifest.excludesExternalResponseFiles !== true
    || !Array.isArray(manifest.files)
  ) throw new Error('Invalid immutable root manifest')
  const seen = new Set()
  for (const entry of manifest.files) {
    const relative = assertRelative(entry?.file, 'immutable root entry')
    if (seen.has(relative)) throw new Error(`Duplicate immutable root entry:${relative}`)
    seen.add(relative)
    const absolute = assertConfined(root, relative, 'immutable root entry')
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`Immutable root file missing:${relative}`)
    }
    if (fs.statSync(absolute).size !== Number(entry.bytes) || sha256File(absolute) !== val(entry.sha256)) {
      throw new Error(`Immutable root file mismatch:${relative}`)
    }
  }
  const supplemental = new Map()
  for (const line of lines.slice(1)) {
    const item = /^([0-9a-f]{64})  (.+)$/iu.exec(line)
    if (!item) throw new Error(`Invalid SHA256SUMS entry:${line}`)
    const relative = assertRelative(item[2], 'SHA256SUMS entry')
    if (supplemental.has(relative)) throw new Error(`Duplicate SHA256SUMS entry:${relative}`)
    supplemental.set(relative, item[1].toLowerCase())
  }
  if (supplemental.size !== manifest.files.length) throw new Error('SHA256SUMS immutable inventory is incomplete')
  for (const entry of manifest.files) {
    if (supplemental.get(entry.file) !== entry.sha256) throw new Error(`SHA256SUMS immutable entry mismatch:${entry.file}`)
  }
  for (const required of ['package-manifest.json', 'selection/selected-rows-v01.jsonl', 'ledgers/exclusion-ledger-v01.jsonl']) {
    if (!seen.has(required)) throw new Error(`Immutable root does not anchor ${required}`)
  }
  return { manifest, rootSha256: match[1].toLowerCase(), files: seen }
}

function identityReceipt(rows, ordinalOffset = 0) {
  return rows.map((row, index) => ({
    ordinal: ordinalOffset + index + 1,
    workId: val(row.workId),
    siteId: val(row.siteId),
    title: val(row.title),
  }))
}

function campaignInstructions(structure) {
  return `# Radar external research campaign

This is a review-only factual research input package. Upload the single ZIP; its internal Waves can be recovered independently.

- ${structure.targetRows} immutable input rows
- ${structure.waveCount} ordered Waves of ${structure.waveSize} rows
- ${structure.chunksPerWave} chunks per Wave, ${structure.chunkSize} rows per chunk
- ${structure.chunkCount} external response slots

Write genuine research responses only into the declared response files. Do not change input, manifest, schema, instruction, ledger, or receipt files. Do not add files.

Keep identity, relationship, ending, adult-content, participant, violence/horror, consent, coercion, TS, futa, ABO, crossdressing/otokonoko, NTR, and male-involvement findings factual and separate. Adult content must not automatically reduce a future grade.

Do not supply grades, ranges, labels-only assessment outcomes, ratings, publication decisions, or synthetic research.

The root campaign remains incomplete until all Waves contain structurally valid genuine responses. A Wave can be assembled independently; a blocker in one Wave must not suppress another valid Wave.
`
}

function qaMarkdown(summary) {
  const counts = summary.coverage
  return `# Campaign QA report

- Canonical rows scanned: ${counts.canonicalRowsScanned}
- Unique candidate identities: ${counts.uniqueCandidateIdentities}
- Prior-covered exclusions: ${counts.totalPriorCoveredExclusions}
- Protected exclusions: ${counts.protectedExclusions}
- Human-verified exclusions: ${counts.humanVerifiedExclusions}
- Duplicate work ID exclusions: ${counts.duplicateWorkIdExclusions}
- Duplicate site ID exclusions: ${counts.duplicateSiteIdExclusions}
- Duplicate normalized identity exclusions: ${counts.duplicateNormalizedIdentityExclusions}
- Missing identity exclusions: ${counts.missingIdentityExclusions}
- Remaining eligible rows: ${counts.remainingEligibleRows}
- Selected rows: ${counts.selectedRows}
- Waves: ${summary.structure.waveCount} × ${summary.structure.waveSize}
- Chunks: ${summary.structure.chunkCount} × ${summary.structure.chunkSize}
- Empty external response slots: ${summary.structure.emptyResponseSlots}
- Identity/order mismatches: 0
- Prior-coverage overlaps selected: 0
- Protected or human-verified selected rows: 0
- Structural blockers: ${summary.structuralBlockers.length}

This package is research-only, review-only, publication-ineligible, and contains no genuine or synthetic research response.
`
}

export function writeShortfallOutputs(outputDir, coverage, metadata = {}) {
  fs.mkdirSync(outputDir, { recursive: true })
  writeJsonl(path.join(outputDir, 'ledgers/exclusion-ledger-v01.jsonl'), coverage.exclusionLedger)
  writeJson(path.join(outputDir, 'coverage-summary-v01.json'), {
    version: VERSION,
    packagePrepared: false,
    packageId: val(metadata.packageId),
    coverage: coverage.counts,
    ordering: coverage.ordering,
    structuralBlockers: coverage.blockers,
    warnings: coverage.warnings,
    safety: CAMPAIGN_SAFETY,
  })
  fs.writeFileSync(
    path.join(outputDir, 'SHORTFALL.md'),
    `# Campaign shortfall\n\nEligible rows: ${coverage.counts.remainingEligibleRows}\nTarget rows: ${coverage.counts.targetRows}\nNo campaign package was created; no padding, duplication, or fabrication was used.\n`,
    'utf8',
  )
  return { packagePrepared: false, blockers: coverage.blockers, counts: coverage.counts }
}

export function writeCampaignPackage(outputDir, coverage, metadata = {}) {
  if (!coverage?.canPrepare) throw new Error(`Campaign cannot be prepared: ${list(coverage?.blockers).join(', ')}`)
  const targetRows = Number(metadata.targetRows ?? DEFAULT_TARGET_ROWS)
  const waveSize = Number(metadata.waveSize ?? DEFAULT_WAVE_SIZE)
  const chunkSize = Number(metadata.chunkSize ?? DEFAULT_CHUNK_SIZE)
  if (targetRows % waveSize !== 0 || waveSize % chunkSize !== 0) {
    throw new Error('Campaign target/wave/chunk sizes must divide exactly')
  }
  const waveCount = targetRows / waveSize
  const chunksPerWave = waveSize / chunkSize
  const chunkCount = waveCount * chunksPerWave
  const packageId = val(metadata.packageId)
  if (!packageId) throw new Error('packageId is required')
  const selectedRows = coverage.selectedSourceRows.map((row, index) => campaignInputRow(row, index + 1, {
    packageId,
    waveSize,
    chunkSize,
    sourcePackageId: metadata.sourcePackageId,
    sourceManifestSha256: metadata.sourceManifestSha256,
  }))
  validateSelection(selectedRows, targetRows)

  fs.mkdirSync(outputDir, { recursive: true })
  const structure = {
    targetRows,
    waveCount,
    waveSize,
    chunksPerWave,
    chunkSize,
    chunkCount,
    emptyResponseSlots: chunkCount,
  }
  writeJsonl(path.join(outputDir, 'ledgers/exclusion-ledger-v01.jsonl'), coverage.exclusionLedger)
  writeJson(path.join(outputDir, 'ledgers/coverage-summary-v01.json'), {
    version: VERSION,
    counts: coverage.counts,
    ordering: coverage.ordering,
    blockers: coverage.blockers,
    warnings: coverage.warnings,
  })
  writeJsonl(path.join(outputDir, 'selection/selected-rows-v01.jsonl'), selectedRows)
  writeJson(path.join(outputDir, 'selection/selection-summary-v01.json'), {
    version: VERSION,
    packageId,
    selectedRows: targetRows,
    firstIdentity: identityReceipt(selectedRows.slice(0, 1))[0],
    lastIdentity: identityReceipt(selectedRows.slice(-1), selectedRows.length - 1)[0],
    selectedRowsSha256: sha256Buffer(Buffer.from(jsonl(selectedRows))),
    identityOrderReceiptSha256: sha256Buffer(Buffer.from(JSON.stringify(identityReceipt(selectedRows)))),
    overlapWithPriorCoverage: 0,
    protectedSelectedRows: 0,
    humanVerifiedSelectedRows: 0,
    ordering: coverage.ordering,
  })
  writeJsonl(path.join(outputDir, 'aggregate/immutable-input-v01.jsonl'), selectedRows)
  writeJson(path.join(outputDir, 'schema/research-response-schema-v01.json'), researchResponseSchema())
  fs.mkdirSync(path.join(outputDir, 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'instructions/RESEARCH_INSTRUCTIONS.md'), campaignInstructions(structure), 'utf8')
  writeJson(path.join(outputDir, 'acceptance/campaign-acceptance-v01.json'), {
    version: VERSION,
    packageId,
    structure,
    source: {
      packageId: val(metadata.sourcePackageId),
      manifestSha256: val(metadata.sourceManifestSha256).toLowerCase(),
      acceptedSourceBinding: metadata.acceptedSourceBinding || null,
    },
    expectedStatus: {
      completedWaveCount: 0,
      incompleteWaveCount: waveCount,
      invalidWaveCount: 0,
      aggregateComplete: false,
      genuineResponseRows: 0,
    },
    safety: CAMPAIGN_SAFETY,
  })

  const waveManifests = []
  const responsePaths = []
  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const waveId = `wave-${String(waveIndex + 1).padStart(2, '0')}`
    const waveRoot = path.join(outputDir, 'waves', waveId)
    const waveRows = selectedRows.slice(waveIndex * waveSize, (waveIndex + 1) * waveSize)
    const waveInputRelative = `waves/${waveId}/immutable-input-v01.jsonl`
    writeJsonl(path.join(outputDir, waveInputRelative), waveRows)
    const chunks = []
    for (let chunkIndex = 0; chunkIndex < chunksPerWave; chunkIndex += 1) {
      const chunkId = `${waveId}-chunk-${String(chunkIndex + 1).padStart(2, '0')}`
      const chunkRows = waveRows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)
      const inputRelative = `waves/${waveId}/chunks/${chunkId}.input.jsonl`
      const responseRelative = `waves/${waveId}/responses/${chunkId}.response.jsonl`
      writeJsonl(path.join(outputDir, inputRelative), chunkRows)
      fs.mkdirSync(path.dirname(path.join(outputDir, responseRelative)), { recursive: true })
      fs.writeFileSync(path.join(outputDir, responseRelative), '', 'utf8')
      responsePaths.push(responseRelative)
      chunks.push({
        chunkId,
        ordinal: chunkIndex + 1,
        rowCount: chunkRows.length,
        inputFile: inputRelative,
        inputBytes: fs.statSync(path.join(outputDir, inputRelative)).size,
        inputSha256: sha256File(path.join(outputDir, inputRelative)),
        responseFile: responseRelative,
        responseInitiallyEmpty: true,
        expectedIdentityOrder: identityReceipt(chunkRows),
      })
    }
    const waveManifestRelative = `waves/${waveId}/wave-manifest-v01.json`
    const waveManifest = {
      version: VERSION,
      packageId,
      waveId,
      ordinal: waveIndex + 1,
      rowCount: waveRows.length,
      chunkCount: chunks.length,
      immutableInput: {
        file: waveInputRelative,
        bytes: fs.statSync(path.join(outputDir, waveInputRelative)).size,
        sha256: sha256File(path.join(outputDir, waveInputRelative)),
      },
      expectedIdentityOrder: identityReceipt(waveRows),
      chunks,
      independentlyRecoverable: true,
      independentlyAssemblable: true,
      structuralInputValid: true,
      assemblyStatus: 'incomplete_waiting_for_genuine_responses',
      genuineResponseRows: 0,
      aggregateCompletionRequired: false,
    }
    writeJson(path.join(outputDir, waveManifestRelative), waveManifest)
    waveManifests.push({
      waveId,
      rowCount: waveRows.length,
      chunkCount: chunks.length,
      manifestFile: waveManifestRelative,
      manifestSha256: sha256File(path.join(outputDir, waveManifestRelative)),
      independentlyRecoverable: true,
      status: 'incomplete',
    })
  }

  const aggregateSummary = {
    version: VERSION,
    packageId,
    packagePrepared: true,
    aggregateComplete: false,
    completedWaveCount: 0,
    incompleteWaveCount: waveCount,
    invalidWaveCount: 0,
    inputRows: targetRows,
    genuineResponseRows: 0,
    identityOrderMismatches: 0,
    overlapMismatches: 0,
    checksumMismatches: 0,
    inventoryMismatches: 0,
    automaticXGrades: 0,
    structuralBlockers: [],
    warnings: [],
    structure,
    coverage: coverage.counts,
    safety: CAMPAIGN_SAFETY,
  }
  writeJson(path.join(outputDir, 'aggregate/campaign-summary-v01.json'), aggregateSummary)
  fs.mkdirSync(path.join(outputDir, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'reports/QA-REPORT.md'), qaMarkdown(aggregateSummary), 'utf8')
  writeJson(path.join(outputDir, 'initial-inventory-sha256-v01.json'), {
    version: VERSION,
    note: 'External response hashes describe the prepared empty slots only; response files are excluded from the immutable root so genuine responses can be supplied later.',
    emptyExternalResponses: responsePaths.map((file) => fileReceipt(outputDir, file)),
  })

  const beforeManifest = filesUnder(outputDir)
  const closedWorldInventory = [...beforeManifest, 'package-manifest.json', IMMUTABLE_ROOT_FILE, IMMUTABLE_RECEIPT_FILE].sort()
  const packageManifest = {
    version: VERSION,
    packageId,
    purpose: 'user-facing recoverable factual research campaign input',
    reviewOnly: true,
    aggregateComplete: false,
    structure,
    coverage: coverage.counts,
    selection: {
      file: 'selection/selected-rows-v01.jsonl',
      rowCount: targetRows,
      sha256: sha256File(path.join(outputDir, 'selection/selected-rows-v01.jsonl')),
    },
    waves: waveManifests,
    externalResponseInventory: responsePaths,
    closedWorldInventory,
    integrity: {
      immutableRootManifest: IMMUTABLE_ROOT_FILE,
      immutableReceipt: IMMUTABLE_RECEIPT_FILE,
      mutableExternalResponsesExcludedFromImmutableRoot: true,
      packageManifestIsNotItsOwnIntegrityRoot: true,
    },
    status: {
      completedWaveCount: 0,
      incompleteWaveCount: waveCount,
      invalidWaveCount: 0,
      genuineResponseRows: 0,
      blockers: [],
      warnings: [],
    },
    safety: CAMPAIGN_SAFETY,
  }
  writeJson(path.join(outputDir, 'package-manifest.json'), packageManifest)

  const immutableFiles = filesUnder(outputDir).filter((file) => (
    file !== IMMUTABLE_ROOT_FILE
    && file !== IMMUTABLE_RECEIPT_FILE
    && !responsePaths.includes(file)
  ))
  const receipt = writeImmutableRootReceipt(outputDir, immutableFiles)
  const verification = validateCampaignDirectory(outputDir, { expectedTargetRows: targetRows })
  return {
    packagePrepared: true,
    packageManifest,
    aggregateSummary,
    rootSha256: receipt.rootSha256,
    verification,
  }
}

function verifyIdentityOrder(rows, receipt, label) {
  if (!Array.isArray(receipt) || rows.length !== receipt.length) throw new Error(`${label} identity receipt row count mismatch`)
  let mismatches = 0
  for (let index = 0; index < rows.length; index += 1) {
    const expected = receipt[index]
    const row = rows[index]
    if (
      Number(expected.ordinal) !== index + 1
      || val(expected.workId) !== val(row.workId)
      || val(expected.siteId) !== val(row.siteId)
      || val(expected.title) !== val(row.title)
    ) mismatches += 1
  }
  return mismatches
}

export function auditCampaignWave(root, waveId, options = {}) {
  const blockers = []
  let identityOrderMismatches = 0
  let inputRows = 0
  let chunkRows = 0
  let emptyResponseSlots = 0
  try {
    const relativeManifest = `waves/${waveId}/wave-manifest-v01.json`
    const manifest = JSON.parse(fs.readFileSync(assertConfined(root, relativeManifest), 'utf8'))
    const waveRows = readJsonl(assertConfined(root, manifest.immutableInput.file))
    inputRows = waveRows.length
    if (sha256File(assertConfined(root, manifest.immutableInput.file)) !== val(manifest.immutableInput.sha256)) {
      blockers.push('wave_input_hash_mismatch')
    }
    if (fs.statSync(assertConfined(root, manifest.immutableInput.file)).size !== Number(manifest.immutableInput.bytes)) {
      blockers.push('wave_input_bytes_mismatch')
    }
    identityOrderMismatches += verifyIdentityOrder(waveRows, manifest.expectedIdentityOrder, `${waveId} Wave`)
    const assembledChunks = []
    for (const chunk of list(manifest.chunks)) {
      const rows = readJsonl(assertConfined(root, chunk.inputFile))
      if (
        rows.length !== Number(chunk.rowCount)
        || fs.statSync(assertConfined(root, chunk.inputFile)).size !== Number(chunk.inputBytes)
        || sha256File(assertConfined(root, chunk.inputFile)) !== val(chunk.inputSha256)
      ) blockers.push(`chunk_input_mismatch:${chunk.chunkId}`)
      identityOrderMismatches += verifyIdentityOrder(rows, chunk.expectedIdentityOrder, `${chunk.chunkId} chunk`)
      assembledChunks.push(...rows)
      const responseFile = assertConfined(root, chunk.responseFile)
      if (!fs.existsSync(responseFile) || !fs.statSync(responseFile).isFile()) {
        blockers.push(`response_slot_missing:${chunk.chunkId}`)
      } else if (options.expectEmptyResponses !== false) {
        if (fs.statSync(responseFile).size !== 0 || readJsonl(responseFile).length !== 0) {
          blockers.push(`response_slot_not_empty:${chunk.chunkId}`)
        } else emptyResponseSlots += 1
      }
    }
    chunkRows = assembledChunks.length
    if (!sameJson(waveRows, assembledChunks)) blockers.push('wave_chunk_identity_order_mismatch')
    if (Number(manifest.rowCount) !== waveRows.length) blockers.push('wave_row_count_mismatch')
    if (Number(manifest.chunkCount) !== list(manifest.chunks).length) blockers.push('wave_chunk_count_mismatch')
    if (
      manifest.independentlyRecoverable !== true
      || manifest.independentlyAssemblable !== true
      || manifest.structuralInputValid !== true
    ) blockers.push('wave_independence_contract_invalid')
    if (manifest.assemblyStatus !== 'incomplete_waiting_for_genuine_responses' || Number(manifest.genuineResponseRows) !== 0) {
      blockers.push('wave_initial_status_invalid')
    }
  } catch (error) {
    blockers.push(`wave_validation_error:${error.message}`)
  }
  if (identityOrderMismatches) blockers.push(`identity_order_mismatches:${identityOrderMismatches}`)
  return {
    waveId,
    valid: blockers.length === 0,
    status: blockers.length ? 'invalid' : 'incomplete',
    inputRows,
    chunkRows,
    emptyResponseSlots,
    identityOrderMismatches,
    blockers,
  }
}

export function validateCampaignDirectory(root, options = {}) {
  const receipt = verifyImmutableRootReceipt(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package-manifest.json'), 'utf8'))
  if (manifest.version !== VERSION || manifest.reviewOnly !== true || manifest.aggregateComplete !== false) {
    throw new Error('Invalid campaign package manifest')
  }
  const expectedInventory = new Set(list(manifest.closedWorldInventory).map((file) => assertRelative(file, 'closed-world entry')))
  const actualInventory = new Set(filesUnder(root))
  const missing = [...expectedInventory].filter((file) => !actualInventory.has(file))
  const extra = [...actualInventory].filter((file) => !expectedInventory.has(file))
  if (missing.length || extra.length) {
    throw new Error(`Closed-world inventory mismatch: missing=${missing.join(',') || '0'} extra=${extra.join(',') || '0'}`)
  }
  const responsePaths = list(manifest.externalResponseInventory).map((file) => assertRelative(file, 'external response entry'))
  const responseSet = new Set(responsePaths)
  if (responseSet.size !== responsePaths.length) throw new Error('Duplicate external response declaration')
  for (const file of responsePaths) {
    if (receipt.files.has(file)) throw new Error(`External response incorrectly anchored as immutable:${file}`)
  }
  for (const file of actualInventory) {
    if (file.includes('/responses/') && !responseSet.has(file)) throw new Error(`Unlisted response file:${file}`)
  }

  const selectedRows = readJsonl(path.join(root, 'selection/selected-rows-v01.jsonl'))
  const targetRows = Number(options.expectedTargetRows ?? manifest.structure?.targetRows)
  validateSelection(selectedRows, targetRows)
  const aggregateRows = readJsonl(path.join(root, 'aggregate/immutable-input-v01.jsonl'))
  if (!sameJson(selectedRows, aggregateRows)) throw new Error('Selection/aggregate identity-order mismatch')
  const exclusionRows = readJsonl(path.join(root, 'ledgers/exclusion-ledger-v01.jsonl'))
  const excludedWorkIds = new Set(exclusionRows.map((row) => val(row.workId)).filter(Boolean))
  const excludedSiteIds = new Set(exclusionRows.map((row) => val(row.siteId)).filter(Boolean))
  const overlapMismatches = selectedRows.filter((row) => excludedWorkIds.has(val(row.workId)) || excludedSiteIds.has(val(row.siteId))).length
  if (overlapMismatches) throw new Error(`Selected rows overlap exclusion ledger:${overlapMismatches}`)
  if (sha256File(path.join(root, 'selection/selected-rows-v01.jsonl')) !== val(manifest.selection?.sha256)) {
    throw new Error('Selection SHA-256 mismatch')
  }

  const waveAudits = list(manifest.waves).map((wave) => {
    const manifestFile = assertConfined(root, wave.manifestFile, 'Wave manifest entry')
    if (sha256File(manifestFile) !== val(wave.manifestSha256)) throw new Error(`Package/Wave manifest SHA-256 mismatch:${wave.waveId}`)
    return auditCampaignWave(root, val(wave.waveId), options)
  })
  const invalidWaveCount = waveAudits.filter((wave) => !wave.valid).length
  const incompleteWaveCount = waveAudits.filter((wave) => wave.status === 'incomplete').length
  const waveRows = list(manifest.waves).flatMap((wave) => readJsonl(assertConfined(root, `waves/${val(wave.waveId)}/immutable-input-v01.jsonl`)))
  let identityOrderMismatches = Math.abs(selectedRows.length - waveRows.length)
  for (let index = 0; index < Math.min(selectedRows.length, waveRows.length); index += 1) {
    if (
      val(selectedRows[index].workId) !== val(waveRows[index].workId)
      || val(selectedRows[index].siteId) !== val(waveRows[index].siteId)
      || val(selectedRows[index].title) !== val(waveRows[index].title)
    ) identityOrderMismatches += 1
  }
  if (invalidWaveCount || identityOrderMismatches) {
    throw new Error(`Campaign Wave validation failed: invalid=${invalidWaveCount} identityOrder=${identityOrderMismatches}`)
  }
  if (
    waveAudits.length !== Number(manifest.structure.waveCount)
    || selectedRows.length !== Number(manifest.structure.targetRows)
    || responsePaths.length !== Number(manifest.structure.chunkCount)
    || waveAudits.some((wave) => wave.inputRows !== Number(manifest.structure.waveSize))
    || waveAudits.some((wave) => wave.chunkRows !== Number(manifest.structure.waveSize))
    || waveAudits.some((wave) => wave.emptyResponseSlots !== Number(manifest.structure.chunksPerWave))
  ) throw new Error('Campaign structure mismatch')

  const aggregateSummary = JSON.parse(fs.readFileSync(path.join(root, 'aggregate/campaign-summary-v01.json'), 'utf8'))
  if (
    aggregateSummary.packagePrepared !== true
    || aggregateSummary.aggregateComplete !== false
    || Number(aggregateSummary.completedWaveCount) !== 0
    || Number(aggregateSummary.incompleteWaveCount) !== waveAudits.length
    || Number(aggregateSummary.invalidWaveCount) !== 0
    || Number(aggregateSummary.genuineResponseRows) !== 0
    || list(aggregateSummary.structuralBlockers).length
    || aggregateSummary.safety?.reviewOnly !== true
  ) throw new Error('Campaign aggregate initial status mismatch')

  return {
    valid: true,
    selectedRows: selectedRows.length,
    waveCount: waveAudits.length,
    completedWaveCount: 0,
    incompleteWaveCount,
    invalidWaveCount,
    chunkCount: responsePaths.length,
    chunkSize: Number(manifest.structure.chunkSize),
    emptyResponseSlotCount: responsePaths.length,
    genuineResponseRows: 0,
    identityOrderMismatches,
    overlapMismatches,
    checksumMismatches: 0,
    inventoryMismatches: 0,
    blockers: [],
    warnings: [],
    immutableRootSha256: receipt.rootSha256,
    waveAudits,
    safety: CAMPAIGN_SAFETY,
  }
}

function normalizedArchivePath(value) {
  return assertRelative(value.replace(/\/$/u, ''), 'ZIP entry')
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
}

export function archiveInventory(zipFile) {
  const buffer = fs.readFileSync(zipFile)
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory missing')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const exact = new Set()
  const normalized = new Set()
  const files = new Set()
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central-directory entry')
    const flags = buffer.readUInt16LE(offset + 8)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const external = buffer.readUInt32LE(offset + 38)
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'utf8')
    const isDirectoryName = /[\\/]$/u.test(rawName)
    const withoutTrailing = rawName.replace(/[\\/]+$/u, '')
    const safe = assertRelative(withoutTrailing, 'ZIP entry')
    const normalizedPath = normalizedArchivePath(withoutTrailing)
    const unixMode = (external >>> 16) & 0xffff
    const fileType = unixMode & 0xf000
    if (fileType === 0xa000) throw new Error(`ZIP symlink entry forbidden:${safe}`)
    if (fileType && fileType !== 0x8000 && fileType !== 0x4000) {
      throw new Error(`ZIP non-regular entry forbidden:${safe}`)
    }
    const isDirectory = isDirectoryName || fileType === 0x4000
    if (!isDirectory && fileType === 0x4000) throw new Error(`ZIP directory ambiguity:${safe}`)
    if (exact.has(safe)) throw new Error(`Duplicate ZIP entry:${safe}`)
    if (normalized.has(normalizedPath)) throw new Error(`Duplicate normalized or case-colliding ZIP entry:${safe}`)
    exact.add(safe)
    normalized.add(normalizedPath)
    if (!isDirectory) files.add(safe)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

export function validateCampaignZip(zipFile, stagingRoot, options = {}) {
  const expectedSha256 = val(options.expectedSha256)
  if (expectedSha256 && sha256File(zipFile).toUpperCase() !== expectedSha256.toUpperCase()) {
    throw new Error('Campaign ZIP outer SHA-256 mismatch')
  }
  const inventory = archiveInventory(zipFile)
  const staging = assertOutputPath(stagingRoot, options.cwd ?? process.cwd(), 'data_local')
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  execFileSync('tar', ['-xf', path.resolve(zipFile), '-C', staging])
  const actual = new Set(filesUnder(staging))
  const absentFromArchive = [...actual].filter((file) => !inventory.has(file))
  const absentAfterExtraction = [...inventory].filter((file) => !actual.has(file))
  if (absentFromArchive.length || absentAfterExtraction.length) {
    throw new Error(`ZIP/extraction inventory mismatch: archiveMissing=${absentFromArchive.join(',') || '0'} extractionMissing=${absentAfterExtraction.join(',') || '0'}`)
  }
  return {
    ...validateCampaignDirectory(staging, options),
    zipPath: path.resolve(zipFile),
    zipSha256: sha256File(zipFile),
    archiveFileCount: inventory.size,
    extractedUnderDataLocal: true,
  }
}

function verifyManifestEntries(root, manifestFile, requiredFiles = []) {
  const manifestPath = path.join(root, manifestFile)
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(entries)) throw new Error(`Manifest must be an array:${manifestPath}`)
  const map = new Map()
  for (const entry of entries) {
    const relative = assertRelative(entry?.file, 'accepted manifest entry')
    if (map.has(relative)) throw new Error(`Duplicate accepted manifest entry:${relative}`)
    map.set(relative, entry)
    const absolute = assertConfined(root, relative, 'accepted manifest entry')
    if (
      !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()
      || fs.statSync(absolute).size !== Number(entry.bytes)
      || sha256File(absolute) !== val(entry.sha256).toLowerCase()
    ) throw new Error(`Accepted manifest mismatch:${relative}`)
  }
  for (const relative of requiredFiles) if (!map.has(relative)) throw new Error(`Accepted manifest missing required file:${relative}`)
  return map
}

function verifySha256SumsEntry(root, relative) {
  const lines = fs.readFileSync(path.join(root, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/u)
  const match = lines.map((line) => /^([0-9a-f]{64})  (.+)$/iu.exec(line)).find((item) => item && item[2].replaceAll('\\', '/') === relative)
  if (!match) throw new Error(`SHA256SUMS does not list accepted coverage:${relative}`)
  const absolute = assertConfined(root, relative)
  if (sha256File(absolute) !== match[1].toLowerCase()) throw new Error(`Accepted coverage checksum mismatch:${relative}`)
}

export function loadAcceptedCampaignSources(cwd, binding) {
  const sourceDir = path.resolve(cwd, binding.inventory.sourceDirectory)
  const reviewDir = path.resolve(cwd, binding.inventory.reviewDirectory)
  for (const [fileKey, shaKey] of [['sourceBundle', 'sourceBundleSha256'], ['reviewBundle', 'reviewBundleSha256']]) {
    const bundle = path.resolve(cwd, binding.inventory[fileKey])
    if (!fs.existsSync(bundle) || sha256File(bundle).toUpperCase() !== val(binding.inventory[shaKey]).toUpperCase()) {
      throw new Error(`Accepted canonical inventory ${fileKey} outer SHA-256 mismatch`)
    }
  }
  if (sha256File(path.join(sourceDir, 'manifest.json')).toUpperCase() !== val(binding.inventory.sourceManifestSha256).toUpperCase()) {
    throw new Error('Canonical inventory source manifest binding mismatch')
  }
  if (sha256File(path.join(reviewDir, 'review-manifest.json')).toUpperCase() !== val(binding.inventory.reviewManifestSha256).toUpperCase()) {
    throw new Error('Canonical inventory review manifest binding mismatch')
  }
  verifyManifestEntries(sourceDir, 'manifest.json', [
    'snapshots/works-published.json',
    'already-current.jsonl',
    'missing-current.jsonl',
    'research-batch-0001.jsonl',
  ])
  verifyManifestEntries(reviewDir, 'review-manifest.json', [
    'already-current.jsonl',
    'missing-current.jsonl',
    'research-batch-0001.jsonl',
  ])
  const summary = JSON.parse(fs.readFileSync(path.join(reviewDir, 'inventory-summary.json'), 'utf8'))
  const audit = JSON.parse(fs.readFileSync(path.join(reviewDir, 'independent-audit.json'), 'utf8'))
  if (
    summary.readyForResearchPackaging !== true
    || list(summary.globalBlockers).length
    || audit.checks?.researchBatchDeterministicOrder !== true
    || audit.checks?.wavesMatchResearchBatchExactly !== true
    || audit.checks?.waveHashesAccepted !== true
  ) throw new Error('Accepted canonical inventory audit is not complete')

  const published = JSON.parse(fs.readFileSync(path.join(sourceDir, 'snapshots/works-published.json'), 'utf8'))
  const canonicalRows = published.filter((row) => val(row?.catalogStatus) === 'active')
  if (canonicalRows.length !== Number(summary.counts?.canonicalWorks)) throw new Error('Canonical active row count mismatch')
  const alreadyCurrent = readJsonl(path.join(reviewDir, 'already-current.jsonl'))
  const earlierCampaign = readJsonl(path.join(reviewDir, 'research-batch-0001.jsonl'))
  if (earlierCampaign.length !== Number(binding.earlierCampaign.rowCount)) throw new Error('Earlier campaign row count mismatch')

  const currentByPackage = new Map()
  for (const row of alreadyCurrent) {
    const packageId = val(row?.currentPublicConclusion?.sourcePackageId) || 'accepted_current_public_conclusion_unspecified'
    const rows = currentByPackage.get(packageId) || []
    rows.push(row)
    currentByPackage.set(packageId, rows)
  }
  const coverageSources = [...currentByPackage].map(([packageId, rows]) => ({
    packageId,
    manifestSource: `${binding.inventory.reviewDirectory}/already-current.jsonl#currentPublicConclusion.sourcePackageId=${packageId}`,
    coverageType: packageId.startsWith('radar-v06') ? 'v0.6_completed_publication' : 'completed_publication_package',
    rows,
  }))
  coverageSources.push({
    packageId: binding.earlierCampaign.packageId,
    manifestSource: `${binding.inventory.reviewDirectory}/research-batch-0001.jsonl`,
    coverageType: 'earlier_2500_research_campaign',
    rows: earlierCampaign,
  })

  for (const source of list(binding.additionalAcceptedCoverage)) {
    const root = path.resolve(cwd, source.root)
    const relative = assertRelative(source.file)
    const file = assertConfined(root, relative)
    if (!fs.existsSync(file) || sha256File(file).toUpperCase() !== val(source.sha256).toUpperCase()) {
      throw new Error(`Additional accepted coverage binding mismatch:${source.packageId}`)
    }
    if (source.integrity === 'immutable-root') verifyImmutableExternalRoot(root, relative)
    if (source.integrity === 'sha256sums') verifySha256SumsEntry(root, relative)
    const rows = readJsonl(file)
    if (rows.length !== Number(source.rowCount)) throw new Error(`Additional accepted coverage row count mismatch:${source.packageId}`)
    coverageSources.push({
      packageId: source.packageId,
      manifestSource: `${source.root}/${relative}`,
      coverageType: source.coverageType,
      rows,
    })
  }
  return {
    canonicalRows,
    coverageSources,
    metadata: {
      sourcePackageId: binding.inventory.packageId,
      sourceManifestSha256: val(binding.inventory.sourceManifestSha256).toLowerCase(),
      acceptedSourceBinding: binding,
      canonicalRowsScanned: canonicalRows.length,
    },
  }
}

function verifyImmutableExternalRoot(root, requiredRelative) {
  const receipt = fs.readFileSync(path.join(root, 'SHA256SUMS'), 'utf8').trim()
  const match = /^([0-9a-f]{64})  (immutable-root-manifest-v02\.json)$/iu.exec(receipt)
  if (!match) throw new Error('Accepted immutable coverage receipt invalid')
  const rootFile = path.join(root, match[2])
  if (sha256File(rootFile) !== match[1].toLowerCase()) throw new Error('Accepted immutable coverage root mismatch')
  const manifest = JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  const entry = list(manifest.files).find((item) => val(item.file) === requiredRelative)
  if (!entry) throw new Error(`Accepted immutable root does not list coverage:${requiredRelative}`)
  const file = assertConfined(root, requiredRelative)
  if (fs.statSync(file).size !== Number(entry.bytes) || sha256File(file) !== val(entry.sha256)) {
    throw new Error(`Accepted immutable coverage file mismatch:${requiredRelative}`)
  }
}
