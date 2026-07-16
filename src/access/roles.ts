import type { Access } from 'payload'

export type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'trusted' | 'member'

export const getRole = (user: unknown): Role | undefined => {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

export const isOwner = (user: unknown) => getRole(user) === 'owner'

export const isAdmin = (user: unknown) => {
  const role = getRole(user)
  return role === 'owner' || role === 'admin'
}

export const isEditor = (user: unknown) => {
  const role = getRole(user)
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'reviewer'
}

export const anyone: Access = () => true

export const signedIn: Access = ({ req }) => Boolean(req.user)

export const ownerOnly: Access = ({ req }) => isOwner(req.user)

export const adminsOnly: Access = ({ req }) => isAdmin(req.user)

export const editorsAndUp: Access = ({ req }) => isEditor(req.user)

export const staffOnly: Access = ({ req }) => isEditor(req.user)

// Keep reviewer / trusted compatible with existing records while new appointments
// use owner, admin, editor and member.
export const trustedAndUp: Access = ({ req }) => {
  const role = getRole(req.user)
  return role === 'owner'
    || role === 'admin'
    || role === 'editor'
    || role === 'reviewer'
    || role === 'trusted'
}

export const publishedOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    status: {
      equals: 'published',
    },
  }
}
