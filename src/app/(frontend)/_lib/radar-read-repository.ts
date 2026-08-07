import configPromise from '@payload-config'
import { getPayload, type Payload, type Where } from 'payload'

import {
  hasExactRadarIdentity,
  radarIdentityKey,
  type RadarConclusionInput,
  type RadarExactIdentity,
  type RadarReadSnapshot,
  type RadarResearchInput,
} from '@/lib/radar/readStandardization'

export type RadarSourceDocument = Record<string, unknown> & {
  id?: string | number
  updatedAt?: string | null
}

type WorkReadInput = {
  workId: string | number
  siteId: string
  humanAssessment?: RadarReadSnapshot['humanOverride']
  legacyCompatibility?: RadarReadSnapshot['legacyCompatibility']
}

export type RadarRepositoryReadResult = RadarReadSnapshot & {
  sourceDocuments: {
    published: {
      record: RadarSourceDocument | null
      rating: RadarSourceDocument | null
    }
    candidate: RadarSourceDocument | null
    research: {
      latest: RadarSourceDocument | null
      history: RadarSourceDocument[]
    }
  }
  diagnostics: {
    publishedRecordRejected: boolean
    publishedRatingRejected: boolean
    candidateRejected: boolean
    researchHistoryTruncated: boolean
  }
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function asConclusion(doc?: RadarSourceDocument | null): RadarConclusionInput | null {
  if (!doc) return null
  const humanReview = doc.humanReview as { blocksPublication?: boolean | null } | undefined
  return {
    workIdSnapshot: doc.workIdSnapshot as string | number | null | undefined,
    workSiteId: doc.workSiteId as string | null | undefined,
    identityKey: doc.identityKey as string | null | undefined,
    recordStatus: doc.recordStatus as string | null | undefined,
    conclusionMode: doc.conclusionMode as string | null | undefined,
    coreGrade: doc.coreGrade as string | null | undefined,
    compatibilityGrade: doc.compatibilityGrade as string | null | undefined,
    bestGrade: doc.bestGrade as string | null | undefined,
    likelyGrade: doc.likelyGrade as string | null | undefined,
    worstGrade: doc.worstGrade as string | null | undefined,
    ratingNotice: doc.ratingNotice as string | null | undefined,
    blocksPublication: humanReview?.blocksPublication,
  }
}

function asResearch(doc: RadarSourceDocument): RadarResearchInput {
  return {
    workIdSnapshot: doc.workIdSnapshot as string | number | null | undefined,
    workSiteId: doc.workSiteId as string | null | undefined,
    identityKey: doc.identityKey as string | null | undefined,
    recordStatus: doc.recordStatus as string | null | undefined,
    proposedBestGrade: doc.proposedBestGrade as string | null | undefined,
    proposedLikelyGrade: doc.proposedLikelyGrade as string | null | undefined,
    proposedWorstGrade: doc.proposedWorstGrade as string | null | undefined,
    importedAt: doc.importedAt as string | null | undefined,
    updatedAt: doc.updatedAt,
  }
}

function exactWhere(identity: RadarExactIdentity, includeCurrent = true): Where {
  const conditions: Where[] = [
    { workIdSnapshot: { equals: clean(identity.workId) } },
    { workSiteId: { equals: clean(identity.siteId) } },
  ]
  if (includeCurrent) conditions.push({ recordStatus: { equals: 'current' } })
  return { and: conditions }
}

async function readWithPayload(
  payload: Payload,
  input: WorkReadInput,
): Promise<RadarRepositoryReadResult> {
  const identity: RadarExactIdentity = {
    workId: clean(input.workId),
    siteId: clean(input.siteId),
  }
  const publicationKey = `work:${clean(input.workId)}`
  const publishedWhere: Where = {
    and: [
      { publicationKey: { equals: publicationKey } },
      { recordStatus: { equals: 'current' } },
    ],
  }

  const [recordResult, ratingResult, candidateResult, researchResult] = await Promise.all([
    payload.find({
      collection: 'radar-public-records',
      depth: 0,
      limit: 1,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: publishedWhere,
    }),
    payload.find({
      collection: 'radar-public-ratings',
      depth: 0,
      limit: 1,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: publishedWhere,
    }),
    payload.find({
      collection: 'radar-public-conclusions',
      depth: 0,
      limit: 2,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: exactWhere(identity),
      sort: '-publishedAt',
    }),
    payload.find({
      collection: 'radar-research-records',
      depth: 0,
      limit: 100,
      page: 1,
      pagination: true,
      overrideAccess: true,
      where: exactWhere(identity),
      sort: '-importedAt',
    }),
  ])

  const rawRecord = recordResult.docs[0] as unknown as RadarSourceDocument | undefined
  const rawRating = ratingResult.docs[0] as unknown as RadarSourceDocument | undefined
  const rawCandidate = candidateResult.docs[0] as unknown as RadarSourceDocument | undefined

  const record = asConclusion(rawRecord)
  const rating = asConclusion(rawRating)
  const candidate = asConclusion(rawCandidate)

  const exactRecord = record && hasExactRadarIdentity(identity, record) ? record : null
  const exactRating = rating && hasExactRadarIdentity(identity, rating) ? rating : null
  const exactCandidate = candidate && hasExactRadarIdentity(identity, candidate) ? candidate : null

  const exactResearchDocuments = (researchResult.docs as unknown as RadarSourceDocument[])
    .filter((doc) => hasExactRadarIdentity(identity, asResearch(doc)))
  const researchHistory = exactResearchDocuments.map(asResearch)
  const researchHistoryTruncated = researchResult.totalDocs > exactResearchDocuments.length

  return {
    identity,
    humanOverride: input.humanAssessment ?? null,
    published: {
      record: exactRecord,
      rating: exactRating,
    },
    candidate: exactCandidate,
    research: {
      latest: researchHistory[0] ?? null,
      history: researchHistory,
      truncated: researchHistoryTruncated,
    },
    legacyCompatibility: input.legacyCompatibility ?? null,
    sourceDocuments: {
      published: {
        record: exactRecord && rawRecord ? rawRecord : null,
        rating: exactRating && rawRating ? rawRating : null,
      },
      candidate: exactCandidate && rawCandidate ? rawCandidate : null,
      research: {
        latest: exactResearchDocuments[0] ?? null,
        history: exactResearchDocuments,
      },
    },
    diagnostics: {
      publishedRecordRejected: Boolean(rawRecord && !exactRecord),
      publishedRatingRejected: Boolean(rawRating && !exactRating),
      candidateRejected: Boolean(rawCandidate && !exactCandidate),
      researchHistoryTruncated,
    },
  }
}

export async function readRadarSnapshot(
  input: WorkReadInput,
): Promise<RadarRepositoryReadResult | null> {
  if (!clean(input.workId) || !clean(input.siteId)) return null

  try {
    const payload = await getPayload({ config: configPromise })
    return await readWithPayload(payload, input)
  } catch {
    // This read layer is optional for degraded/static deployments. A database
    // outage must not turn a work detail route into a server error.
    return null
  }
}

export async function readRadarSnapshotForWork(
  workId?: string | number,
): Promise<RadarRepositoryReadResult | null> {
  const normalizedWorkId = clean(workId)
  if (!normalizedWorkId) return null

  try {
    const payload = await getPayload({ config: configPromise })
    const work = await payload.findByID({
      collection: 'works',
      id: normalizedWorkId,
      depth: 0,
      overrideAccess: true,
    }) as unknown as RadarSourceDocument
    const siteId = clean(work.siteId)
    if (!siteId) return null

    return await readWithPayload(payload, {
      workId: normalizedWorkId,
      siteId,
    })
  } catch {
    // Resolve the internal compatibility siteId from the canonical Works row
    // server-side. Never fall back to title matching or publicationKey alone.
    return null
  }
}

export function expectedRadarIdentityKey(input: WorkReadInput) {
  return radarIdentityKey({ workId: input.workId, siteId: input.siteId })
}
