import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')
const layout = read('src/app/(frontend)/me/studio/works/[id]/layout.tsx')
const publishBar = read('src/app/(frontend)/me/studio/works/[id]/StudioPublishBar.tsx')
const stageRoute = read('src/app/(frontend)/api/studio/works/[id]/stage/route.ts')
const lifecycle = read('src/collections/fields/workLifecycle.ts')
const config = read('payload.config.ts')
const migration = read('scripts/migrations/20260721-publish-live-works-and-mark-temporary.sql')
const publishCss = read('src/app/(frontend)/me/studio/works/[id]/StudioPublishBar.module.css')
const editorCss = read('src/app/(frontend)/review-editor.css')

test('every work editor inserts stage actions into the existing sticky save footer', () => {
  assert.match(layout, /StudioPublishBar/u)
  assert.match(layout, /<StudioPublishBar \/>/u)
  assert.match(publishBar, /createPortal/u)
  assert.match(publishBar, /form\.review-editor-form \.review-editor-submit/u)
  assert.match(publishBar, /supersededElements/u)
  assert.match(publishBar, /old\.button\.hidden = true/u)
  assert.match(publishBar, /old\.note\.hidden = true/u)
  assert.match(publishBar, /保存作品/u)
  assert.match(publishBar, /保存为临时作品/u)
  assert.match(publishBar, /保存当前阶段/u)
  assert.match(publishBar, /保存并转为正式作品/u)
  assert.match(publishBar, /form\.requestSubmit\(\)/u)
  assert.match(editorCss, /\.review-editor-submit[\s\S]*position: sticky/u)
  assert.doesNotMatch(publishCss, /top:\s*12px/u)
})

test('temporary and formal stage actions keep every live work published', () => {
  assert.match(stageRoute, /type WorkStage = 'temporary' \| 'formal'/u)
  assert.match(stageRoute, /catalogStatus: stage === 'temporary' \? 'temporary' : 'active'/u)
  assert.match(stageRoute, /_status: 'published'/u)
  assert.match(stageRoute, /isLiteVisible: true/u)
  assert.match(stageRoute, /isFullVisible: true/u)
  assert.match(publishBar, /updateStage\('temporary'\)/u)
  assert.match(publishBar, /updateStage\('formal'\)/u)
  assert.doesNotMatch(publishBar, /setSelect\(form, '_status', 'draft'\)/u)
})

test('work lifecycle protects pipeline-owned AI fields from first-party editing', () => {
  assert.match(lifecycle, /withWorkLifecycleFields/u)
  assert.match(lifecycle, /flags\.firstPartyStudio/u)
  assert.match(lifecycle, /flags\.aiPipelineWrite/u)
  assert.match(lifecycle, /next\.radarAssessment = previous\.radarAssessment/u)
  assert.match(publishBar, /sourceSummary/u)
  assert.match(publishBar, /decisiveRuleCode/u)
  assert.match(config, /withWorkLifecycleFields/u)
  assert.match(editor, /name="_status"/u)
})

test('lifecycle migration publishes live works and marks intake records temporary', () => {
  assert.match(migration, /ADD VALUE IF NOT EXISTS[^\n]*temporary/u)
  assert.match(migration, /SET "catalog_status" = 'temporary'/u)
  assert.match(migration, /SET "_status" = 'published'/u)
  assert.match(migration, /"is_lite_visible" = true/u)
  assert.match(migration, /"is_full_visible" = true/u)
  assert.match(migration, /"rating_notice" = 'ai_synthesized_pending_review'/u)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM/iu)
})
