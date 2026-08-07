import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const standardization = await import('../src/lib/radar/readStandardization.ts')
const effective = await import('../src/lib/radar/effectiveWorkGrade.ts')

const identity = { workId: '42', siteId: 'BGM-100' }
const exact = { workIdSnapshot: '42', workSiteId: 'BGM-100' }

function published(grade = 'A') {
  return {
    record: { ...exact, identityKey: '42|BGM-100', recordStatus: 'current' },
    rating: {
      ...exact,
      identityKey: '42|BGM-100',
      recordStatus: 'current',
      coreGrade: grade,
      bestGrade: grade,
      likelyGrade: grade,
      worstGrade: grade,
    },
  }
}

function candidate(grade = 'B') {
  return {
    ...exact,
    recordStatus: 'current',
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
  }
}

test('Published authority wins without erasing a coexisting Candidate', () => {
  const snapshot = { identity, published: published('A'), candidate: candidate('B') }
  const selected = standardization.selectRadarAuthority(snapshot)
  assert.equal(selected.authority, 'published')
  assert.equal(selected.gradeState.grade, 'A')
  assert.equal(selected.snapshot.candidate.compatibilityGrade, 'B')
})

test('Candidate remains pending and preserves Research as a separate lineage', () => {
  const research = { ...exact, recordStatus: 'current', proposedLikelyGrade: 'C' }
  const snapshot = {
    identity,
    candidate: candidate('B'),
    research: { latest: research, history: [research] },
  }
  const selected = standardization.selectRadarAuthority(snapshot)
  assert.equal(selected.authority, 'candidate')
  assert.equal(selected.pending, true)
  assert.equal(selected.gradeState.grade, 'B')
  assert.equal(selected.snapshot.research.latest.proposedLikelyGrade, 'C')
})

test('Research-only data never becomes a public AI grade', () => {
  const research = { ...exact, recordStatus: 'current', proposedLikelyGrade: 'A' }
  const selected = standardization.selectRadarAuthority({
    identity,
    research: { latest: research, history: [research] },
  })
  assert.equal(selected.authority, 'research')
  assert.equal(selected.gradeState.grade, null)
  assert.equal(selected.gradeState.reason, 'research_only_no_public_grade')
})

test('exact identity requires both workId and siteId', () => {
  assert.equal(standardization.hasExactRadarIdentity(identity, exact), true)
  assert.equal(
    standardization.hasExactRadarIdentity(identity, { ...exact, workSiteId: 'BGM-101' }),
    false,
  )
  assert.equal(
    standardization.hasExactRadarIdentity(identity, { ...exact, workIdSnapshot: '43' }),
    false,
  )
})

test('identityKey must agree when it is present', () => {
  assert.equal(
    standardization.hasExactRadarIdentity(identity, { ...exact, identityKey: '42|BGM-100' }),
    true,
  )
  assert.equal(
    standardization.hasExactRadarIdentity(identity, { ...exact, identityKey: '999|BGM-100' }),
    false,
  )
})

test('a publication-key candidate with mismatched exact identity cannot win Published authority', () => {
  const wrongPublished = published('A')
  wrongPublished.rating.workSiteId = 'BGM-WRONG'
  const selected = standardization.selectRadarAuthority({
    identity,
    published: wrongPublished,
    candidate: candidate('B'),
  })
  assert.equal(selected.authority, 'candidate')
  assert.equal(selected.gradeState.grade, 'B')
})

test('bounded ranges preserve best, likely and worst without midpoint collapse', () => {
  const state = standardization.normalizeRadarConclusion({
    conclusionMode: 'bounded_range',
    compatibilityGrade: 'A',
    bestGrade: 'S',
    likelyGrade: 'A',
    worstGrade: 'C',
  })
  assert.equal(state.valid, true)
  assert.equal(state.grade, 'A')
  assert.deepEqual(state.range, { bestGrade: 'S', likelyGrade: 'A', worstGrade: 'C' })
})

test('invalid or incomplete bounded ranges do not invent a fixed grade', () => {
  const incomplete = standardization.normalizeRadarConclusion({
    conclusionMode: 'bounded_range',
    compatibilityGrade: 'A',
    bestGrade: 'S',
    likelyGrade: 'A',
  })
  const reversed = standardization.normalizeRadarConclusion({
    conclusionMode: 'bounded_range',
    compatibilityGrade: 'A',
    bestGrade: 'C',
    likelyGrade: 'A',
    worstGrade: 'B',
  })
  assert.equal(incomplete.valid, false)
  assert.equal(incomplete.grade, null)
  assert.equal(reversed.valid, false)
  assert.equal(reversed.grade, null)
})

test('labels_only and blocked modes deliberately expose no grade', () => {
  for (const mode of ['labels_only', 'blocked']) {
    const state = standardization.normalizeRadarConclusion({
      conclusionMode: mode,
      compatibilityGrade: 'A',
    })
    assert.equal(state.valid, true)
    assert.equal(state.grade, null)
    assert.equal(state.mode, mode)
  }
})

test('legacy D-UNCLEAR remains raw legacy data and is never coerced to D', () => {
  const state = standardization.normalizeRadarConclusion({ compatibilityGrade: 'D-UNCLEAR' })
  assert.equal(state.mode, 'legacy')
  assert.equal(state.grade, null)
  assert.equal(state.rawGrade, 'D-UNCLEAR')
  assert.equal(state.valid, false)
})

test('a valid human override has authority over Published while lineages remain intact', () => {
  const snapshot = {
    identity,
    humanOverride: { grade: 'S', status: 'reviewed' },
    published: published('A'),
    candidate: candidate('B'),
  }
  const selected = standardization.selectRadarAuthority(snapshot)
  assert.equal(selected.authority, 'human')
  assert.equal(selected.gradeState.grade, 'S')
  assert.ok(selected.snapshot.published.rating)
  assert.ok(selected.snapshot.candidate)
})

test('a pending human form is not an override', () => {
  const selected = standardization.selectRadarAuthority({
    identity,
    humanOverride: { grade: 'S', status: 'pending' },
    published: published('A'),
  })
  assert.equal(selected.authority, 'published')
})

test('legacy effectiveWorkGrade no longer promotes Research likelyGrade into AI', () => {
  const selected = effective.effectiveWorkGrade({ researchPreview: { likelyGrade: 'A' } })
  assert.equal(selected.source, 'research')
  assert.equal(selected.grade, 'unknown')
})

test('legacy effectiveWorkGrade still accepts a real candidate suggestedGrade', () => {
  const selected = effective.effectiveWorkGrade({
    radarAssessment: { suggestedGrade: 'B', assessedAt: '2026-08-07' },
    researchPreview: { likelyGrade: 'A' },
  })
  assert.equal(selected.source, 'ai')
  assert.equal(selected.grade, 'B')
})

test('repository queries exact identity and never title', () => {
  const repository = readFileSync('src/app/(frontend)/_lib/radar-read-repository.ts', 'utf8')
  assert.match(repository, /workIdSnapshot:\s*\{ equals:/u)
  assert.match(repository, /workSiteId:\s*\{ equals:/u)
  assert.match(repository, /hasExactRadarIdentity\(identity, record\)/u)
  assert.match(repository, /hasExactRadarIdentity\(identity, rating\)/u)
  assert.doesNotMatch(repository, /title:\s*\{ equals:/u)
})
