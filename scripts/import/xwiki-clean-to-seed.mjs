#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT = path.resolve('data/staging/xwiki-staged.json')

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
  node scripts/import/xwiki-clean-to-seed.mjs --index <csv> [--pages-dir <dir>] [--out <json>]

Example:
  pnpm import:xwiki:stage -- --index "D:\\0GitHubtest\\Baihepailei\\_clean_export\\clean_export_index.csv" --pages-dir "D:\\0GitHubtest\\Baihepailei\\_clean_export\\pages" --out "data/staging/xwiki-staged.json"
`)
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (ch === '\r') continue

    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += ch
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''))
  if (!header) return []

  return body.map((values) => {
    const obj = {}
    for (let i = 0; i < header.length; i += 1) {
      obj[header[i]] = values[i] ?? ''
    }
    return obj
  })
}

function slugify(input, fallback = 'item') {
  const raw = String(input || fallback).trim()
  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return ascii || fallback
}

function compactObject(value) {
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue
    if (Array.isArray(item) && item.length === 0) continue
    result[key] = item
  }
  return result
}

function first(row, keys) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

function readExportedContent(row, pagesDir) {
  const inlineContent = first(row, ['content', 'body', '正文'])
  if (inlineContent) return inlineContent

  const exported = first(row, ['exported_file', 'exportedFile', 'file', 'path'])
  if (!exported) return ''

  const candidates = []
  if (path.isAbsolute(exported)) candidates.push(exported)
  if (pagesDir) candidates.push(path.resolve(pagesDir, exported))
  candidates.push(path.resolve(exported))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return readText(candidate)
    }
  }
  return ''
}

function stripFrontMatter(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end === -1) return text
  return text.slice(end + 5).trimStart()
}

function classify(fullName) {
  if (/^Main\.作品\./.test(fullName)) return 'works'
  if (/^Main\.创作者\./.test(fullName)) return 'creators'
  if (/^名词解释\./.test(fullName)) return 'terms'
  if (/^排雷原则\./.test(fullName)) return 'rules'
  if (fullName === 'Main.WebHome') return 'rules'
  return 'rawPages'
}

function inferTitle(row, fullName) {
  const explicit = first(row, ['title', '标题', 'name'])
  if (explicit) return explicit
  const withoutWebHome = fullName.replace(/\.WebHome$/, '')
  const last = withoutWebHome.split('.').pop()
  return last || fullName || 'Untitled'
}

function inferRank(fullName) {
  const match = fullName.match(/([SABCDEF]|AA)级作品/)
  if (match) return match[1]
  if (fullName.includes('垃圾级作品')) return 'trash'
  return 'unknown'
}

function toRichTextPlaceholder(text) {
  if (!text) return undefined
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'text',
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text,
              version: 1,
            },
          ],
        },
      ],
    },
  }
}

function convertRow(row, pagesDir) {
  const fullName = first(row, ['full_name', 'fullName', 'xwikiFullName', 'legacyXWikiPage'])
  const title = inferTitle(row, fullName)
  const rawContent = stripFrontMatter(readExportedContent(row, pagesDir))
  const slug = slugify(first(row, ['slug']) || title || fullName)
  const bucket = classify(fullName)
  const common = {
    title,
    name: title,
    slug,
    legacyXWikiPage: fullName,
    legacy: {
      fullName,
      category: first(row, ['category']),
      reasons: first(row, ['reasons']),
      exportedFile: first(row, ['exported_file', 'exportedFile']),
    },
  }

  if (bucket === 'works') {
    return {
      bucket,
      doc: compactObject({
        title,
        slug,
        rank: inferRank(fullName),
        summary: toRichTextPlaceholder(rawContent),
        legacyXWikiPage: fullName,
        status: 'draft',
      }),
    }
  }

  if (bucket === 'creators') {
    return {
      bucket,
      doc: compactObject({
        name: title,
        slug,
        rank: 'unknown',
        notes: toRichTextPlaceholder(rawContent),
        legacyXWikiPage: fullName,
        status: 'draft',
      }),
    }
  }

  if (bucket === 'terms') {
    return {
      bucket,
      doc: compactObject({
        name: title,
        slug,
        definition: toRichTextPlaceholder(rawContent),
        legacyXWikiPage: fullName,
        status: 'draft',
      }),
    }
  }

  if (bucket === 'rules') {
    return {
      bucket,
      doc: compactObject({
        title,
        slug,
        category: fullName === 'Main.WebHome' ? 'migration' : 'principle',
        body: toRichTextPlaceholder(rawContent),
        legacyXWikiPage: fullName,
        status: 'draft',
      }),
    }
  }

  return {
    bucket,
    doc: compactObject({
      ...common,
      content: rawContent,
    }),
  }
}

function dedupeBySlug(items) {
  const seen = new Map()
  const output = []
  for (const item of items) {
    const base = item.slug || slugify(item.title || item.name)
    let slug = base
    let index = 2
    while (seen.has(slug)) {
      slug = `${base}-${index}`
      index += 1
    }
    seen.set(slug, true)
    output.push({ ...item, slug })
  }
  return output
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.index) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const indexPath = path.resolve(String(args.index))
  const outPath = path.resolve(String(args.out || DEFAULT_OUT))
  const pagesDir = args['pages-dir'] ? path.resolve(String(args['pages-dir'])) : undefined

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Index CSV not found: ${indexPath}`)
  }

  const rows = parseCsv(readText(indexPath))
  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceIndex: indexPath,
      pagesDir: pagesDir || null,
      rowCount: rows.length,
      warning: 'Review this staged JSON before importing. It may contain private old-site content.',
    },
    works: [],
    creators: [],
    terms: [],
    warnings: [],
    tags: [],
    rules: [],
    rawPages: [],
  }

  for (const row of rows) {
    const converted = convertRow(row, pagesDir)
    result[converted.bucket].push(converted.doc)
  }

  result.works = dedupeBySlug(result.works)
  result.creators = dedupeBySlug(result.creators)
  result.terms = dedupeBySlug(result.terms)
  result.rules = dedupeBySlug(result.rules)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

  console.log('Wrote staged import JSON:')
  console.log(outPath)
  console.log(JSON.stringify({
    works: result.works.length,
    creators: result.creators.length,
    terms: result.terms.length,
    rules: result.rules.length,
    rawPages: result.rawPages.length,
  }, null, 2))
}

main()
