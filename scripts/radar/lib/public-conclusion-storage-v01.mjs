import crypto from 'node:crypto'

export const PUBLIC_CONCLUSION_STORAGE_VERSION = 'radar-public-storage-normalization-v0.1'
export const POSTGRES_TIMESTAMP_PRECISION = 3

export function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => canonical(item))
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}

export function sha256Canonical(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function publicRecordCore(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Public record must be an object.')
  }
  const core = structuredClone(record)
  delete core.conclusionSha256
  return canonical(core)
}

export function conclusionSha256ForRecord(record) {
  return sha256Canonical(publicRecordCore(record))
}

export function normalizeTimestampForPostgres3(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('assessedAt must be a non-empty ISO-8601 string.')
  }

  const match = value.trim().match(
    /^(?<date>\d{4}-\d{2}-\d{2})T(?<time>\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d{1,6}))?(?<zone>Z|[+-]\d{2}:\d{2})$/u,
  )
  if (!match?.groups) {
    throw new Error(`assessedAt is not a supported ISO-8601 instant: ${value}`)
  }

  const baseText = `${match.groups.date}T${match.groups.time}${match.groups.zone}`
  const baseMilliseconds = Date.parse(baseText)
  if (!Number.isFinite(baseMilliseconds)) {
    throw new Error(`assessedAt cannot be parsed: ${value}`)
  }

  const fraction = String(match.groups.fraction || '').padEnd(6, '0')
  const microseconds = fraction ? Number(fraction) : 0
  if (!Number.isInteger(microseconds) || microseconds < 0 || microseconds > 999999) {
    throw new Error(`assessedAt fractional seconds are invalid: ${value}`)
  }

  // PostgreSQL timestamp(3) rounds to three fractional digits. Adding 500
  // microseconds before integer division implements the same positive-second
  // half-up carry, including 999.5 ms rolling into the next second.
  const roundedMilliseconds = Math.floor((microseconds + 500) / 1000)
  return new Date(baseMilliseconds + roundedMilliseconds).toISOString()
}

function recordWithoutStorageMutableFields(record) {
  const copy = structuredClone(record)
  delete copy.conclusionSha256
  if (copy.radarAssessment && typeof copy.radarAssessment === 'object') {
    delete copy.radarAssessment.assessedAt
  }
  return canonical(copy)
}

export function normalizePublicRecordForStorage(record) {
  const oldConclusionSha256 = String(record?.conclusionSha256 || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(oldConclusionSha256)) {
    throw new Error('Public record has an invalid conclusionSha256.')
  }

  const computedOldConclusionSha256 = conclusionSha256ForRecord(record)
  if (computedOldConclusionSha256 !== oldConclusionSha256) {
    throw new Error(
      `Public record conclusion hash mismatch: expected ${oldConclusionSha256}, computed ${computedOldConclusionSha256}`,
    )
  }

  const oldAssessedAt = record?.radarAssessment?.assessedAt
  const normalizedAssessedAt = normalizeTimestampForPostgres3(oldAssessedAt)
  const normalizedCore = publicRecordCore(record)
  normalizedCore.radarAssessment = {
    ...(normalizedCore.radarAssessment || {}),
    assessedAt: normalizedAssessedAt,
  }
  const canonicalCore = canonical(normalizedCore)
  const newConclusionSha256 = sha256Canonical(canonicalCore)
  const normalizedRecord = canonical({
    ...canonicalCore,
    conclusionSha256: newConclusionSha256,
  })

  const beforeStable = recordWithoutStorageMutableFields(record)
  const afterStable = recordWithoutStorageMutableFields(normalizedRecord)
  if (JSON.stringify(beforeStable) !== JSON.stringify(afterStable)) {
    throw new Error('Storage normalization changed a field other than assessedAt/conclusionSha256.')
  }
  if (conclusionSha256ForRecord(normalizedRecord) !== newConclusionSha256) {
    throw new Error('Normalized public record hash does not reproduce from stored content.')
  }

  return {
    normalizedRecord,
    mapping: canonical({
      publicationKey: record.publicationKey,
      work: record.work,
      workIdSnapshot: record.workIdSnapshot,
      oldAssessedAt,
      normalizedAssessedAt,
      oldConclusionSha256,
      newConclusionSha256,
      changedFields: ['publicRecord.radarAssessment.assessedAt', 'publicRecord.conclusionSha256'],
    }),
  }
}
