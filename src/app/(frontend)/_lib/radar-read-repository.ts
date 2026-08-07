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

type PayloadDocument = Record<string, unknown> & {
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

function asConclusion(doc?: PayloadDocument | null): RadarConclusionInput | null {
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

function asResearch(doc: PayloadDocument): RadarResearchInput {
  return {
    workIdSnapshot: doc.workIdSnapshot as string | number | null | undefined,
    workSiteId: doc.workSiteId as string | null | undefined,
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

  const rawRecord = recordResult.docs[0] as unknown as PayloadDocument | undefined
  const rawRating = ratingResult.docs[0] as unknown as PayloadDocument | undefined
  const rawCandidate = candidateResult.docs[0] as unknown as PayloadDocument | undefined

  const record = asConclusion(rawRecord)
  const rating = asConclusion(rawRating)
  const candidate = asConclusion(rawCandidate)

  const exactRecord = record && hasExactRadarIdentity(identity, record) ? record : null
  const exactRating = rating && hasExactRadarIdentity(identity, rating) ? rating : null
  const exactCandidate = candidate && hasExactRadarIdentity(identity, candidate) ? candidate : null

  const researchHistory = (researchResult.docs as unknown as PayloadDocument[])
    .map(asResearch)
    .filter((row) => hasExactRadarIdentity(identity, row))

  const researchHistoryTruncated = researchResult.totalDocs > researchHistory.length

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

export function expectedRadarIdentityKey(input: WorkReadInput) {
  return radarIdentityKey({ workId: input.workId, siteId: input.siteId })
}
