type AuditRequest = any

type AuditInput = {
  req: AuditRequest
  actorID?: string | number
  action: string
  targetCollection: string
  targetID: string | number
  targetTitle?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export async function recordAuditEvent(input: AuditInput) {
  const req = input.req || {}
  const actorID = input.actorID ?? req.user?.id ?? req.context?.auditActorID
  const payload = req.payload
  if (actorID === undefined || actorID === null || !payload?.create) return
  if (req.context?.auditEvent) return

  try {
    await payload.create({
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
