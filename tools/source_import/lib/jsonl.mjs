import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const UTF8_BOM = /^\uFEFF/u

function stripBom(line) {
  return line.replace(UTF8_BOM, '')
}

export function parseJsonl(text, { sourcePath = '<inline>' } = {}) {
  return text
    .split(/\r?\n/u)
    .map((line, index) => ({ line: index === 0 ? stripBom(line) : line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Invalid JSONL in ${sourcePath}:${lineNumber}: ${message}`)
      }
    })
}

export function stringifyJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '')
}

export async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8')
  return parseJsonl(text, { sourcePath: filePath })
}

export async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, stringifyJsonl(records), 'utf8')
}

export async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
