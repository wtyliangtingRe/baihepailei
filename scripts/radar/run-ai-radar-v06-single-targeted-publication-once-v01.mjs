#!/usr/bin/env node

const message = [
  'This executor is permanently disabled.',
  'The one-row canary proved that publishing with _status=published promotes unrelated fields from the latest draft into the main Works document.',
  'Do not retry this path against any database.',
  'Use the version-roundtrip laboratory workflow on an isolated restored database instead.',
].join(' ')

console.error(message)
process.exitCode = 2
