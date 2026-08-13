import 'server-only'

import { Pool } from 'pg'

import {
  findFormalWorkLineageById,
  listFormalWorkLineages,
  type QueryExecutor,
} from './runtimeRepositoryCore'

declare global {
  var __baihepaileiWorkLineagePool: Pool | undefined
}

function databaseUrl(): string {
  const value = String(process.env.WORK_LINEAGE_DATABASE_URL || '').trim()
  if (!value) {
    throw new Error(
      'WORK_LINEAGE_DATABASE_URL is required; legacy Payload/Radar fallback is forbidden',
    )
  }
  return value
}

function pool(): Pool {
  if (!globalThis.__baihepaileiWorkLineagePool) {
    const sslEnabled = String(
      process.env.WORK_LINEAGE_DATABASE_SSL || 'false',
    ).toLowerCase() === 'true'
    globalThis.__baihepaileiWorkLineagePool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: sslEnabled ? { rejectUnauthorized: true } : undefined,
    })
  }
  return globalThis.__baihepaileiWorkLineagePool
}

function executor(): QueryExecutor {
  return {
    query: async <Row extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) => {
      const result = await pool().query(text, values)
      return { rows: result.rows as Row[] }
    },
  }
}

export function getFormalWorkLineageById(workId: string) {
  return findFormalWorkLineageById(executor(), workId)
}

export function getFormalWorkLineageList(input: {
  query?: string
  limit?: number
  offset?: number
}) {
  return listFormalWorkLineages(executor(), input)
}
