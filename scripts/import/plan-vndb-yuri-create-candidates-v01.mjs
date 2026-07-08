#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'vndb-yuri-create-candidates-v0.1'
const DEFAULT_INPUT = 'data_local/staging/vndb-work-integration/vndb-work-integration-v01-create-candidates.jsonl'
const DEFAULT_RAW_DIR = 'data_local/raw/vndb'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-yuri-create-candidates'
const DEFAULT_MIN_TAG_RATING = 1

const YURI_TERMS = [
  'yuri',
  'girls love',
  "girl's love",
  "girls' love",
  'shoujo ai',
  'shojo ai',
  'shōjo ai',
  'lesbian',
  'sapphic',
  'female/female',
  'female female',
  'f/f',
  'female homosexual',
  'female homosexuality',
  '百合',
  'ガールズラブ',
  'レズ',
  'レズビアン',
  '女性同士',
  '女同士',
  '女同性',
  '女女',
]

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = { tagId: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      if (key === 'tag-id' || key === 'tagId') args.tagId.push(next)
      else args[key] = next
      i += 1
    }
  }
  return args
}

function walkFiles(input) {
  if (!fs.existsSync(input)) return []
  const stat = fs.statSync(input)
  if (stat.isFile()) return /\.jsonl?$/iu.test(input) ? [input] : []
  if (!stat.isDirectory()) return []
  const out = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (/\.jsonl?$/iu.test(entry.name)) out.push(full)
  }
  return out
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim()
    if (!raw) return []
    if (/\.jsonl$/iu.test(file)) {
      const out = []
      for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
        try { out.push(JSON.parse(line)) } catch {}
      }
      return out
    }
    return [JSON.parse(raw)]
  } catch {
    return []
  }
}

function unwrapValues(value, depth = 0) {
  if (depth > 8) return []
  if (Array.isArray(value)) return value.flatMap((item) => unwrapValues(item, depth + 1))
  if (!value || typeof value !== 'object') return []
  const out = [value]
  for (const key of ['results', 'items', 'docs', 'data', 'tags', 'records', 'rows', 'response', 'body', 'payload', 'result']) {
    if (value[key] && typeof value[key] === 'object') out.push(...unwrapValues(value[key], depth + 1))
  }
  return out
}

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/[\s_\-:：~〜]+/gu, ' ').trim()
}

function tagLabels(tag) {
  return [
    tag?.name,
    tag?.title,
    tag?.label,
    tag?.description,
    tag?.cat,
    tag?.category,
    ...list(tag?.aliases),
  ].map(val).filter(Boolean)
}

function looksLikeTagMeta(tag) {
  if (!tag || typeof tag !== 'object' || Array.isArray(tag)) return false
  if (!/^g\d+$/iu.test(val(tag.id))) return false
  if (!tagLabels(tag).length) return false
  // VN rows contain tag references like {id, rating, spoiler, lie}; those are not metadata.
  if (tagLabels(tag).every((item) => /^g\d+$/iu.test(item))) return false
  return true
}

function isYuriLabel(text) {
  const s = normalizeText(text)
  if (!s) return false
  for (const term of YURI_TERMS) {
    const t = normalizeText(term)
    if (!t) continue
    if (/^[a-z0-9 /']+$/iu.test(t)) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '[\\s_\\-:：~〜]+')
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'iu')
      if (re.test(s)) return true
    } else if (s.includes(t)) return true
  }
  return false
}

function buildTagMeta(rawDir) {
  const files = walkFiles(rawDir)
  const meta = new Map()
  for (const file of files) {
    for (const parsed of readJsonFile(file)) {
      for (const item of unwrapValues(parsed)) {
        if (!looksLikeTagMeta(item)) continue
        const id = val(item.id).toLowerCase()
        if (!meta.has(id)) meta.set(id, { ...item, __inputFile: file })
      }
    }
  }
  return { filesScanned: files.length, meta }
}

function countBy(items, key) {
  const out = {}
  for (const item of items) {
    const value = typeof key === 'function' ? key(item) : item?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function tagRefs(row) {
  return [
    ...list(row?.raw?.tags),
    ...list(row?.createCandidatePreview?.raw?.tags),
    ...list(row?.tags),
  ].filter((item) => item && typeof item === 'object')
}

function contentReasons(row) {
  const warnings = list(row?.warnings).map(val).filter(Boolean)
  const reasons = []
  if (warnings.some((item) => item === 'adultOrMarkedContent=true' || item === 'contentVisibility=adult' || item === 'contentRating=erotica')) reasons.push('adult_or_erotica')
  if (warnings.some((item) => item === 'contentRating=suggestive')) reasons.push('suggestive')
  if (warnings.some((item) => item.startsWith('contentWarning=violence:'))) reasons.push('violence')
  const imageSexual = Number(row?.raw?.image?.sexual ?? row?.createCandidatePreview?.raw?.image?.sexual ?? 0)
  const imageViolence = Number(row?.raw?.image?.violence ?? row?.createCandidatePreview?.raw?.image?.violence ?? 0)
  if (Number.isFinite(imageSexual) && imageSexual >= 1.5) reasons.push('image_sexual_high')
  if (Number.isFinite(imageViolence) && imageViolence >= 1.5) reasons.push('image_violence_high')
  return unique(reasons)
}

function isStrictNewCandidate(row) {
  const blockers = list(row?.blockers).map(val)
  return row?.action === 'vndb_create_candidate_preview'
    && row?.matchBy === 'no_match'
    && blockers.includes('no_existing_work_match')
    && !blockers.some((item) => item.includes('conflict') || item.includes('ambiguous'))
}

function titleOf(row) {
  return val(row?.createCandidatePreview?.title || row?.titleCandidates?.[0] || row?.raw?.title || row?.key)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const rawDir = String(args['raw-dir'] || args.rawDir || DEFAULT_RAW_DIR)
  const outDir = String(args['out-dir'] || args.outDir || DEFAULT_OUT_DIR)
  const minTagRating = Number(args['min-tag-rating'] || args.minTagRating || DEFAULT_MIN_TAG_RATING)

  const rows = readJsonl(input)
  const { filesScanned, meta } = buildTagMeta(rawDir)
  const explicitTagIds = unique(list(args.tagId).flatMap((item) => val(item).split(',')).map((item) => val(item).toLowerCase()).filter(Boolean))
  const yuriTagIdsFromMeta = [...meta.entries()]
    .filter(([, tag]) => tagLabels(tag).some(isYuriLabel))
    .map(([id]) => id)
  const yuriTagIds = unique([...yuriTagIdsFromMeta, ...explicitTagIds])
  const yuriSet = new Set(yuriTagIds)

  const strictNewRows = rows.filter(isStrictNewCandidate)
  const missingRawTags = []
  const nonYuriRows = []
  const yuriRows = []
  const ordinaryRows = []
  const sensitiveRows = []

  for (const row of strictNewRows) {
    const refs = tagRefs(row)
    if (!refs.length) missingRawTags.push(row)
    const yuriMatches = refs
      .map((ref) => ({
        id: val(ref.id).toLowerCase(),
        rating: Number(ref.rating ?? 0),
        spoiler: ref.spoiler,
        lie: ref.lie,
        label: tagLabels(meta.get(val(ref.id).toLowerCase()) || {}).find(Boolean) || '',
      }))
      .filter((ref) => yuriSet.has(ref.id) && Number.isFinite(ref.rating) && ref.rating >= minTagRating)
      .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))

    if (!yuriMatches.length) {
      nonYuriRows.push(row)
      continue
    }

    const reasons = contentReasons(row)
    const planned = {
      ...row,
      yuriCreateCandidate: {
        version: VERSION,
        status: reasons.length ? 'sensitive_create_review' : 'ordinary_create_review',
        title: titleOf(row),
        minTagRating,
        matchedTags: yuriMatches,
        sensitiveReasons: reasons,
        note: 'Report-only. This does not create Works. Use a later allowlist/apply workflow after reviewing candidates and content visibility.',
      },
    }
    yuriRows.push(planned)
    if (reasons.length) sensitiveRows.push(planned)
    else ordinaryRows.push(planned)
  }

  const yuriTagReport = yuriTagIds.map((id) => {
    const tag = meta.get(id)
    return {
      id,
      labels: tag ? tagLabels(tag).slice(0, 12) : [],
      inputFile: tag?.__inputFile || '',
      source: tag ? 'raw_tag_metadata' : 'explicit_or_fallback',
    }
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rawDir,
    rawFilesScanned: filesScanned,
    tagMetaRowsRead: meta.size,
    yuriTagIds,
    yuriTagReport,
    minTagRating,
    inputRowsRead: rows.length,
    strictNewCandidateRows: strictNewRows.length,
    yuriCreateCandidateRows: yuriRows.length,
    ordinaryCreateReviewRows: ordinaryRows.length,
    sensitiveCreateReviewRows: sensitiveRows.length,
    nonYuriStrictNewRows: nonYuriRows.length,
    missingRawTagsRows: missingRawTags.length,
    byYuriTagId: countBy(yuriRows.flatMap((row) => row.yuriCreateCandidate.matchedTags.map((tag) => tag.id)), (item) => item),
    byYuriTagLabel: countBy(yuriRows.flatMap((row) => row.yuriCreateCandidate.matchedTags.map((tag) => tag.label || tag.id)), (item) => item),
    bySensitiveReason: countBy(sensitiveRows.flatMap((row) => row.yuriCreateCandidate.sensitiveReasons), (item) => item),
    outputs: {
      rows: `${outDir}/vndb-yuri-create-candidates-v01.rows.jsonl`,
      ordinary: `${outDir}/vndb-yuri-create-candidates-v01-ordinary-review.jsonl`,
      sensitive: `${outDir}/vndb-yuri-create-candidates-v01-sensitive-review.jsonl`,
      nonYuriSample: `${outDir}/vndb-yuri-create-candidates-v01-non-yuri-sample.jsonl`,
      missingRawTagsSample: `${outDir}/vndb-yuri-create-candidates-v01-missing-raw-tags-sample.jsonl`,
      tagReport: `${outDir}/vndb-yuri-create-candidates-v01-yuri-tag-report.json`,
      summary: `${outDir}/vndb-yuri-create-candidates-v01-summary.json`,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      onlyStrictNoExistingMatch: true,
      conflictsAndAmbiguousMatchesExcluded: true,
      sensitiveRowsSeparatedForVisibilityReview: true,
    },
    nextStep: yuriTagIds.length
      ? 'Review ordinary/sensitive samples. Then create a manual allowlist before any Work creation script.'
      : 'No yuri tag metadata was found. Re-run with --tag-id gXXXX after identifying VNDB yuri/lesbian tag IDs, or fetch VNDB tag metadata into data_local/raw/vndb.',
  }

  writeJsonl(summary.outputs.rows, yuriRows)
  writeJsonl(summary.outputs.ordinary, ordinaryRows)
  writeJsonl(summary.outputs.sensitive, sensitiveRows)
  writeJsonl(summary.outputs.nonYuriSample, nonYuriRows.slice(0, 200))
  writeJsonl(summary.outputs.missingRawTagsSample, missingRawTags.slice(0, 200))
  writeJson(summary.outputs.tagReport, yuriTagReport)
  writeJson(summary.outputs.summary, summary)

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main()
