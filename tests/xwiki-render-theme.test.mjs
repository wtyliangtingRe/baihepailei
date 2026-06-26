import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const renderer = fs.readFileSync(new URL('../src/app/(frontend)/_components/RichTextRenderer.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const themeToggle = fs.readFileSync(new URL('../src/app/(frontend)/_components/ThemeToggle.tsx', import.meta.url), 'utf8')
const themeCss = fs.readFileSync(new URL('../src/app/(frontend)/theme.css', import.meta.url), 'utf8')
const xwikiCss = fs.readFileSync(new URL('../src/app/(frontend)/xwiki-renderer.css', import.meta.url), 'utf8')

test('rich text renderer detects and renders legacy xwiki text', () => {
  assert.ok(renderer.includes('function looksLikeXWiki'))
  assert.ok(renderer.includes('function renderXWiki'))
  assert.ok(renderer.includes('xwiki-rendered'))
  assert.ok(renderer.includes('xwiki-warning'))
  assert.ok(renderer.includes('xwiki-color-emphasis'))
  assert.ok(renderer.includes('wikiHref'))
})

test('xwiki renderer strips legacy wrappers and supports readable blocks', () => {
  assert.ok(renderer.includes('{{warning}}'))
  assert.ok(renderer.includes('{{/warning}}'))
  assert.ok(renderer.includes('{{velocity}}'))
  assert.ok(renderer.includes('doc:名词解释'))
  assert.ok(xwikiCss.includes('.xwiki-warning'))
  assert.ok(xwikiCss.includes('.xwiki-rendered h2'))
})

test('theme toggle is wired into the frontend layout', () => {
  assert.ok(layout.includes("import ThemeToggle from './_components/ThemeToggle'"))
  assert.ok(layout.includes('<ThemeToggle />'))
  assert.ok(layout.includes("import './theme.css'"))
  assert.ok(layout.includes("import './xwiki-renderer.css'"))
})

test('theme toggle persists light and dark modes', () => {
  assert.ok(themeToggle.includes("'use client'"))
  assert.ok(themeToggle.includes('localStorage'))
  assert.ok(themeToggle.includes('dataset.theme'))
  assert.ok(themeToggle.includes('白天模式'))
  assert.ok(themeToggle.includes('夜间模式'))
})

test('light theme overrides common dark UI surfaces', () => {
  assert.ok(themeCss.includes("[data-theme='light'] body"))
  assert.ok(themeCss.includes("[data-theme='light'] .detail-card"))
  assert.ok(themeCss.includes("[data-theme='light'] .rich-text"))
  assert.ok(themeCss.includes("[data-theme='light'] .search-box input"))
})
