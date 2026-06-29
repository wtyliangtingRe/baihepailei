#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const DEFAULT_PATHS = [
  '/works/百合星人奈绪子美眉',
  '/works/百合少女',
  '/works/百合少女-bgm-215570',
  '/evidence',
]

function parseArgs(argv) {
  const args = { paths: [] }

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[i + 1]

    if (key === 'path') {
      if (!next || next.startsWith('--')) throw new Error('--path requires a value')
      args.paths.push(next)
      i += 1
      continue
    }

    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }

  return args
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function pathToUrl(baseUrl, path) {
  return new URL(path, `${baseUrl}/`).toString()
}

async function checkPage(baseUrl, path) {
  const url = pathToUrl(baseUrl, path)
  const response = await fetch(url)
  const text = await response.text()
  const hasObjectObject = text.includes('[object Object]')

  return {
    path,
    url,
    status: response.status,
    ok: response.ok,
    hasObjectObject,
  }
}

function printResult(result) {
  const status = result.ok && !result.hasObjectObject ? 'OK' : 'FAIL'
  console.log(`${status} ${result.status} objectObject=${result.hasObjectObject} ${result.url}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = normalizeBaseUrl(args.url)
  const paths = args.paths.length ? args.paths : DEFAULT_PATHS

  const results = []
  for (const path of paths) {
    const result = await checkPage(baseUrl, path)
    results.push(result)
    printResult(result)
  }

  const failures = results.filter((result) => !result.ok || result.hasObjectObject)
  if (failures.length) {
    console.error(`Lite detail page smoke failed: ${failures.length}/${results.length} page(s) failed.`)
    process.exitCode = 1
    return
  }

  console.log(`Lite detail page smoke passed: ${results.length}/${results.length} page(s).`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
