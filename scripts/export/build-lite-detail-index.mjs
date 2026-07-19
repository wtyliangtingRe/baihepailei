#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT = 'public/detail-index.json'
const COLLECTIONS = ['works', 'creators', 'organizations', 'evidence', 'terms', 'rules']
const OPTIONAL_COLLECTIONS = new Set(['evidence'])
const PAGE_LIMIT = '1000'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function usage() {
  console.log(`Usage:
  pnpm export:lite-details -- [--url http://localhost:3000] [--out public/detail-index.json] [--include-drafts] [--profile full|lite]

Optional environment variables:
  PAYLOAD_EXPORT_EMAIL
  PAYLOAD_EXPORT_PASSWORD

Fallback environment variables:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

Examples:
  pnpm export:lite-details -- --url "http://localhost:3000"

  $env:PAYLOAD_EXPORT_EMAIL="you@example.com"
  $env:PAYLOAD_EXPORT_PASSWORD="your-password"
  pnpm export:lite-details -- --url "http://localhost:3000" --include-drafts
`)
}

function exportProfile(args) {
  const requested = String(args.profile || (args.lite ? 'lite' : 'full')).trim().toLowerCase()
  return requested === 'lite' ? 'lite' : 'full'
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }

  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload, null, 2) : text
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${detail}`)
  }

  return payload
}

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchCollection(baseUrl, token, collection, { includeDrafts, profile }) {
  const fetchPages = async (drafts) => {
    const docs = []
    let page = 1
    let totalPages = 1

    do {
      const params = new URLSearchParams()
      params.set('limit', PAGE_LIMIT)
      params.set('page', String(page))
      params.set('depth', '2')

      if (drafts) {
        params.set('draft', 'true')
      } else if (collection === 'evidence') {
        params.set('where[status][equals]', 'confirmed')
        params.set('where[isPublic][equals]', 'true')
      } else {
        params.set('where[status][equals]', 'published')
      }

      if (collection !== 'evidence' && profile === 'lite') {
        params.set('where[isLiteVisible][not_equals]', 'false')
      }

      const result = await requestJson(`${baseUrl}/api/${collection}?${params.toString()}`, {
        headers: authHeaders(token),
      })

      docs.push(...(result?.docs || []))
      totalPages = Number(result?.totalPages || 1)
      page += 1
    } while (page <= totalPages)

    return docs
  }

  if (collection === 'evidence' && includeDrafts) {
    console.warn('[warn] private evidence drafts are excluded from public indexes; exporting current confirmed public evidence only')
    return fetchPages(false)
  }

  try {
    return await fetchPages(includeDrafts)
  } catch (error) {
    if (collection !== 'evidence' || !includeDrafts) throw error
    console.warn('[warn] evidence draft history is incompatible with the current database enum; retrying current public evidence only')
    return fetchPages(false)
  }
}

function richTextToPlainText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richTextToPlainText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    return Object.values(value).map(richTextToPlainText).filter(Boolean).join('\n')
  }
  return ''
}

function normalizeText(value) {
  return String(value || '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

function compactPlainText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n')
}

function aliasesToValues(aliases) {
  if (!Array.isArray(aliases)) return []
  return aliases
    .map((item) => (typeof item === 'string' ? item : item?.value))
    .map(normalizeText)
    .filter(Boolean)
}

function localizedTitleValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.title))
    .map(normalizeText)
    .filter(Boolean)
}

function relationshipName(item) {
  if (!item) return ''
  if (typeof item === 'string') return item
  return item.title || item.name || item.slug || ''
}

function relationshipNames(values) {
  if (!Array.isArray(values)) return []
  return values.map(relationshipName).map(normalizeText).filter(Boolean)
}

function workOrganizationNames(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => relationshipName(item?.organization || item))
    .map(normalizeText)
    .filter(Boolean)
}

function mediaImage(value) {
  if (!value || typeof value === 'string') return undefined
  const url = normalizeText(value.url)
  if (!url) return undefined

  return {
    url,
    alt: normalizeText(value.alt),
    filename: normalizeText(value.filename),
    width: Number(value.width) || undefined,
    height: Number(value.height) || undefined,
  }
}

function optionalPercent(value) {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.min(100, Math.max(0, number))
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.max(0, Math.round(number))
}

function optionalText(value) {
  return String(value || '').trim() || undefined
}

function uniqueTextValues(values) {
  const seen = new Set()
  const output = []
  for (const raw of values.flat(Infinity)) {
    const value = normalizeText(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function candidateSources(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values
    .map((item) => ({
      source: normalizeText(item?.source),
      label: normalizeText(item?.label),
      externalId: normalizeText(item?.externalId),
      url: normalizeText(item?.url),
    }))
    .filter((item) => item.source || item.label || item.externalId || item.url)
    .filter((item) => {
      const key = [item.source, item.externalId, item.url, item.label].join('|').toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function externalIds(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, normalizeText(item)])
      .filter(([, item]) => item),
  )
}

function mergedSourceLinks(doc, candidates) {
  const seen = new Set()
  return [
    ...sourceLinks(doc.sourceLinks),
    ...candidates.filter((item) => item.url).map((item) => ({
      label: item.label || [item.source, item.externalId].filter(Boolean).join(' '),
      url: item.url,
    })),
  ].filter((item) => {
    const key = normalizeText(item.url).replace(/\/+$/u, '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizedRiskMatrix(value) {
  if (!value || typeof value !== 'object') return undefined
  const matrix = {
    maleImpact: normalizeText(value.maleImpact),
    relationshipClarity: normalizeText(value.relationshipClarity),
    endingSafety: normalizeText(value.endingSafety),
    creatorSpeechRisk: normalizeText(value.creatorSpeechRisk),
    note: compactPlainText(value.note),
  }
  return Object.values(matrix).some(Boolean) ? matrix : undefined
}

function normalizeRadarAssessment(value) {
  if (!value || typeof value !== 'object') return undefined
  const matchedRules = Array.isArray(value.matchedRules)
    ? value.matchedRules.map((rule) => ({
      code: optionalText(rule?.code),
      grade: optionalText(rule?.grade)?.toUpperCase(),
      confidencePercent: optionalPercent(rule?.confidencePercent),
      reason: optionalText(rule?.reason),
    })).filter((rule) => Object.values(rule).some((item) => item !== undefined))
    : undefined
  const contradictions = Array.isArray(value.contradictions)
    ? value.contradictions.map((item) => optionalText(typeof item === 'string' ? item : item?.value)).filter(Boolean)
    : undefined
  const assessment = {
    confidencePercent: optionalPercent(value.confidencePercent),
    evidenceCoveragePercent: optionalPercent(value.evidenceCoveragePercent),
    evidenceStatus: optionalText(value.evidenceStatus),
    sourceSummary: optionalText(value.sourceSummary),
    sourceCount: optionalNonNegativeNumber(value.sourceCount),
    policyVersion: optionalText(value.policyVersion),
    suggestedGrade: optionalText(value.suggestedGrade)?.toUpperCase(),
    decisiveRuleCode: optionalText(value.decisiveRuleCode),
    decisiveRuleReason: optionalText(value.decisiveRuleReason),
    matchedRules,
    contradictions,
    requiresHumanReview: typeof value.requiresHumanReview === 'boolean' ? value.requiresHumanReview : undefined,
    assessedAt: optionalText(value.assessedAt),
  }
  return Object.values(assessment).some((item) => item !== undefined) ? assessment : undefined
}

function sourceLinks(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => ({
      label: normalizeText(item?.label),
      url: normalizeText(item?.url),
    }))
    .filter((item) => item.url)
}

function richSection(key, label, content) {
  const plainText = compactPlainText(richTextToPlainText(content))
  if (!content && !plainText) return null
  return {
    key,
    label,
    content: content || null,
    plainText,
  }
}

function sections(values) {
  return values.filter(Boolean)
}

function itemUrl(collection, recordId, slug) {
  if (collection === 'works') return `/works/w-${encodeURIComponent(String(recordId))}`
  if (collection === 'creators') return `/creators/c-${encodeURIComponent(String(recordId))}`
  if (collection === 'organizations') return `/organizations/o-${encodeURIComponent(String(recordId))}`
  if (collection === 'evidence') return `/evidence/${slug}`
  if (collection === 'terms') return `/terms/${slug}`
  if (collection === 'rules') return `/rules/${slug}`
  return `/${collection}/${slug}`
}

function commonFields(collection, doc, title, typeLabel) {
  return {
    id: `${collection}:${doc.slug}`,
    recordId: String(doc.id),
    collection,
    typeLabel,
    title: title || '',
    slug: doc.slug || '',
    url: itemUrl(collection, doc.id, doc.slug),
    legacyXWikiPage: doc.legacyXWikiPage || '',
    updatedAt: doc.updatedAt || '',
    createdAt: doc.createdAt || '',
    status: doc.status || '',
  }
}

function mapWork(doc) {
  const explicitHumanGrade = String(doc.humanAssessment?.grade || '').trim().toUpperCase()
  const legacyHumanGrade = (doc.reviewStatus === 'reviewed' || doc.ratingNotice === 'manual_reviewed') ? String(doc.rank || '').trim().toUpperCase() : ''
  const humanGrade = explicitHumanGrade || legacyHumanGrade
  const aiGrade = String(doc.radarAssessment?.suggestedGrade || '').trim().toUpperCase()
  const effectiveRank = humanGrade || aiGrade || doc.rank || 'unknown'
  const aliases = aliasesToValues(doc.aliases)
  const localizedTitles = localizedTitleValues(doc.localizedTitles)
  const candidates = candidateSources(doc.candidateSources)
  return {
    ...commonFields('works', doc, doc.title, '作品'),
    rank: effectiveRank,
    reviewStatus: doc.reviewStatus || 'pending',
    evidenceStrength: doc.evidenceStrength || 'unassessed',
    ratingNotice: doc.ratingNotice || '',
    reviewReasons: Array.isArray(doc.reviewReasons) ? doc.reviewReasons.map(normalizeText).filter(Boolean) : [],
    radarAssessment: normalizeRadarAssessment(doc.radarAssessment),
    humanGrade: humanGrade || '',
    humanAssessment: doc.humanAssessment || undefined,
    originalTitle: doc.originalTitle || '',
    aliases,
    localizedTitles,
    allTitles: uniqueTextValues([doc.title, doc.originalTitle, aliases, localizedTitles]),
    mediaGroup: doc.mediaGroup || 'unknown',
    mediaType: doc.mediaType || 'unknown',
    format: doc.format || 'unknown',
    firstPublishedAt: doc.firstPublishedAt || '',
    firstPublishedPrecision: doc.firstPublishedPrecision || '',
    firstPublishedLabel: doc.firstPublishedLabel || '',
    creators: relationshipNames(doc.creators),
    organizations: workOrganizationNames(doc.organizations),
    tags: relationshipNames(doc.tags),
    warnings: relationshipNames(doc.warnings),
    cover: mediaImage(doc.cover),
    hasEvidence: Boolean(doc.hasEvidence),
    evidenceNote: doc.evidenceNote || '',
    sourceLinks: mergedSourceLinks(doc, candidates),
    candidateSources: candidates,
    externalIds: externalIds(doc.externalIds),
    riskMatrix: normalizedRiskMatrix(doc.riskMatrix),
    sections: sections([
      richSection('summary', '摘要', doc.summary),
      richSection('analysis', '分析', doc.analysis),
    ]),
  }
}

function mapCreator(doc) {
  return {
    ...commonFields('creators', doc, doc.name, '创作者'),
    rank: doc.rank || 'unknown',
    reviewStatus: doc.reviewStatus || 'pending',
    reviewOrigin: doc.reviewOrigin || 'unassessed',
    aliases: aliasesToValues(doc.aliases),
    sections: sections([richSection('notes', '备注', doc.notes)]),
  }
}

function mapOrganization(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedNames = Array.isArray(doc.localizedNames)
    ? doc.localizedNames.map((item) => normalizeText(typeof item === 'string' ? item : item?.name)).filter(Boolean)
    : []
  return {
    ...commonFields('organizations', doc, doc.name, '机构'),
    organizationType: doc.type || 'other',
    reviewStatus: doc.reviewStatus || 'pending',
    reviewOrigin: doc.reviewOrigin || 'unassessed',
    aliases: uniqueTextValues([aliases, localizedNames]),
    sections: sections([richSection('notes', '备注', doc.notes)]),
  }
}

function mapEvidence(doc) {
  return {
    ...commonFields('evidence', doc, doc.title, '证据材料'),
    evidenceType: doc.evidenceType || 'other',
    reviewStatus: doc.reviewStatus || 'pending',
    evidenceStrength: doc.evidenceStrength || 'unassessed',
    relatedWorks: relationshipNames(doc.relatedWorks),
    relatedCreators: relationshipNames(doc.relatedCreators),
    relatedOrganizations: relationshipNames(doc.relatedOrganizations),
    image: mediaImage(doc.image),
    description: doc.description || '',
    sourceLinks: sourceLinks(doc.sourceLinks),
    capturedAt: doc.capturedAt || '',
    isPublic: Boolean(doc.isPublic),
    sections: [],
  }
}

function mapTerm(doc) {
  return {
    ...commonFields('terms', doc, doc.name, '名词解释'),
    relatedTerms: relationshipNames(doc.relatedTerms),
    relatedWarnings: relationshipNames(doc.relatedWarnings),
    examples: relationshipNames(doc.examples),
    sections: sections([richSection('definition', '定义', doc.definition)]),
  }
}

function mapRule(doc) {
  return {
    ...commonFields('rules', doc, doc.title, '规则'),
    category: doc.category || 'principle',
    relatedTags: relationshipNames(doc.relatedTags),
    relatedWarnings: relationshipNames(doc.relatedWarnings),
    sections: sections([richSection('body', '正文', doc.body)]),
  }
}

function mapDocument(collection, doc) {
  if (collection === 'works') return mapWork(doc)
  if (collection === 'creators') return mapCreator(doc)
  if (collection === 'organizations') return mapOrganization(doc)
  if (collection === 'evidence') return mapEvidence(doc)
  if (collection === 'terms') return mapTerm(doc)
  if (collection === 'rules') return mapRule(doc)
  throw new Error(`Unsupported collection: ${collection}`)
}

function ensureOutputDir(outFile) {
  const dir = path.dirname(path.resolve(outFile))
  fs.mkdirSync(dir, { recursive: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }

  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const outFile = String(args.out || DEFAULT_OUT)
  const includeDrafts = Boolean(args['include-drafts'])
  const profile = exportProfile(args)
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD

  let token = null
  if (email && password) {
    token = await login(baseUrl, email, password)
  }

  const items = []
  const counts = {}
  const exportWarnings = []

  for (const collection of COLLECTIONS) {
    let docs = []
    try {
      docs = await fetchCollection(baseUrl, token, collection, { includeDrafts, profile })
    } catch (error) {
      if (!OPTIONAL_COLLECTIONS.has(collection)) throw error
      const message = String(error?.message || error).slice(0, 1200)
      exportWarnings.push({ collection, message })
      console.warn(`[warn] skipped optional collection ${collection}: ${message.split('\n')[0]}`)
    }
    counts[collection] = docs.length
    items.push(...docs.map((doc) => mapDocument(collection, doc)))
  }

  const payload = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    profile,
    counts,
    exportWarnings,
    total: items.length,
    items,
  }

  ensureOutputDir(outFile)
  fs.writeFileSync(path.resolve(outFile), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log('Lite detail index generated')
  console.log(JSON.stringify({ out: path.resolve(outFile), counts, total: items.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
