import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreditEdge, PublicCreator } from './publicCreatorGraph'

type NameCorrection = {
  workId: string
  oldCreatorId: string
  oldName: string
  role: string
  subject: number
  official?: string
  targets: { creatorId: string; person: number; name: string; scope?: string }[]
}

type Studio = {
  creatorId: string
  name: string
  authority: string
  spellings: Record<string, string>
}

function key(workId: string, creatorId: string, name: string, role: string) {
  return JSON.stringify([workId, creatorId, name, role])
}

export function readAnimationCreditNames(directory: string, enabled: boolean) {
  const rows = new Map<string, NameCorrection>()
  const redirects = new Map<string, string>()
  const studios: Studio[] = []
  const studioById = new Map<string, Studio>()
  if (enabled) {
    const file = join(directory, '..', 'identity-20261121', 'animation-credit-names.json')
    const data: { rows: NameCorrection[]; redirects: Record<string, string>; organizations: Studio[] } = JSON.parse(readFileSync(file, 'utf8'))
    for (const [from, to] of Object.entries(data.redirects)) redirects.set(from, to)
    for (const studio of data.organizations) {
      if (!studio.spellings[studio.creatorId] || !studio.name.trim() || new URL(studio.authority).protocol !== 'https:')
        throw new Error('Invalid studio profile ' + studio.creatorId)
      studios.push(studio)
      for (const id of Object.keys(studio.spellings)) {
        if (studioById.has(id) || redirects.has(id)) throw new Error('Conflicting studio identity ' + id)
        studioById.set(id, studio)
        if (id !== studio.creatorId) redirects.set(id, studio.creatorId)
      }
    }
    for (const row of data.rows) {
      const id = key(row.workId, row.oldCreatorId, row.oldName, row.role)
      if (rows.has(id) || !Number.isSafeInteger(row.subject) || row.subject < 1 || !row.targets.length)
        throw new Error(`Invalid animation credit correction for ${row.workId}`)
      rows.set(id, row)
    }
  }
  function resolve(edge: CreditEdge, entities: Map<string, PublicCreator>): CreditEdge[] {
    const id = key(edge.workId, edge.creatorId, edge.displayName, edge.role)
    const row = rows.get(id)
    if (!row) return [edge]
    const subjectUrl = `https://bgm.tv/subject/${row.subject}`
    if (edge.creditKind !== 'person' || !edge.sourceUrls.some(url => {
      const source = new URL(url)
      return ['bgm.tv', 'chii.in', 'bangumi.tv'].includes(source.hostname) &&
        [`/subject/${row.subject}`, `/subject/${row.subject}/persons`].includes(source.pathname.replace(/\/$/, ''))
    })) throw new Error(`Animation credit edition changed for ${row.workId}`)
    rows.delete(id)
    return row.targets.map(target => {
      const person = entities.get(target.creatorId)
      if (person?.kind !== 'person' || person.name !== target.name || !Number.isSafeInteger(target.person) || target.person < 1)
        throw new Error(`Unknown animation staff member for ${row.workId}`)
      const sources = [...edge.sourceUrls, `${subjectUrl}/persons`, `https://bgm.tv/person/${target.person}`]
      if (row.official) sources.push(row.official)
      return { ...edge, creatorId: target.creatorId, displayName: target.name, scope: target.scope,
        bindingBasis: 'edition_staff_roster', sourceUrls: [...new Set(sources)] }
    })
  }
  function applyStudioNames(entities: Map<string, PublicCreator>, originals: PublicCreator[]) {
    const previous = new Map(originals.map(node => [node.creatorId, node]))
    for (const studio of studios) {
      const target = entities.get(studio.creatorId)
      if (!target || target.kind !== 'organization') throw new Error('Missing studio ' + studio.creatorId)
      const names = new Set([studio.name, ...target.names])
      for (const [id, spelling] of Object.entries(studio.spellings)) {
        const old = previous.get(id)
        if (old?.kind !== 'organization' || old.name !== spelling) throw new Error('Unbound studio spelling ' + id)
        for (const alias of [old.name, ...old.names]) names.add(alias)
      }
      target.name = studio.name
      target.names = [...names]
      target.authorityUrl = studio.authority
    }
  }
  function resolveStudio(edge: CreditEdge): CreditEdge {
    const studio = studioById.get(edge.creatorId)
    if (!studio) return edge
    if (edge.creditKind !== 'organization') throw new Error('Unexpected studio role ' + edge.creatorId)
    return { ...edge, creatorId: studio.creatorId, displayName: studio.name }
  }
  return { redirects, resolve, applyStudioNames, resolveStudio, assertComplete() {
    if (rows.size) throw new Error(`Unmatched animation credit correction: ${rows.keys().next().value}`)
  } }
}
