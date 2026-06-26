import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../src/app/(frontend)/recommendations/page.tsx', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/app/(frontend)/_components/PersonalRecommendationPanel.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/recommendations.css', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/personalized-recommendations.md', import.meta.url), 'utf8')

test('recommendations page renders personal panel', () => {
  assert.ok(page.includes("import PersonalRecommendationPanel"))
  assert.ok(page.includes('recommendedWorks(items)'))
  assert.ok(page.includes('<PersonalRecommendationPanel recommendations={allRecommendations} />'))
})

test('personal panel reads user lists', () => {
  assert.ok(panel.includes("'use client'"))
  assert.ok(panel.includes('/api/user-lists'))
  assert.ok(panel.includes("credentials: 'include'"))
  assert.ok(panel.includes("listStatus === 'avoid'"))
  assert.ok(panel.includes("listStatus === 'seen'"))
})

test('personal panel filters and labels candidates', () => {
  assert.ok(panel.includes('!avoid.has(work.item.slug)'))
  assert.ok(panel.includes('!seen.has(work.item.slug)'))
  assert.ok(panel.includes('statusLabels'))
  assert.ok(panel.includes('needs_review'))
})

test('personal recommendation styles exist', () => {
  assert.ok(css.includes('.personal-recommendation-panel'))
  assert.ok(css.includes('.personal-rec-summary'))
  assert.ok(css.includes('.personal-rec-card'))
  assert.ok(css.includes("[data-theme='light'] .personal-rec-card"))
})

test('personal recommendation docs describe limits', () => {
  assert.ok(docs.includes('/api/user-lists'))
  assert.ok(docs.includes('avoid'))
  assert.ok(docs.includes('seen'))
  assert.ok(docs.includes('custom weights'))
})
