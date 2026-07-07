#!/usr/bin/env node
import fs from 'node:fs'

const VERSION = 'mangadex-ndl-work-integration-apply-v0.3'
const DEFAULT_INPUT = 'data_local/staging/mangadex-ndl-integration/mangadex-ndl-work-integration-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/mangadex-ndl-integration'
const CONFIRM = 'apply-mangadex-ndl-work-integration-v01'
const ALLOWED_ACTIONS = new Set([
  'enrich_existing_bangumi_work',
  'enrich_primary_title_matched_bangumi_work',
  'enrich_title_matched_bangumi_work',
])
const ALLOWED_SOURCE_LINK_LABELS = new Set([
  'MangaDex',
  'AniList via MangaDex',
  'MyAnimeList via MangaDex',
  'MangaUpdates via MangaDex',
  'Raw link via MangaDex',
  'NDL',
])
const ALLOWED_CANDIDATE_SOURCES = new Set(['mangadex', 'ndl'])
const REVIEW_WARNING_BLOCKERS = new Set([
  'creator_diff_or_missing',
  'publisher_diff_or_missing',
  'year_diff_or_missing',
])
const NON_SAFE_MANGADEX_RATINGS = new Set(['suggestive', 'erotica', 'pornographic'])

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i += 1
    }
  }
  return out
}

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function normalizeUrl(value) {
  return val(value).replace(/\/+$/u, '')
}

function cleanLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

async function json(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 800)}`)
  return payload
}

function uniqueSearchTextLines(existingSearchText, additions) {
  const existing = val(existingSearchText)
  const lines = existing ? existing.split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) : []
  const seen = new Set(lines.map(normalizeText).filter(Boolean))
  const accepted = [...lines]
  const added = []
  for (const item of additions || []) {
    const line = cleanLine(item)
    const key = normalizeText(line)
    if (!key || seen.has(key)) continue
    seen.add(key)
    accepted.push(line)
    added.push(line)
  }
  return {
    value: accepted.join('\n'),
    added,
  }
}

function existingSourceLinks(doc) {
  return (Array.isArray(doc?.sourceLinks) ? doc.sourceLinks : [])
    .map((item) => ({ label: val(item?.label), url: normalizeUrl(item?.url) }))
    .filter((item) => item.url)
}

function sourceLinksToAdd(doc, additions) {
  const existing = existingSourceLinks(doc)
  const seen = new Set(existing.map((item) => normalizeUrl(item.url)))
  const out = []
  for (const item of Array.isArray(additions) ? additions : []) {
    const label = cleanLine(item?.label)
    const url = normalizeUrl(item?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ label: label || 'Source', url })
  }
  return { value: [...existing, ...out], added: out }
}

function existingCandidateSources(doc) {
  return (Array.isArray(doc?.candidateSources) ? doc.candidateSources : [])
    .map((item) => ({
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: normalizeUrl(item?.url),
      fetchedAt: item?.fetchedAt,
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function candidateSourceKey(item) {
  return [val(item?.source), val(item?.externalId), normalizeUrl(item?.url)].join('|')
}

function candidateSourcesToAdd(doc, additions) {
  const existing = existingCandidateSources(doc)
  const seen = new Set(existing.map(candidateSourceKey))
  const out = []
  for (const item of Array.isArray(additions) ? additions : []) {
    const source = val(item?.source)
    const label = cleanLine(item?.label)
    const externalId = cleanLine(item?.externalId)
    const url = normalizeUrl(item?.url)
    if (!source && !externalId && !url) continue
    const next = {
      source,
      label,
      externalId,
      url,
      note: cleanLine(item?.note),
    }
    const key = candidateSourceKey(next)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }
  return { value: [...existing, ...out], added: out }
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function contentRatingFromNote(note) {
  const match = val(note).match(/contentRating=([^;]+)/iu)
  return val(match?.[1]).toLowerCase()
}

function titleLooksLikeDoujinshiOrLooseExtra(value) {
  const text = normalizeText(value)
  return /\bdoujinshi\b|\bdj\b|同人/u.test(text)
}

function titleLooksLikeShortLooseFragment(value) {
  const text = cleanLine(value)
  if (!text) return false
  if (/[^\x00-\x7F]/u.test(text)) return false
  const alnum = text.replace(/[^\p{L}\p{N}]+/gu, '')
  const words = text.split(/\s+/u).filter(Boolean)
  return alnum.length > 0 && alnum.length <= 3 && words.length <= 1
}

function validatePlan(plan, options) {
  const blockers = []
  const warnings = Array.isArray(plan?.warnings) ? plan.warnings.map(val).filter(Boolean) : []
  const searchTextAdditions = Array.isArray(plan?.fieldAdditions?.searchTextAdditions) ? plan.fieldAdditions.searchTextAdditions : []
  const sourceLinks = Array.isArray(plan?.fieldAdditions?.sourceLinks) ? plan.fieldAdditions.sourceLinks : []
  const candidateSources = Array.isArray(plan?.fieldAdditions?.candidateSources) ? plan.fieldAdditions.candidateSources : []

  if (plan?.planStatus !== 'ready_for_apply_review') blockers.push('not_ready_for_apply_review')
  if (!ALLOWED_ACTIONS.has(val(plan?.action))) blockers.push('unsupported_action')
  if (Array.isArray(plan?.blockers) && plan.blockers.length) blockers.push('plan_has_blockers')
  if (!val(plan?.work?.id)) blockers.push('missing_work_id')
  if (plan?.createCandidatePreview) blockers.push('create_candidate_preview_not_allowed_for_apply')

  if (options.strictReviewWarnings) {
    for (const warning of warnings) {
      if (REVIEW_WARNING_BLOCKERS.has(warning)) blockers.push(`review_warning_requires_manual_review:${warning}`)
    }
  }

  if (options.doujinshiTitleGuard) {
    for (const title of searchTextAdditions) {
      if (titleLooksLikeDoujinshiOrLooseExtra(title)) blockers.push('doujinshi_or_loose_extra_title_requires_manual_review')
    }
  }

  for (const link of sourceLinks) {
    if (!ALLOWED_SOURCE_LINK_LABELS.has(val(link?.label))) blockers.push(`unsupported_source_link_label:${val(link?.label) || 'missing'}`)
    if (!/^https?:\/\//iu.test(val(link?.url))) blockers.push('invalid_source_link_url')
  }

  for (const source of candidateSources) {
    const sourceName = val(source?.source)
    if (!ALLOWED_CANDIDATE_SOURCES.has(sourceName)) blockers.push(`unsupported_candidate_source:${sourceName || 'missing'}`)
    if (source?.url && !/^https?:\/\//iu.test(val(source.url))) blockers.push('invalid_candidate_source_url')
    if (options.safeContentRatingOnly && sourceName === 'mangadex') {
      const rating = contentRatingFromNote(source?.note)
      if (rating && NON_SAFE_MANGADEX_RATINGS.has(rating)) blockers.push(`mangadex_content_rating_requires_manual_review:${rating}`)
    }
  }

  return [...new Set(blockers)]
}

function validateDiffAdditions(row, options) {
  const blockers = []
  if (options.searchTextOnlyFirstPass && (row.additions.sourceLinks.length || row.additions.candidateSources.length)) {
    blockers.push('source_metadata_requires_manual_review')
  }
  if (options.shortFragmentGuard) {
    for (const title of row.additions.searchText) {
      if (titleLooksLikeShortLooseFragment(title)) blockers.push('short_search_text_fragment_requires_manual_review')
    }
  }
  return blockers
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const options = {
    strictReviewWarnings: !Boolean(args['allow-review-warnings']),
    safeContentRatingOnly: !Boolean(args['allow-non-safe-content-rating']),
    doujinshiTitleGuard: !Boolean(args['allow-doujinshi-title']),
    shortFragmentGuard: !Boolean(args['allow-short-fragments']),
    searchTextOnlyFirstPass: !Boolean(args['allow-source-metadata']),
  }
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)

  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const login = await json(`${base}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) })
  const token = login?.token
  if (!token) throw new Error('Payload login did not return a token')
  const auth = { Authorization: `JWT ${token}` }

  const plans = readJsonl(input)
  const rows = []
  let wouldPatch = 0
  let patched = 0
  let alreadyCurrent = 0
  let blocked = 0
  let failed = 0
  let payloadPatchRequests = 0

  for (const plan of plans) {
    const row = {
      key: val(plan?.key),
      workId: val(plan?.work?.id),
      workTitle: val(plan?.work?.title),
      action: val(plan?.action),
      status: '',
      mode: apply ? 'apply' : 'dry-run',
      blockers: validatePlan(plan, options),
      warnings: Array.isArray(plan?.warnings) ? plan.warnings : [],
      changedFields: [],
      additions: {
        searchText: [],
        sourceLinks: [],
        candidateSources: [],
      },
      diffReport: plan?.diffReport || null,
    }

    try {
      if (!row.blockers.length) {
        const doc = await json(`${base}/api/works/${encodeURIComponent(row.workId)}?depth=0&draft=true`, { headers: auth })
        const work = doc?.doc || doc
        if (!work?.id) row.blockers.push('work_not_found')
        else {
          const searchText = uniqueSearchTextLines(work.searchText, plan?.fieldAdditions?.searchTextAdditions || [])
          const sourceLinks = sourceLinksToAdd(work, plan?.fieldAdditions?.sourceLinks || [])
          const candidateSources = candidateSourcesToAdd(work, plan?.fieldAdditions?.candidateSources || [])

          row.additions.searchText = searchText.added
          row.additions.sourceLinks = sourceLinks.added
          row.additions.candidateSources = candidateSources.added

          const body = {}
          if (searchText.added.length) {
            body.searchText = searchText.value
            row.changedFields.push('searchText')
          }
          if (sourceLinks.added.length) {
            body.sourceLinks = sourceLinks.value
            row.changedFields.push('sourceLinks')
          }
          if (candidateSources.added.length) {
            body.candidateSources = candidateSources.value
            row.changedFields.push('candidateSources')
          }

          row.blockers.push(...validateDiffAdditions(row, options))
          row.blockers = [...new Set(row.blockers)]

          if (row.blockers.length) {
            row.status = 'blocked'
            blocked += 1
          } else if (!row.changedFields.length) {
            row.status = 'already_current'
            alreadyCurrent += 1
          } else if (apply) {
            payloadPatchRequests += 1
            await json(`${base}/api/works/${encodeURIComponent(row.workId)}?draft=true`, {
              method: 'PATCH',
              headers: auth,
              body: JSON.stringify(body),
            })
            row.status = 'patched'
            patched += 1
          } else {
            row.status = 'would_patch'
            wouldPatch += 1
          }
        }
      }

      if (row.blockers.length && row.status !== 'blocked') {
        row.status = 'blocked'
        blocked += 1
      }
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 800))
      failed += 1
    }
    rows.push(row)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outputs = {
    rows: `${outDir}/mangadex-ndl-work-integration-apply-v01.rows.jsonl`,
    wouldPatch: `${outDir}/mangadex-ndl-work-integration-apply-v01-would-patch.jsonl`,
    blocked: `${outDir}/mangadex-ndl-work-integration-apply-v01-blocked.jsonl`,
    summary: `${outDir}/mangadex-ndl-work-integration-apply-v01-summary.json`,
  }
  const actionableRows = rows.filter((row) => row.status === 'would_patch' || row.status === 'patched')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    mode: apply ? 'apply' : 'dry-run',
    payloadBaseUrl: base,
    inputFile: input,
    options,
    plansRead: plans.length,
    wouldPatch,
    patched,
    alreadyCurrent,
    blocked,
    failed,
    byStatus: countBy(rows, 'status'),
    byAction: countBy(rows, 'action'),
    byChangedField: countBy(actionableRows.flatMap((row) => row.changedFields), (item) => item),
    byWarning: countBy(rows.flatMap((row) => row.warnings), (item) => item),
    byBlocker: countBy(rows.flatMap((row) => row.blockers), (item) => item),
    outputs,
    safety: {
      applyRequested: apply,
      confirmMatched,
      payloadRead: true,
      payloadWrite: apply,
      payloadPatchRequests,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      defaultConservativeGuards: {
        strictReviewWarnings: options.strictReviewWarnings,
        safeContentRatingOnly: options.safeContentRatingOnly,
        doujinshiTitleGuard: options.doujinshiTitleGuard,
        shortFragmentGuard: options.shortFragmentGuard,
        searchTextOnlyFirstPass: options.searchTextOnlyFirstPass,
      },
      changedFieldsAllowed: ['searchText', 'sourceLinks', 'candidateSources'],
      defaultFirstPassWritableFields: ['searchText'],
      sourceMetadataRequiresOptIn: true,
      doesNotWrite: ['title', 'originalTitle', 'aliases', 'localizedTitles', 'creators', 'creatorCredits', 'organizations', 'mediaGroup', 'mediaType', 'reviewStatus', 'riskMatrix'],
    },
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldPatch, rows.filter((row) => row.status === 'would_patch'))
  writeJsonl(outputs.blocked, rows.filter((row) => row.status === 'blocked' || row.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')

  console.log(JSON.stringify({ ok: failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
