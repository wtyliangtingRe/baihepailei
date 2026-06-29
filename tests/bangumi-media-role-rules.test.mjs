import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bangumiSubjectCreatorCreditHints,
  bangumiSubjectOrganizationCreditHints,
} from '../tools/source_import/sources/bangumi.mjs'

function hasRow(rows, expected) {
  return rows.some((row) => Object.entries(expected).every(([key, value]) => row[key] === value))
}

test('book infobox role rules extract creators and organizations', () => {
  const subject = {
    type: 1,
    infobox: [
      { key: '作者', value: 'Book Author' },
      { key: '作画', value: 'Manga Artist' },
      { key: '插画', value: 'Illustrator A / Illustrator B' },
      { key: '出版社', value: 'Publisher House' },
      { key: '连载杂志', value: 'Yuri Magazine' },
      { key: '文库', value: 'Light Novel Label' },
    ],
  }

  const creators = bangumiSubjectCreatorCreditHints(subject)
  const organizations = bangumiSubjectOrganizationCreditHints(subject)

  assert.ok(hasRow(creators, { name: 'Book Author', role: 'original_creator', originalRole: '作者' }))
  assert.ok(hasRow(creators, { name: 'Manga Artist', role: 'art', originalRole: '作画' }))
  assert.ok(hasRow(creators, { name: 'Illustrator A', role: 'illustration', originalRole: '插画' }))
  assert.ok(hasRow(creators, { name: 'Illustrator B', role: 'illustration', originalRole: '插画' }))

  assert.ok(hasRow(organizations, { name: 'Publisher House', role: 'publisher', originalRole: '出版社' }))
  assert.ok(hasRow(organizations, { name: 'Yuri Magazine', role: 'magazine', originalRole: '连载杂志' }))
  assert.ok(hasRow(organizations, { name: 'Light Novel Label', role: 'imprint', originalRole: '文库' }))
})

test('game infobox role rules extract creators and organizations', () => {
  const subject = {
    type: 4,
    infobox: [
      { key: '剧本', value: 'Scenario Writer' },
      { key: '原画', value: 'Game Artist' },
      { key: '企画', value: 'Planner' },
      { key: '开发', value: 'Dev Studio' },
      { key: '发行商', value: 'Game Publisher' },
      { key: '平台', value: 'PC / Nintendo Switch' },
    ],
  }

  const creators = bangumiSubjectCreatorCreditHints(subject)
  const organizations = bangumiSubjectOrganizationCreditHints(subject)

  assert.ok(hasRow(creators, { name: 'Scenario Writer', role: 'script', originalRole: '剧本' }))
  assert.ok(hasRow(creators, { name: 'Game Artist', role: 'character_design', originalRole: '原画' }))
  assert.ok(hasRow(creators, { name: 'Planner', role: 'planning', originalRole: '企画' }))

  assert.ok(hasRow(organizations, { name: 'Dev Studio', role: 'developer', originalRole: '开发' }))
  assert.ok(hasRow(organizations, { name: 'Game Publisher', role: 'distributor', originalRole: '发行商' }))
  assert.ok(hasRow(organizations, { name: 'PC', role: 'platform', originalRole: '平台' }))
  assert.ok(hasRow(organizations, { name: 'Nintendo Switch', role: 'platform', originalRole: '平台' }))
})
