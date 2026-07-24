#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.cwd()
const dir = path.join(root, 'data/radar-blocked-research')
const output = path.join(dir, 'source-ids.json.gz.b64')
const expected = [
  ['source-ids.001.part', 3000, 'e942121e837b166036d1d7e3276b7207c3ed7a135775c5c1455b9f55ee18c1c7'],
  ['source-ids.002.part', 3000, '8489f3e4254adbec19cde6113eb39c7768e10e09761da63e64e0cc788883049a'],
  ['source-ids.003.part', 3000, 'f04288aec7678bd25ad6342d9108cc00e939b2e831dfbb80c0db5fc29f9c4173'],
  ['source-ids.004.part', 1512, 'bf295d82d087cbbc6807f571b1fe35c2b80e1287c40bb84021cb61d8a80c6f62'],
]
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const parts = expected.map(([name, bytes, hash]) => {
  const value = fs.readFileSync(path.join(dir, name), 'utf8').trim()
  if (value.length !== bytes || sha256(value) !== hash) throw new Error(`Source ID shard integrity mismatch: ${name}`)
  return value
})
const combined = parts.join('')
if (combined.length !== 10512 || sha256(combined) !== '9b649184565c0e04a83ac4e2bcd1b836f9d40447005b9dd6de2fff35def82fd8') throw new Error('Combined source ID integrity mismatch')
const raw = zlib.gunzipSync(Buffer.from(combined, 'base64'))
if (sha256(raw) !== 'b1d9ee3c11a2b5f280876a636e488d345d15fbe000df4c8eeda97350dc4a3a03') throw new Error('Source ID payload hash mismatch')
const rows = JSON.parse(raw.toString('utf8'))
const counts = Object.fromEntries(['a', 'b', 'v', 'm'].map((code) => [code, rows.filter((row) => row?.[0] === code).length]))
if (rows.length !== 1805 || counts.b !== 1076 || counts.v !== 601 || counts.a !== 63 || counts.m !== 65) throw new Error(`Source ID cardinality mismatch: ${JSON.stringify({ rows: rows.length, counts })}`)
fs.writeFileSync(output, combined, 'utf8')
console.log(JSON.stringify({ rows: rows.length, counts, combinedSha256: sha256(combined), payloadSha256: sha256(raw) }))
