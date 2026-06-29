import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const smokeScript = read('scripts/smoke/lite-detail-pages-smoke.mjs')
const packageJson = JSON.parse(read('package.json'))

test('lite detail page smoke covers current canonical routes', () => {
  for (const path of [
    '/works/百合星人奈绪子美眉',
    '/works/百合少女',
    '/works/百合少女-bgm-215570',
    '/evidence',
  ]) {
    assert.ok(smokeScript.includes(path), `missing smoke route: ${path}`)
  }
})

test('lite detail page smoke fails on HTTP errors and object rendering leaks', () => {
  assert.match(smokeScript, /response\.ok/)
  assert.match(smokeScript, /text\.includes\('\[object Object\]'\)/)
  assert.match(smokeScript, /process\.exitCode = 1/)
})

test('package script exposes lite detail page smoke command', () => {
  assert.equal(packageJson.scripts['smoke:lite-details'], 'node scripts/smoke/lite-detail-pages-smoke.mjs')
})
