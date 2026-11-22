import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreditEdge } from './publicCreatorGraph'
import { mergeCredits } from './publicDescriptiveMerge'
import type { IdentityReview } from './publicIdentityReview'
import type { PublicCredit, PublicWorkRecord } from './publicRelease'

type Correction = {
  workId: string
  subject?: number
  catalogSource?: string
  source: 'catalog' | 'staff'
  person?: number
  oldId: string
  oldName: string
  oldRole: string
  creatorId: string
  name: string
  role: string
  urls: string[]
}

function signature(id: string, creator: string, name: string, role: string) {
  return JSON.stringify([id, creator, name, role])
}

function catalogSource(row: Correction) {
  return row.catalogSource ?? 'https://bgm.tv/subject/' + row.subject
}

export function readHistoricalOrganizations(directory: string, enabled: boolean) {
  const data: { schemaVersion?: string; redirects: Record<string, string>; credits: Correction[] } = enabled ?
    JSON.parse(readFileSync(join(directory, '..', 'identity-20261121', 'historical-organization-credits.json'), 'utf8')) :
    { redirects: {}, credits: [] }
  if (enabled && data.schemaVersion !== 'baihepailei-historical-organization-staff-v1') throw new Error('Invalid historical organization review')
  const catalog = new Map<string, Correction>()
  const staff = new Map<string, Correction>()
  const metadata = new Map<string, Correction[]>()
  const redirects = new Map(Object.entries(data.redirects))
  for (const row of data.credits) {
    const key = signature(row.workId, row.oldId, row.oldName, row.oldRole)
    const index = row.source === 'catalog' ? catalog : staff
    const validSource = row.catalogSource === undefined
      ? Number.isSafeInteger(row.subject) && (row.subject ?? 0) > 0
      : row.source === 'catalog' && !row.subject && row.catalogSource.startsWith('https://')
    if (index.has(key) || !validSource ||
        !row.urls.length || row.urls.some(url => !url.startsWith('https://')) ||
        (row.source === 'staff' && (!Number.isSafeInteger(row.person) || !row.person || row.person < 1))) {
      throw new Error('Unbound historical organization credit: ' + row.workId)
    }
    index.set(key, row)
    if (row.source === 'catalog') metadata.set(row.workId, [...(metadata.get(row.workId) || []), row])
  }
  function correct(edge: CreditEdge, index: Map<string, Correction>): CreditEdge {
    const id = index === catalog ? edge.workId : edge.sourceWorkId
    if (!id) return edge
    const key = signature(id, edge.creatorId, edge.name, edge.role)
    const row = index.get(key)
    if (!row) return edge
    const subjectUrl = catalogSource(row)
    const signed = index === catalog ? edge.sourceUrls.includes(subjectUrl) :
      edge.sourceUrls.includes(subjectUrl + '/persons') && edge.sourceUrls.includes('https://bgm.tv/person/' + row.person)
    if (!signed) throw new Error('Historical organization source changed: ' + row.workId)
    index.delete(key)
    return { ...edge, creatorId: row.creatorId, name: row.name, displayName: row.name, creditKind: 'organization', role: row.role,
      bindingBasis: 'historical_organization_' + row.source + '_' + row.oldId,
      sourceUrls: [...new Set([...edge.sourceUrls, ...row.urls])] }
  }
  function applyStaff(review: NonNullable<IdentityReview>) {
    for (const id of redirects.keys()) review.removedCreatorIds.add(id)
    for (const [id, edges] of review.creditsByWork) {
      if (edges.some(e => e.sourceWorkId && staff.has(signature(e.sourceWorkId, e.creatorId, e.name, e.role)))) {
        review.creditsByWork.set(id, edges.map(e => correct(e, staff)))
      }
    }
    if (staff.size) throw new Error('Unmatched historical staff credit: ' + staff.keys().next().value)
  }
  function applyMetadata(work: PublicWorkRecord, members: string[]) {
    const rows = members.flatMap(id => metadata.get(id) || [])
    if (!rows.length) return work
    const creators: PublicCredit[] = []
    const organizations: PublicCredit[] = []
    for (const [credits, target] of [[work.organizations, organizations], [work.creators, creators]]) {
      for (const credit of credits) {
        const sources = new Set([...(credit.sourceUrls || []), credit.sourceUrl])
        const matched = rows.filter(row => row.oldName === credit.name && row.oldRole === credit.role &&
          sources.has(catalogSource(row)))
        if (!matched.length) {
          target.push(credit)
          continue
        }
        for (const row of matched) {
          organizations.push({ ...credit, name: row.name, role: row.role,
            sourceUrls: [...new Set([...(credit.sourceUrls || []), ...row.urls])] })
        }
      }
    }
    return { ...work, creators, organizations: mergeCredits(organizations) }
  }
  return { redirects, applyStaff, applyMetadata, correctCatalog: (edge: CreditEdge) => correct(edge, catalog),
    assertCatalogComplete() {
      if (catalog.size) throw new Error('Unmatched historical catalog credit: ' + catalog.keys().next().value)
    } }
}
