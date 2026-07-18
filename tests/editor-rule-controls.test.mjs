import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rules = read('src/app/(frontend)/_components/RadarRuleSelector.tsx')
const create = read('src/app/(frontend)/me/studio/works/new/page.tsx')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')

test('editor rule controls keep primary and matched rules separate', () => {
  assert.ok(rules.includes('<select name={decisiveName}'))
  assert.ok(rules.includes('全部命中规则'))
  assert.ok(create.includes('suggestedGrade: suggestedRuleGrade'))
  assert.ok(editor.includes('人工正式分级'))
})
