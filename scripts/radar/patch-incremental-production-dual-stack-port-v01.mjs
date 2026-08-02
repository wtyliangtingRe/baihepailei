#!/usr/bin/env node
import fs from 'node:fs'

const libraryPath = 'scripts/radar/lib/radar-unified-rating-incremental-production-9988-v01.ps1'
const testPath = 'tests/radar-unified-rating-incremental-production-gates-9988-v01.test.mjs'

const oldBlock = `  $portProperty = $inspect[0].NetworkSettings.Ports.PSObject.Properties['5432/tcp']
  if ($null -eq $portProperty -or @($portProperty.Value).Count -ne 1) { throw '源 PostgreSQL 必须有唯一的 5432 host port。' }
  $publishedPort = [string]$portProperty.Value[0].HostPort
  $hostIp = [string]$portProperty.Value[0].HostIp
  if ($publishedPort -notmatch '^\\d+$') { throw '无法确认源 PostgreSQL host port。' }
  if ($hostIp -notin @('127.0.0.1', '0.0.0.0', '::')) { throw '源 PostgreSQL host binding 不受支持。' }
  if ([int]$uri.Port -ne [int]$publishedPort) { throw '生产 DATABASE_URL 端口未指向源 PostgreSQL 容器。' }
`

const newBlock = `  $portProperty = $inspect[0].NetworkSettings.Ports.PSObject.Properties['5432/tcp']
  if ($null -eq $portProperty -or $null -eq $portProperty.Value) {
    throw '源 PostgreSQL 没有公开 5432 host port。'
  }
  $bindings = @($portProperty.Value)
  if ($bindings.Count -lt 1) { throw '源 PostgreSQL 没有公开 5432 host port。' }
  $allowedHostIps = @('127.0.0.1', '0.0.0.0', '::', '::1')
  $invalidBindings = @(
    $bindings | Where-Object {
      [string]$_.HostIp -notin $allowedHostIps -or
      [string]$_.HostPort -notmatch '^\\d+$'
    }
  )
  if ($invalidBindings.Count -gt 0) { throw '源 PostgreSQL host binding 不受支持。' }
  $publishedPorts = @(
    $bindings |
      ForEach-Object { [string]$_.HostPort } |
      Sort-Object -Unique
  )
  if ($publishedPorts.Count -ne 1) {
    throw '源 PostgreSQL 的 5432 bindings 必须映射到唯一 host port。'
  }
  $publishedPort = [string]$publishedPorts[0]
  if ([int]$uri.Port -ne [int]$publishedPort) { throw '生产 DATABASE_URL 端口未指向源 PostgreSQL 容器。' }
`

let library = fs.readFileSync(libraryPath, 'utf8')
if (library.includes(newBlock)) {
  // Already patched.
} else {
  const count = library.split(oldBlock).length - 1
  if (count !== 1) throw new Error(`database port gate target count=${count}`)
  library = library.replace(oldBlock, () => newBlock)
  fs.writeFileSync(libraryPath, library, 'utf8')
}

let tests = fs.readFileSync(testPath, 'utf8')
const oldAssertions = `  assert.match(library, /生产 DATABASE_URL 必须使用 loopback/)
  assert.match(library, /DATABASE_URL 端口未指向源 PostgreSQL 容器/)
`
const newAssertions = `  assert.match(library, /生产 DATABASE_URL 必须使用 loopback/)
  assert.match(library, /allowedHostIps = @\\('127\\.0\\.0\\.1', '0\\.0\\.0\\.0', '::', '::1'\\)/)
  assert.match(library, /\\$bindings \\| Where-Object/)
  assert.match(library, /Sort-Object -Unique/)
  assert.match(library, /5432 bindings 必须映射到唯一 host port/)
  assert.match(library, /DATABASE_URL 端口未指向源 PostgreSQL 容器/)
  assert.doesNotMatch(library, /@\\(\\$portProperty\\.Value\\)\\.Count -ne 1/)
`
if (tests.includes(newAssertions)) {
  // Already patched.
} else {
  const count = tests.split(oldAssertions).length - 1
  if (count !== 1) throw new Error(`production gate test target count=${count}`)
  tests = tests.replace(oldAssertions, () => newAssertions)
  fs.writeFileSync(testPath, tests, 'utf8')
}
