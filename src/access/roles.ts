import type { Access } from 'payload'

export type Role = 'owner' | 'admin' | 'editor' | 'member'

type RoleUser = {
  email?: unknown
  role?: unknown
}

function normalizedEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/**
 * The configured deployment owner is always treated as owner at every
 * authorization boundary. beforeLogin in Users.ts persists the same value,
 * but access checks must not depend on a stale JWT or a one-time migration.
 */
function isConfiguredOwner(user: RoleUser) {
  const configured = normalizedEmail(process.env['SITE_OWNER_EMAIL'])
  return Boolean(configured && normalizedEmail(user.email) === configured)
}

export const getRole = (user: unknown): Role | undefined => {
  if (!user || typeof user !== 'object') return undefined
  const candidate = user as RoleUser
  if (isConfiguredOwner(candidate)) return 'owner'

  const role = String(candidate.role || '').trim()
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'member'
    ? role
    : undefined
}

export const isOwner = (user: unknown) => getRole(user) === 'owner'

export const isAdmin = (user: unknown) => {
  const role = getRole(user)
  return role === 'owner' || role === 'admin'
}

export const isEditor = (user: unknown) => {
  const role = getRole(user)
  return role === 'owner' || role === 'admin' || role === 'editor'
}

export const anyone: Access = () => true

export const signedIn: Access = ({ req }) => Boolean(req.user)

export const ownerOnly: Access = ({ req }) => isOwner(req.user)

export const adminsOnly: Access = ({ req }) => isAdmin(req.user)

export const editorsAndUp: Access = ({ req }) => isEditor(req.user)

export const staffOnly: Access = ({ req }) => isEditor(req.user)

export const publishedOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    status: {
      equals: 'published',
    },
  }
}

export const publishedActiveWorkOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    and: [
      { _status: { equals: 'published' } },
      { catalogStatus: { in: ['active', 'temporary'] } },
    ],
  }
}
