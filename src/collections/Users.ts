import type { Access, CollectionConfig, FieldAccess } from 'payload'

import {
  adminsOnly,
  anyone,
  getRole,
  isAdmin,
  isEditor,
  isOwner,
  ownerOnly,
  type Role,
} from '@/access/roles'

type UserLike = {
  id?: string | number
  email?: string
  displayName?: string
  role?: Role
}

const assignableRoles = new Set<Role>(['owner', 'admin', 'editor', 'reviewer', 'trusted', 'member'])
const adminAssignableRoles = new Set<Role>(['editor', 'member'])

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function configuredOwnerEmail() {
  return normalizeEmail(process.env['SITE_OWNER_EMAIL'])
}

function isConfiguredOwnerEmail(value: unknown) {
  const ownerEmail = configuredOwnerEmail()
  return Boolean(ownerEmail && normalizeEmail(value) === ownerEmail)
}

function requestedRole(value: unknown): Role | undefined {
  const role = String(value || '') as Role
  return assignableRoles.has(role) ? role : undefined
}

function siteURL() {
  return String(process.env['NEXT_PUBLIC_SERVER_URL'] || 'http://localhost:3000').replace(/\/$/u, '')
}

function escapeHTML(value: unknown) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const selfOrStaff: Access = ({ req }) => {
  if (isAdmin(req.user)) return true
  if (!req.user) return false

  return {
    id: {
      equals: (req.user as UserLike).id,
    },
  }
}

const personnelRoleAccess: FieldAccess = ({ req }) => isOwner(req.user) || getRole(req.user) === 'admin'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 60 * 60 * 24 * 7,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    verify: {
      generateEmailSubject: () => '验证你的 Baihepailei 账户',
      generateEmailHTML: ({ token, user }) => {
        const url = `${siteURL()}/account/verify?token=${encodeURIComponent(token)}`
        return `<p>你好，${escapeHTML(user.displayName || user.email)}：</p><p>请点击下面的链接验证 Baihepailei 账户：</p><p><a href="${url}">${url}</a></p><p>如果不是你发起的注册，可以忽略这封邮件。</p>`
      },
    },
    forgotPassword: {
      expiration: 60 * 60 * 1000,
      generateEmailSubject: () => '重设你的 Baihepailei 密码',
      generateEmailHTML: (args) => {
        const token = args?.token || ''
        const user = args?.user as UserLike | undefined
        const url = `${siteURL()}/account/reset-password?token=${encodeURIComponent(token)}`
        return `<p>你好，${escapeHTML(user?.displayName || user?.email)}：</p><p>请在一小时内通过下面的链接重设密码：</p><p><a href="${url}">${url}</a></p><p>如果不是你发起的操作，可以忽略这封邮件。</p>`
      },
    },
  },
  admin: {
    defaultColumns: ['email', 'displayName', 'role', 'updatedAt'],
    group: '系统',
    useAsTitle: 'email',
  },
  access: {
    admin: ({ req }) => isEditor(req.user),
    create: anyone,
    delete: ownerOnly,
    read: selfOrStaff,
    unlock: adminsOnly,
    update: selfOrStaff,
  },
  hooks: {
    beforeValidate: [
      ({ data, operation, originalDoc, req }) => {
        const actorRole = getRole(req.user)
        const original = originalDoc as UserLike | undefined
        const email = normalizeEmail(data?.email || original?.email)
        const desired = requestedRole(data?.role)

        if (operation === 'create') {
          const created = { ...data, email, termsAcceptedAt: new Date().toISOString() }
          if (isConfiguredOwnerEmail(email)) return { ...created, role: 'owner' }
          if (actorRole === 'owner') return { ...created, role: desired || 'member' }
          if (actorRole === 'admin' && desired && adminAssignableRoles.has(desired)) {
            return { ...created, role: desired }
          }
          return { ...created, role: 'member' }
        }

        if (!original) return data

        // The configured owner identity cannot be renamed or demoted through the API.
        if (original.role === 'owner' || isConfiguredOwnerEmail(original.email)) {
          return { ...data, email: normalizeEmail(original.email), role: 'owner' }
        }

        if (actorRole === 'owner') {
          const role = desired === 'owner' && !isConfiguredOwnerEmail(email) ? 'admin' : desired || original.role || 'member'
          return { ...data, email, role }
        }

        if (actorRole === 'admin') {
          const actorID = (req.user as UserLike | undefined)?.id
          if (original.role === 'admin' && String(actorID) !== String(original.id)) {
            return {
              ...data,
              displayName: original.displayName,
              email: normalizeEmail(original.email),
              password: undefined,
              role: 'admin',
            }
          }
          const role = desired && adminAssignableRoles.has(desired) ? desired : original.role || 'member'
          return { ...data, email, role }
        }

        return { ...data, email: normalizeEmail(original.email), role: original.role || 'member' }
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      defaultValue: 'member',
      required: true,
      access: {
        update: personnelRoleAccess,
      },
      options: [
        { label: '最高领袖', value: 'owner' },
        { label: '管理员', value: 'admin' },
        { label: '编辑', value: 'editor' },
        { label: '注册用户', value: 'member' },
        { label: '审核（旧角色兼容）', value: 'reviewer' },
        { label: '可信投稿者（旧角色兼容）', value: 'trusted' },
      ],
    },
    {
      name: 'displayName',
      type: 'text',
      label: '显示名',
      minLength: 2,
      maxLength: 50,
      required: true,
    },
    {
      name: 'termsAcceptedAt',
      type: 'date',
      label: '接受社区规则时间',
      admin: {
        readOnly: true,
      },
    },
  ],
}
