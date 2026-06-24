import type { Access } from 'payload'

type Role = 'admin' | 'editor' | 'reviewer' | 'trusted'

const getRole = (user: unknown): Role | undefined => {
  if (!user || typeof user !== 'object') return undefined
  return (user as { role?: Role }).role
}

export const anyone: Access = () => true

export const signedIn: Access = ({ req }) => Boolean(req.user)

export const adminsOnly: Access = ({ req }) => getRole(req.user) === 'admin'

export const editorsAndUp: Access = ({ req }) => {
  const role = getRole(req.user)
  return role === 'admin' || role === 'editor' || role === 'reviewer'
}

export const trustedAndUp: Access = ({ req }) => {
  const role = getRole(req.user)
  return role === 'admin' || role === 'editor' || role === 'reviewer' || role === 'trusted'
}

export const publishedOrSignedIn: Access = ({ req }) => {
  if (req.user) return true

  return {
    status: {
      equals: 'published',
    },
  }
}
