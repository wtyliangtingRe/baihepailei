import { cpSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const standaloneRoot = join(repoRoot, '.next', 'standalone')
const serverPath = join(standaloneRoot, 'server.js')
const staticSource = join(repoRoot, '.next', 'static')
const staticTarget = join(standaloneRoot, '.next', 'static')

if (!existsSync(serverPath) || !existsSync(staticSource)) {
  console.error('Production build not found. Run "pnpm build" before "pnpm start".')
  process.exit(1)
}

cpSync(staticSource, staticTarget, { recursive: true, force: true })

process.env.HOSTNAME ||= '127.0.0.1'
process.env.PORT ||= '3000'
process.chdir(standaloneRoot)
await import(pathToFileURL(serverPath).href)
