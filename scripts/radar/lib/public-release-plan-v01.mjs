import crypto from 'node:crypto'

const val = (value) => String(value ?? '').trim()

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    )
  }
  return value
}

export function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function normalizeRelationship(value) {
  if (value && typeof value === 'object') return val(value.id)
  return val(value)
}

export function buildWorkIndexes(works) {
  const byId = new Map()
  const bySiteId = new Map()
  const duplicateIds = new Set()
  const duplicateSiteIds = new Set()
  for (const work of works) {
    const id = val(work?.id)
    const siteId = val(work?.siteId)
    if (id) {
      if (byId.has(id)) duplicateIds.add(id)
      else byId.set(id, work)
    }
    if (siteId) {
      if (bySiteId.has(siteId)) duplicateSiteIds.add(siteId)
      else bySiteId.set(siteId, work)
    }
  }
  return { byId, bySiteId, duplicateIds, duplicateSiteIds }
}

export function buildCurrentRecordIndexes(records) {
  const byPublicationKey = new Map()
  const duplicatePublicationKeys = new Set()
  for (const record of records) {
    if (val(record?.recordStatus || 'current') !== 'current') continue
    const key = val(record?.publicationKey)
    if (!key) continue
    if (byPublicationKey.has(key)) duplicatePublicationKeys.add(key)
    else byPublicationKey.set(key, record)
  }
  return { byPublicationKey, duplicatePublicationKeys }
}

export function matchExactWork(record, indexes) {
  const workId = val(record.workId)
  const siteId = val(record.siteId)
  if (indexes.duplicateIds.has(workId)) return { status: 'blocked_duplicate_work_id', blockers: [`duplicate_work_id:${workId}`] }
  if (indexes.duplicateSiteIds.has(siteId)) return { status: 'blocked_duplicate_site_id', blockers: [`duplicate_site_id:${siteId}`] }
  const byId = indexes.byId.get(workId)
  const bySite = indexes.bySiteId.get(siteId)
  if (!byId && !bySite) return { status: 'blocked_missing_exact_work', blockers: ['missing_exact_work'] }
  if (!byId) {
    return {
      status: 'blocked_identity_conflict',
      blockers: [`site_id_bound_to_other_work:${val(bySite?.id)}`],
    }
  }
  if (val(byId.siteId) !== siteId) {
    return {
      status: 'blocked_identity_conflict',
      blockers: [`work_id_site_id_mismatch:${val(byId.siteId) || 'missing'}!=${siteId}`],
    }
  }
  if (!bySite || val(bySite.id) !== workId) {
    return {
      status: 'blocked_identity_conflict',
      blockers: [`site_id_work_id_mismatch:${val(bySite?.id) || 'missing'}!=${workId}`],
    }
  }
  return { status: 'matched_exact_work', work: byId, blockers: [] }
}

export function buildDesiredPublicRecord(record, work, release, importedAt) {
  const desired = {
    publicationKey: `work:${val(work.id)}`,
    work: val(work.id),
    identityKey: val(record.identityKey),
    workIdSnapshot: val(record.workId),
    workSiteId: val(record.siteId),
    title: val(record.title),
    publicState: val(record.publicState),
    researchStatus: val(record.researchStatus),
    pageNotice: val(record.pageNotice),
    facts: (record.facts || []).map((fact) => ({
      factId: val(fact.factId),
      factType: val(fact.type),
      value: fact.value,
      sourceRefs: (fact.sourceRefs || []).map((sourceRef) => ({ value: val(sourceRef) })),
    })),
    evidence: (record.evidence || []).map((source) => ({
      sourceRef: val(source.sourceRef),
      tier: val(source.tier),
      role: val(source.role),
      url: val(source.url),
      title: val(source.title),
      exactIdentityBound: source.exactIdentityBound === true,
    })),
    sourceReleaseId: val(release.releaseId),
    sourceCommitSha: val(release.sourceCommitSha),
    sourcePolicyVersion: val(release.policyVersion),
    researchSnapshotId: val(release.researchSnapshotId),
    recordSha256: sha256Json(record),
    releaseRecordsSha256: val(release.recordsSha256),
    sourceReviewedAt: val(record.lastReviewedAt),
    importedAt,
    recordStatus: 'current',
  }
  return desired
}

function comparableCurrentRecord(record) {
  if (!record) return null
  return {
    publicationKey: val(record.publicationKey),
    work: normalizeRelationship(record.work),
    identityKey: val(record.identityKey),
    workIdSnapshot: val(record.workIdSnapshot),
    workSiteId: val(record.workSiteId),
    title: val(record.title),
    publicState: val(record.publicState),
    researchStatus: val(record.researchStatus),
    pageNotice: val(record.pageNotice),
    facts: (record.facts || []).map((fact) => ({
      factId: val(fact.factId),
      factType: val(fact.factType),
      value: fact.value,
      sourceRefs: (fact.sourceRefs || []).map((item) => ({ value: val(item?.value ?? item) })),
    })),
    evidence: (record.evidence || []).map((source) => ({
      sourceRef: val(source.sourceRef),
      tier: val(source.tier),
      role: val(source.role),
      url: val(source.url),
      title: val(source.title),
      exactIdentityBound: source.exactIdentityBound === true,
    })),
    sourceReleaseId: val(record.sourceReleaseId),
    sourceCommitSha: val(record.sourceCommitSha),
    sourcePolicyVersion: val(record.sourcePolicyVersion),
    researchSnapshotId: val(record.researchSnapshotId),
    recordSha256: val(record.recordSha256),
    releaseRecordsSha256: val(record.releaseRecordsSha256),
    sourceReviewedAt: val(record.sourceReviewedAt),
    recordStatus: val(record.recordStatus || 'current'),
  }
}

function comparableDesiredRecord(record) {
  const { importedAt, ...rest } = record
  return rest
}

export function buildPlanRow(record, workIndexes, currentIndexes, release, importedAt) {
  const match = matchExactWork(record, workIndexes)
  const base = {
    identityKey: val(record.identityKey),
    workId: val(record.workId),
    siteId: val(record.siteId),
    title: val(record.title),
    publicState: val(record.publicState),
    blockers: [...match.blockers],
    warnings: [],
    target: match.work ? { id: val(match.work.id), siteId: val(match.work.siteId), title: val(match.work.title) } : null,
    currentRecordId: null,
    desired: null,
  }
  if (match.status !== 'matched_exact_work') return { ...base, planStatus: match.status }

  const desired = buildDesiredPublicRecord(record, match.work, release, importedAt)
  const publicationKey = desired.publicationKey
  if (currentIndexes.duplicatePublicationKeys.has(publicationKey)) {
    return {
      ...base,
      desired,
      planStatus: 'blocked_duplicate_current_publication',
      blockers: [`duplicate_current_publication:${publicationKey}`],
    }
  }
  const current = currentIndexes.byPublicationKey.get(publicationKey)
  if (!current) return { ...base, desired, planStatus: 'ready_create' }

  const currentWork = normalizeRelationship(current.work)
  base.currentRecordId = val(current.id)
  if (currentWork !== val(match.work.id) || val(current.identityKey) !== val(record.identityKey)) {
    return {
      ...base,
      desired,
      planStatus: 'blocked_existing_publication_identity_conflict',
      blockers: [`existing_publication_identity_conflict:${currentWork}|${val(current.identityKey)}`],
    }
  }

  const same = JSON.stringify(stableValue(comparableCurrentRecord(current)))
    === JSON.stringify(stableValue(comparableDesiredRecord(desired)))
  return {
    ...base,
    desired,
    planStatus: same ? 'already_current' : 'ready_update',
  }
}
