import test from 'node:test'
import assert from 'node:assert/strict'

import {
  inferCandidateWorkGroup,
  inferWorkGroupBaseTitle,
  normalizeWorkGroup,
} from '../tools/source_import/lib/work-groups.mjs'

test('work group base title removes season and variant suffixes', () => {
  assert.equal(inferWorkGroupBaseTitle('摇曳百合♪♪'), '摇曳百合')
  assert.equal(inferWorkGroupBaseTitle('摇曳百合 3☆High!'), '摇曳百合')
  assert.equal(inferWorkGroupBaseTitle('摇曳百合 夏日时光!+'), '摇曳百合')
  assert.equal(inferWorkGroupBaseTitle('摇曳百合、'), '摇曳百合')
  assert.equal(inferWorkGroupBaseTitle('百合星人奈绪子 OVA'), '百合星人奈绪子')
})

test('candidate work group inference creates review-only grouping hints', () => {
  const group = inferCandidateWorkGroup({
    title: '摇曳百合 3☆High!',
    originalTitle: 'ゆるゆり さん☆ハイ!',
  })

  assert.equal(group.key, '摇曳百合')
  assert.equal(group.title, '摇曳百合')
  assert.equal(group.relation, 'series_member')
  assert.equal(group.source, 'title_heuristic')
  assert.equal(group.confidence, 'title_variant')
})

test('explicit work group metadata is normalized and preserved', () => {
  const group = normalizeWorkGroup({
    key: 'Yuru Yuri',
    title: '摇曳百合',
    relation: 'season',
    orderLabel: 'TV 1期',
  })

  assert.equal(group.key, 'yuru-yuri')
  assert.equal(group.title, '摇曳百合')
  assert.equal(group.relation, 'season')
  assert.equal(group.orderLabel, 'TV 1期')
})
