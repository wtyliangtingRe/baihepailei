import crypto from 'node:crypto'

export const INCREMENTAL_WAVE_PACKAGE_VERSION = 'ai-radar-incremental-wave-package-v0.1'
export const INCREMENTAL_SUBWAVE_HANDOFF_VERSION = 'ai-radar-incremental-subwave-handoff-v0.1'
export const DEFAULT_INCREMENTAL_TARGET_ROWS = 2500
export const DEFAULT_INCREMENTAL_SUBWAVE_SIZE = 250
export const DEFAULT_INCREMENTAL_CHUNK_SIZE = 5

function val(value) {
  return String(value ?? '').trim()
}

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`)
  return number
}

export function sha256Text(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex')
}

export function jsonlText(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

export function identityKey(row) {
  const workId = val(row?.workId || row?.id)
  const siteId = val(row?.siteId)
  if (!workId || !siteId) throw new Error('Incremental wave row requires workId and siteId')
  return `${workId}|${siteId}`
}

export function splitRows(rows, size) {
  const chunkSize = positiveInteger(size, 'size')
  const output = []
  for (let index = 0; index < rows.length; index += chunkSize) output.push(rows.slice(index, index + chunkSize))
  return output
}

function countByAction(rows) {
  const counts = {}
  for (const row of rows) {
    const action = val(row?.incrementalSelection?.action) || 'missing'
    counts[action] = (counts[action] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function validateResearchSelectionRow(row) {
  const identity = identityKey(row)
  const action = val(row?.incrementalSelection?.action)
  if (!action.startsWith('research_')) throw new Error(`Non-research action entered research capacity: ${identity}:${action || 'missing'}`)
  if (action === 'research_new') return
  const refreshReason = val(row?.incrementalSelection?.refreshReason)
  if (!refreshReason) throw new Error(`Research retry/refresh row lacks refreshReason: ${identity}:${action}`)
}

export function buildIncrementalWavePlan(rows, options = {}) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array')
  const waveId = val(options.waveId)
  if (!waveId) throw new Error('waveId is required')
  const targetRows = positiveInteger(options.targetRows ?? DEFAULT_INCREMENTAL_TARGET_ROWS, 'targetRows')
  const subwaveSize = positiveInteger(options.subwaveSize ?? DEFAULT_INCREMENTAL_SUBWAVE_SIZE, 'subwaveSize')
  const chunkSize = positiveInteger(options.chunkSize ?? DEFAULT_INCREMENTAL_CHUNK_SIZE, 'chunkSize')
  const allowPartial = options.allowPartial === true
  if (!allowPartial && rows.length !== targetRows) throw new Error(`Expected exactly ${targetRows} research rows, received ${rows.length}`)
  if (rows.length > targetRows) throw new Error(`Research selection exceeds targetRows: ${rows.length} > ${targetRows}`)
  if (subwaveSize > targetRows) throw new Error('subwaveSize cannot exceed targetRows')
  if (chunkSize > subwaveSize) throw new Error('chunkSize cannot exceed subwaveSize')

  const seen = new Set()
  for (const row of rows) {
    validateResearchSelectionRow(row)
    const key = identityKey(row)
    if (seen.has(key)) throw new Error(`Duplicate incremental research identity: ${key}`)
    seen.add(key)
  }

  const groups = splitRows(rows, subwaveSize)
  const subwaves = groups.map((subwaveRows, index) => {
    const number = String(index + 1).padStart(4, '0')
    const subwaveId = `${waveId}-SUBWAVE-${number}`
    const chunks = splitRows(subwaveRows, chunkSize).map((chunkRows, chunkIndex) => ({
      chunkId: `${subwaveId}-CHUNK-${String(chunkIndex + 1).padStart(4, '0')}`,
      index: chunkIndex + 1,
      rows: chunkRows,
      rowCount: chunkRows.length,
      firstWorkId: val(chunkRows[0]?.workId),
      lastWorkId: val(chunkRows.at(-1)?.workId),
    }))
    return {
      subwaveId,
      index: index + 1,
      rows: subwaveRows,
      rowCount: subwaveRows.length,
      firstWorkId: val(subwaveRows[0]?.workId),
      lastWorkId: val(subwaveRows.at(-1)?.workId),
      chunks,
      chunkCount: chunks.length,
      byAction: countByAction(subwaveRows),
    }
  })

  return {
    waveId,
    targetRows,
    selectedRows: rows.length,
    subwaveSize,
    chunkSize,
    subwaveCount: subwaves.length,
    expectedSubwaveCount: Math.ceil(targetRows / subwaveSize),
    byAction: countByAction(rows),
    newRows: rows.filter((row) => val(row?.incrementalSelection?.action) === 'research_new').length,
    retryRows: rows.filter((row) => val(row?.incrementalSelection?.action) !== 'research_new').length,
    identities: seen,
    subwaves,
  }
}
