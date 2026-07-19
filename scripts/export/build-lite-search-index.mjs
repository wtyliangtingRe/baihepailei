#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT = 'public/search-index.json'
const COLLECTIONS = ['works', 'creators', 'organizations', 'evidence', 'terms', 'rules']
const OPTIONAL_COLLECTIONS = new Set(['evidence'])
const RESEARCH_COLLECTION = 'radar-research-records'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')
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
  pnpm export:lite-search -- [--url http://localhost:3000] [--out public/search-index.json] [--include-drafts] [--profile full|lite]
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

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
  })

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

function visibilityParams(collection, includeDrafts, profile) {
  const params = new URLSearchParams()
  params.set('limit', PAGE_LIMIT)
  params.set('depth', '1')

  if (includeDrafts) {
    params.set('draft', 'true')
  } else if (collection === 'evidence') {
    params.set('where[status][equals]', 'confirmed')
    params.set('where[isPublic][equals]', 'true')
  } else {
    params.set('where[status][equals]', 'published')
  }

  // The complete profile is intentionally exhaustive. Old imported rows often
  // have null visibility flags, and SQL `not_equals false` excludes those rows.
  // Only the explicitly reduced Lite profile applies a visibility boundary.
  if (collection !== 'evidence' && profile === 'lite') {
    params.set('where[isLiteVisible][not_equals]', 'false')
  }

  return params
}

async function fetchCollection(baseUrl, token, collection, { includeDrafts, profile }) {
  const fetchPages = async (drafts) => {
    const docs = []
    let page = 1
    let totalPages = 1

    do {
      const params = visibilityParams(collection, drafts, profile)
      params.set('page', String(page))

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

async function fetchResearchRecords(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams()
    params.set('limit', PAGE_LIMIT)
    params.set('depth', '0')
    params.set('page', String(page))
    params.set('where[recordStatus][equals]', 'current')
    const result = await requestJson(`${baseUrl}/api/${RESEARCH_COLLECTION}?${params.toString()}`, {
      headers: authHeaders(token),
    })
    docs.push(...(result?.docs || []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
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
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
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

function localizedNameValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.name))
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

function uniqueValues(values) {
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

function relationshipID(value) {
  if (value && typeof value === 'object') return String(value.id || '')
  return value === undefined || value === null ? '' : String(value)
}

function researchPreview(value) {
  if (!value || typeof value !== 'object') return undefined
  return {
    researchStatus: optionalText(value.researchStatus),
    yuriRelevance: optionalText(value.yuriRelevance),
    riskSignals: Array.isArray(value.riskSignals) ? value.riskSignals.map(normalizeText).filter(Boolean) : [],
    likelyGrade: optionalText(value.proposedLikelyGrade)?.toUpperCase(),
    bestGrade: optionalText(value.proposedBestGrade)?.toUpperCase(),
    worstGrade: optionalText(value.proposedWorstGrade)?.toUpperCase(),
    sourceSummary: optionalText(value.sourceSummary)?.slice(0, 1600),
    sourceCount: Array.isArray(value.sources) ? value.sources.filter((item) => item?.url).length : 0,
    unresolvedQuestionCount: Array.isArray(value.unresolvedQuestions) ? value.unresolvedQuestions.length : 0,
    confidencePercent: optionalPercent(value.confidencePercent),
    recommendedNextAction: optionalText(value.recommendedNextAction),
    recommendedNextQueue: optionalText(value.recommendedNextQueue),
    importedAt: optionalText(value.importedAt),
  }
}

function buildSearchBlob(parts) {
  return uniqueValues(parts).join('\n')
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

function sourceNotes(doc) {
  return Array.isArray(doc?.candidateSources)
    ? doc.candidateSources.map((item) => normalizeText(item?.note)).filter(Boolean)
    : []
}

function candidateSourceValues(doc) {
  if (!Array.isArray(doc?.candidateSources)) return []
  return doc.candidateSources.flatMap((item) => [item?.source, item?.label, item?.externalId, item?.url, item?.note])
}

function externalIdValues(doc) {
  if (!doc?.externalIds || Array.isArray(doc.externalIds) || typeof doc.externalIds !== 'object') return []
  return Object.entries(doc.externalIds).flatMap(([key, value]) => [key, value])
}

function deriveContentAdvisories({ tags, warnings, notes, searchText }) {
  const haystack = [tags, warnings, notes, searchText].flat().join('\n').toLowerCase()
  const advisories = []

  if (/contentrating=suggestive|\bsuggestive\b|擦边|暗示性/u.test(haystack)) advisories.push('suggestive')
  if (/contentrating=erotica|\berotica\b|情色|成人向/u.test(haystack)) advisories.push('erotica')
  if (/contentrating=pornographic|\bpornographic\b|色情|成人内容|18禁|r-?18/u.test(haystack)) advisories.push('pornographic')
  if (/doujinshi|同人志|同人本|loose extra/u.test(haystack)) advisories.push('doujinshi_or_extra')
  if (/不宜展示|敏感内容|restricted|hidden|quarantine/u.test(haystack)) advisories.push('restricted')

  return uniqueValues(advisories)
}

function contentVisibilityFromAdvisories(advisories) {
  if (advisories.includes('restricted')) return 'restricted'
  if (advisories.some((item) => ['suggestive', 'erotica', 'pornographic', 'doujinshi_or_extra'].includes(item))) return 'adult'
  return 'ordinary'
}

function mapWork(doc) {
  const explicitHumanGrade = String(doc.humanAssessment?.grade || '').trim().toUpperCase()
  const legacyHumanGrade = (doc.reviewStatus === 'reviewed' || doc.ratingNotice === 'manual_reviewed') ? String(doc.rank || '').trim().toUpperCase() : ''
  const humanGrade = explicitHumanGrade || legacyHumanGrade
  const aiGrade = String(doc.radarAssessment?.suggestedGrade || '').trim().toUpperCase()
  const effectiveRank = humanGrade || aiGrade || doc.rank || 'unknown'
  const aliases = aliasesToValues(doc.aliases)
  const localizedTitles = localizedTitleValues(doc.localizedTitles)
  const creators = relationshipNames(doc.creators)
  const organizations = workOrganizationNames(doc.organizations)
  const tags = relationshipNames(doc.tags)
  const warnings = relationshipNames(doc.warnings)
  const summaryText = richTextToPlainText(doc.summary)
  const analysisText = richTextToPlainText(doc.analysis)
  const notes = sourceNotes(doc)
  const contentAdvisories = deriveContentAdvisories({ tags, warnings, notes, searchText: doc.searchText })
  const contentVisibility = contentVisibilityFromAdvisories(contentAdvisories)

  return {
    id: `works:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'works',
    typeLabel: '作品',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('works', doc.id, doc.slug),
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
    mediaGroup: doc.mediaGroup || 'unknown',
    mediaType: doc.mediaType || 'unknown',
    format: doc.format || 'unknown',
    firstPublishedLabel: doc.firstPublishedLabel || '',
    creators,
    organizations,
    tags,
    warnings,
    contentVisibility,
    contentAdvisories,
    cover: mediaImage(doc.cover),
    searchText: buildSearchBlob([
      doc.title,
      doc.originalTitle,
      aliases,
      localizedTitles,
      creators,
      organizations,
      tags,
      warnings,
      effectiveRank,
      humanGrade,
      aiGrade,
      doc.mediaGroup,
      doc.mediaType,
      doc.format,
      doc.firstPublishedLabel,
      doc.searchText,
      notes,
      candidateSourceValues(doc),
      externalIdValues(doc),
      summaryText,
      analysisText,
    ]),
  }
}

function mapCreator(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedNames = localizedNameValues(doc.localizedNames)
  const notesText = richTextToPlainText(doc.notes)

  return {
    id: `creators:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'creators',
    typeLabel: '创作者',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('creators', doc.id, doc.slug),
    rank: doc.rank || 'unknown',
    reviewStatus: doc.reviewStatus || 'pending',
    reviewOrigin: doc.reviewOrigin || 'unassessed',
    aliases,
    localizedNames,
    searchText: buildSearchBlob([doc.name, aliases, localizedNames, doc.rank, doc.searchText, notesText]),
  }
}

function mapOrganization(doc) {
  const aliases = aliasesToValues(doc.aliases)
  const localizedNames = localizedNameValues(doc.localizedNames)
  const notesText = richTextToPlainText(doc.notes)

  return {
    id: `organizations:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'organizations',
    typeLabel: '机构',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('organizations', doc.id, doc.slug),
    organizationType: doc.type || 'other',
    reviewStatus: doc.reviewStatus || 'pending',
    reviewOrigin: doc.reviewOrigin || 'unassessed',
    aliases,
    localizedNames,
    searchText: buildSearchBlob([doc.name, aliases, localizedNames, doc.type, doc.searchText, notesText]),
  }
}

function mapEvidence(doc) {
  const relatedWorks = relationshipNames(doc.relatedWorks)
  const relatedCreators = relationshipNames(doc.relatedCreators)
  const relatedOrganizations = relationshipNames(doc.relatedOrganizations)

  return {
    id: `evidence:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'evidence',
    typeLabel: '证据材料',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('evidence', doc.id, doc.slug),
    evidenceType: doc.evidenceType || 'other',
    reviewStatus: doc.reviewStatus || 'pending',
    evidenceStrength: doc.evidenceStrength || 'unassessed',
    relatedWorks,
    relatedCreators,
    relatedOrganizations,
    image: mediaImage(doc.image),
    searchText: buildSearchBlob([doc.title, doc.evidenceType, relatedWorks, relatedCreators, relatedOrganizations, doc.description, doc.searchText]),
  }
}

function mapTerm(doc) {
  const definitionText = richTextToPlainText(doc.definition)
  const relatedTerms = relationshipNames(doc.relatedTerms)
  const relatedWarnings = relationshipNames(doc.relatedWarnings)

  return {
    id: `terms:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'terms',
    typeLabel: '名词解释',
    title: doc.name || '',
    slug: doc.slug || '',
    url: itemUrl('terms', doc.id, doc.slug),
    relatedTerms,
    relatedWarnings,
    searchText: buildSearchBlob([doc.name, relatedTerms, relatedWarnings, doc.searchText, definitionText]),
  }
}

function mapRule(doc) {
  const bodyText = richTextToPlainText(doc.body)
  const relatedTags = relationshipNames(doc.relatedTags)
  const relatedWarnings = relationshipNames(doc.relatedWarnings)

  return {
    id: `rules:${doc.slug}`,
    recordId: String(doc.id),
    collection: 'rules',
    typeLabel: '规则',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl('rules', doc.id, doc.slug),
    category: doc.category || 'principle',
    relatedTags,
    relatedWarnings,
    searchText: buildSearchBlob([doc.title, doc.category, relatedTags, relatedWarnings, doc.searchText, bodyText]),
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

function countBy(items, getKey) {
  const counts = {}
  for (const item of items) {
    const key = getKey(item) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function exportWarning(collection, error) {
  const message = String(error?.message || error)
  return {
    collection,
    message: message.slice(0, 1200),
  }
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
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  let token = null
  if (email && secret) {
    token = await login(baseUrl, email, secret)
  }

  const items = []
  const counts = {}
  const exportWarnings = []
  const researchByWorkID = new Map()

  if (profile === 'full') {
    try {
      const researchRecords = await fetchResearchRecords(baseUrl, token)
      counts[RESEARCH_COLLECTION] = researchRecords.length
      for (const record of researchRecords) {
        const workID = relationshipID(record.work) || String(record.workIdSnapshot || '')
        if (workID) researchByWorkID.set(workID, researchPreview(record))
      }
    } catch (error) {
      const warning = exportWarning(RESEARCH_COLLECTION, error)
      exportWarnings.push(warning)
      counts[RESEARCH_COLLECTION] = 0
      console.warn(`[warn] skipped internal AI research preview enrichment: ${warning.message.split('\n')[0]}`)
    }
  }

  for (const collection of COLLECTIONS) {
    let docs = []
    try {
      docs = await fetchCollection(baseUrl, token, collection, { includeDrafts, profile })
    } catch (error) {
      if (!OPTIONAL_COLLECTIONS.has(collection)) throw error
      const warning = exportWarning(collection, error)
      exportWarnings.push(warning)
      console.warn(`[warn] skipped optional collection ${collection}: ${warning.message.split('\n')[0]}`)
    }

    counts[collection] = docs.length
    items.push(...docs.map((doc) => {
      const item = mapDocument(collection, doc)
      if (collection === 'works') {
        item.researchPreview = researchByWorkID.get(String(doc.id))
        if (item.researchPreview) {
          item.searchText = buildSearchBlob([
            item.searchText,
            item.researchPreview.sourceSummary,
            item.researchPreview.riskSignals,
            item.researchPreview.likelyGrade,
            item.researchPreview.bestGrade,
            item.researchPreview.worstGrade,
          ])
        }
      }
      return item
    }))
  }

  const payload = {
    schemaVersion: 5,
    generatedAt: new Date().toISOString(),
    source: baseUrl,
    mode: includeDrafts ? 'drafts-and-published' : 'published-only',
    profile,
    counts,
    visibilityCounts: countBy(items.filter((item) => item.collection === 'works'), (item) => item.contentVisibility || 'ordinary'),
    exportWarnings,
    total: items.length,
    items,
  }

  ensureOutputDir(outFile)
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${items.length} items to ${outFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
