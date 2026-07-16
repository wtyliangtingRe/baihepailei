#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const file = path.resolve(String(args.file || args.out || 'public/search-index.json'))
if (!fs.existsSync(file)) throw new Error(`Missing index: ${file}`)

const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
const requestedMode = String(args['media-mode'] || process.env.NEXT_PUBLIC_MEDIA_MODE || '').trim().toLowerCase()
payload.mediaMode = requestedMode === 'enhanced' ? 'enhanced' : 'text'

const json = args.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
fs.writeFileSync(file, `${json}\n`, 'utf8')
console.log(`Compacted ${path.basename(file)} (${payload.mediaMode} media profile)`)
