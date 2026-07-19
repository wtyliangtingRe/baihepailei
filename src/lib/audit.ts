type AuditRequest = {
  user?: { id?: string | number } | null
  payload?: { create: (args: Record<string, unknown>) => Promise<unknown> }
  context?: Record<string, unknown>
}

type AuditInput = {
  req: AuditRequest
  action: string
  targetCollection: string
  targetID: string | number
  targetTitle?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export async function recordAuditEvent(input: AuditInput) {
  const actorID = input.req.user?.id
  if (actorID === undefined || actorID === null || !input.req.payload?.create) return
  if (input.req.context?.auditEvent) return

  try {
    await input.req.payload.create({
      collection: 'audit-events',
      overrideAccess: true,
      context: { auditEvent: true },
      data: {
        actor: actorID,
        action: input.action.slice(0, 120),
        targetCollection: input.targetCollection.slice(0, 120),
        targetID: String(input.targetID).slice(0, 160),
        targetTitle: String(input.targetTitle || '').slice(0, 300),
        summary: String(input.summary || '').slice(0, 4000),
        metadata: input.metadata || {},
      },
    })
  } catch (error) {
    // Auditing must never turn a valid content save into a failed save.
    console.warn('Audit event write failed', { action: input.action, targetCollection: input.targetCollection, targetID: input.targetID, error })
  }
}
