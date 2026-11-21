import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreditEdge } from './publicCreatorGraph'
import type { IdentityReview } from './publicIdentityReview'
import type { PublicWorkRecord } from './publicRelease'

type Publisher = {
  sourceId: string
  person: number
  name: string
  organizationId: string
  organizationName: string
  legalName?: string
  authority: string
}

const editionPublisherRoles = new Set(['原版出版社', '译本出版社', '中文版出版社', '英文版出版社'])

function publishers(directory: string): Publisher[] {
  const path = join(directory, '..', 'identity-20261121', 'publisher-identities.json')
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (data.schemaVersion !== 'baihepailei-bangumi-publisher-identities-v1') throw new Error('Invalid publisher identity review')
  return data.publishers
}

export function publisherRedirects(directory: string): Map<string, string> {
  return new Map(publishers(directory).filter(publisher => publisher.sourceId !== publisher.organizationId)
    .map(publisher => [publisher.sourceId, publisher.organizationId]))
}

export function applyPublisherIdentities(directory: string, works: Map<string, PublicWorkRecord>, review: IdentityReview) {
  if (!review) return
  const reviewed = new Map<string, Publisher>()
  for (const publisher of publishers(directory)) {
    const { sourceId, person, name, organizationId, organizationName, authority } = publisher
    const old = review.entities.find(node => node.creatorId === sourceId)
    if (sourceId !== '815' + String(person).padStart(9, '0') || old?.name !== name || old.kind !== 'person' ||
        !/^\d{7,12}$/.test(organizationId) || !authority.startsWith('https://') || reviewed.has(sourceId)) {
      throw new Error(`Publisher identity mismatch for ${sourceId}`)
    }
    reviewed.set(sourceId, publisher)
    if (organizationId === sourceId) {
      old.kind = 'organization'
      old.name = organizationName
      old.names = [...new Set([...old.names, organizationName, ...(publisher.legalName ? [publisher.legalName] : [])])]
    } else {
      review.removedCreatorIds.add(sourceId)
    }
  }
  const matched = new Set<string>()
  for (const [workId, edges] of review.creditsByWork) {
    if (!edges.some(edge => reviewed.has(edge.creatorId))) continue
    const corrected: CreditEdge[] = []
    for (const edge of edges) {
      const publisher = reviewed.get(edge.creatorId)
      if (!publisher) { corrected.push(edge); continue }
      if (edge.bindingBasis !== 'bangumi_staff' || edge.creditKind !== 'person' ||
          !edge.sourceUrls.includes(`https://bgm.tv/person/${publisher.person}`) ||
          !edge.sourceUrls.some(url => /^https:\/\/bgm\.tv\/subject\/\d+\/persons$/.test(url))) {
        throw new Error(`Unbound publisher role for ${workId}: ${edge.creatorId}`)
      }
      matched.add(edge.creatorId)
      const names = [publisher.name, publisher.organizationName, publisher.legalName]
      const existingRole = edge.role === '出版社' && (
        edges.find(other => other.creditKind === 'organization' && other.creatorId === publisher.organizationId && editionPublisherRoles.has(other.role))?.role ||
        works.get(workId)?.organizations.find(other => names.includes(other.name) && editionPublisherRoles.has(other.role))?.role
      )
      corrected.push({ ...edge, creatorId: publisher.organizationId, creditKind: 'organization',
        name: publisher.organizationName, displayName: publisher.organizationName, role: existingRole || edge.role,
        sourceUrls: [...new Set([...edge.sourceUrls, publisher.authority])], bindingBasis: 'publisher_staff_identity' })
    }
    review.creditsByWork.set(workId, corrected)
  }
  if (matched.size !== reviewed.size) throw new Error('A reviewed publisher had no matching edition credit')
}
