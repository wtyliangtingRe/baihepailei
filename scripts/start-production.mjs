import { spawn } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const host = process.env.HOSTNAME || '127.0.0.1'
const port = process.env.PORT || '3000'

async function runWindowsProductionServer() {
  const buildId = join(repoRoot, '.next', 'BUILD_ID')
  const nextBin = join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!existsSync(buildId) || !existsSync(nextBin)) {
    console.error('Production build not found. Run "pnpm build" before "pnpm start".')
    process.exit(1)
  }

  const child = spawn(
    process.execPath,
    [nextBin, 'start', '--hostname', host, '--port', port],
    {
      cwd: repoRoot,
      env: { ...process.env, HOSTNAME: host, PORT: port },
      stdio: 'inherit',
    },
  )
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  const code = await new Promise((resolveExit) => child.once('exit', (exitCode) => resolveExit(exitCode ?? 0)))
  process.exit(Number(code))
}

async function runStandaloneProductionServer() {
  const standaloneRoot = join(repoRoot, '.next', 'standalone')
  const serverPath = join(standaloneRoot, 'server.js')
  const staticSource = join(repoRoot, '.next', 'static')
  const staticTarget = join(standaloneRoot, '.next', 'static')

  if (!existsSync(serverPath) || !existsSync(staticSource)) {
    console.error('Production build not found. Run "pnpm build" before "pnpm start".')
    process.exit(1)
  }

  cpSync(staticSource, staticTarget, { recursive: true, force: true })
  const publicSource = join(repoRoot, 'public')
  if (existsSync(publicSource)) {
    cpSync(publicSource, join(standaloneRoot, 'public'), { recursive: true, force: true })
  }
  process.env.HOSTNAME = host
  process.env.PORT = port
  process.chdir(standaloneRoot)
  await import(pathToFileURL(serverPath).href)
}

if (process.platform === 'win32') {
  await runWindowsProductionServer()
} else {
  await runStandaloneProductionServer()
}
