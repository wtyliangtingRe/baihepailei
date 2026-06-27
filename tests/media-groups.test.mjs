import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mediaGroupForType,
  mediaGroupLabel,
  normalizeMediaGroup,
} from '../tools/source_import/lib/media-groups.mjs'

test('media group helper maps detailed work types to display groups', () => {
  assert.equal(mediaGroupForType('anime'), 'anime')
  assert.equal(mediaGroupForType('manga'), 'manga')
  assert.equal(mediaGroupForType('webtoon'), 'manga')
  assert.equal(mediaGroupForType('novel'), 'novel')
  assert.equal(mediaGroupForType('light_novel'), 'novel')
  assert.equal(mediaGroupForType('game'), 'game')
  assert.equal(mediaGroupForType('visual_novel'), 'game')
  assert.equal(mediaGroupForType('audio_drama'), 'other')
  assert.equal(mediaGroupForType('live_action'), 'other')
  assert.equal(mediaGroupForType('unknown'), 'unknown')
})

test('media group labels are Chinese display labels', () => {
  assert.equal(mediaGroupLabel('anime'), '动画')
  assert.equal(mediaGroupLabel('manga'), '漫画')
  assert.equal(mediaGroupLabel('novel'), '小说')
  assert.equal(mediaGroupLabel('game'), '游戏')
})

test('media group normalization keeps valid explicit groups and infers missing ones', () => {
  assert.equal(normalizeMediaGroup('manga', 'anime'), 'manga')
  assert.equal(normalizeMediaGroup('', 'visual_novel'), 'game')
  assert.equal(normalizeMediaGroup('not-real', 'light_novel'), 'novel')
})
