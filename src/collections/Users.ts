import { APIError, type Access, type CollectionConfig, type FieldAccess, type TextFieldSingleValidation } from 'payload'

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
  _verified?: boolean | null
  accountStatus?: AccountStatus
  email?: string
  displayName?: string
  role?: Role
  sessions?: unknown[]
  suspendedAt?: string | null
  suspendedBy?: string | number | null
  suspensionReason?: string | null
}

type AccountStatus = 'active' | 'suspended'

const assignableRoles = new Set<Role>(['owner', 'admin', 'editor', 'member'])
const adminAssignableRoles = new Set<Role>(['editor', 'member'])
const accountStatuses = new Set<AccountStatus>(['active', 'suspended'])

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
  const raw = String(value || '').trim()
  // Legacy reviewer/trusted records are normalized to editor during migration.
  const normalized = raw === 'reviewer' || raw === 'trusted' ? 'editor' : raw
  const role = normalized as Role
  return assignableRoles.has(role) ? role : undefined
}

function siteURL() {
  return String(process.env['NEXT_PUBLIC_SERVER_URL'] || 'http://localhost:3000').replace(/\/$/u, '')
}

function accountEmailVerificationEnabled() {
  const value = String(process.env['ACCOUNT_EMAIL_VERIFICATION_ENABLED'] || 'true').trim().toLowerCase()
  return !new Set(['0', 'false', 'no', 'off']).has(value)
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
const personnelStatusAccess: FieldAccess = ({ req }) => isAdmin(req.user)

function preserveAccountState(data: Record<string, unknown>, original: UserLike) {
  return {
    ...data,
    accountStatus: original.accountStatus || 'active',
    suspendedAt: original.suspendedAt,
    suspendedBy: original.suspendedBy,
    suspensionReason: original.suspensionReason,
  }
}

function applyManagedAccountState(data: Record<string, unknown>, original: UserLike, actor: UserLike | undefined) {
  const requested = String(data.accountStatus || '') as AccountStatus
  if (!accountStatuses.has(requested)) return preserveAccountState(data, original)

  const previous = original.accountStatus || 'active'
  if (requested === 'active') {
    return {
      ...data,
      accountStatus: 'active' as const,
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
    }
  }

  const newlySuspended = previous !== 'suspended'
  return {
    ...data,
    accountStatus: 'suspended' as const,
    sessions: newlySuspended ? [] : original.sessions,
    suspendedAt: newlySuspended ? new Date().toISOString() : original.suspendedAt,
    suspendedBy: newlySuspended ? actor?.id : original.suspendedBy,
    suspensionReason: String(data.suspensionReason || original.suspensionReason || '由站点管理人员封停。').trim(),
  }
}

const validateDisplayName: TextFieldSingleValidation = (value, { operation }) => {
  const normalized = String(value || '').trim()
  if (!normalized) return operation === 'create' ? '注册时必须填写显示名。' : true
  if (normalized.length < 2) return '显示名至少需要 2 个字符。'
  if (normalized.length > 50) return '显示名不能超过 50 个字符。'
  return true
}

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 60 * 60 * 24 * 7,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    ...(accountEmailVerificationEnabled()
      ? {
          verify: {
            generateEmailSubject: () => '验证你的 Baihepailei 账户',
            generateEmailHTML: ({ token, user }) => {
              const url = `${siteURL()}/account/verify?token=${encodeURIComponent(token)}`
              return `<p>你好，${escapeHTML(user.displayName || user.email)}：</p><p>请点击下面的链接验证 Baihepailei 账户：</p><p><a href="${url}">${url}</a></p><p>如果不是你发起的注册，可以忽略这封邮件。</p>`
            },
          },
        }
      : {}),
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
    defaultColumns: ['email', 'displayName', 'role', 'accountStatus', 'updatedAt'],
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
    beforeLogin: [
      async ({ user, req }) => {
        const current = user as UserLike
        if (current.accountStatus === 'suspended' && !isConfiguredOwnerEmail(current.email)) {
          throw new APIError('此账户已被封停。', 403, { code: 'account_suspended' }, true)
        }

        if (!current.id || !isConfiguredOwnerEmail(current.email)) {
          return user
        }

        const verificationNeedsNormalization = accountEmailVerificationEnabled() && current._verified !== true
        const roleNeedsNormalization = current.role !== 'owner'
        const statusNeedsNormalization = current.accountStatus !== 'active'
        if (!verificationNeedsNormalization && !roleNeedsNormalization && !statusNeedsNormalization) return user

        return req.payload.update({
          collection: 'users',
          id: current.id,
          data: {
            ...(verificationNeedsNormalization ? { _verified: true } : {}),
            ...(roleNeedsNormalization ? { role: 'owner' as const } : {}),
            ...(statusNeedsNormalization ? { accountStatus: 'active' as const } : {}),
          },
          overrideAccess: true,
          req,
        })
      },
    ],
    beforeValidate: [
      ({ data, operation, originalDoc, req }) => {
        const actorRole = getRole(req.user)
        const actor = req.user as UserLike | undefined
        const original = originalDoc as UserLike | undefined
        const email = normalizeEmail(data?.email || original?.email)
        const desired = requestedRole(data?.role)

        if (operation === 'create') {
          const created = {
            ...data,
            accountStatus: 'active' as const,
            displayName: String(data?.displayName || '').trim(),
            email,
            suspendedAt: null,
            suspendedBy: null,
            suspensionReason: null,
            termsAcceptedAt: new Date().toISOString(),
          }
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
          const editingSelf = String(actor?.id) === String(original.id)
          return {
            ...data,
            accountStatus: 'active',
            ...(editingSelf ? {} : { displayName: original.displayName, password: undefined }),
            email: normalizeEmail(original.email),
            role: 'owner',
            suspendedAt: null,
            suspendedBy: null,
            suspensionReason: null,
          }
        }

        if (actorRole === 'owner') {
          const role = desired === 'owner' && !isConfiguredOwnerEmail(email) ? 'admin' : desired || requestedRole(original.role) || 'member'
          return applyManagedAccountState({ ...data, email, role }, original, actor)
        }

        if (actorRole === 'admin') {
          const actorID = actor?.id
          if (original.role === 'admin') {
            const editingSelf = String(actorID) === String(original.id)
            return preserveAccountState(editingSelf
              ? { ...data, email, role: 'admin' }
              : {
                  ...data,
                  displayName: original.displayName,
                  email: normalizeEmail(original.email),
                  password: undefined,
                  role: 'admin',
                }, original)
          }
          const role = desired && adminAssignableRoles.has(desired) ? desired : original.role || 'member'
          const mayManageStatus = String(actorID) !== String(original.id)
          const next = { ...data, email, role }
          return mayManageStatus ? applyManagedAccountState(next, original, actor) : preserveAccountState(next, original)
        }

        return preserveAccountState({
          ...data,
          email: normalizeEmail(original.email),
          role: requestedRole(original.role) || 'member',
        }, original)
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
      ],
    },
    {
      name: 'accountStatus',
      type: 'select',
      label: '账户状态',
      defaultValue: 'active',
      required: true,
      access: {
        update: personnelStatusAccess,
      },
      options: [
        { label: '正常', value: 'active' },
        { label: '已封停', value: 'suspended' },
      ],
    },
    {
      name: 'suspensionReason',
      type: 'textarea',
      label: '封停原因',
      maxLength: 500,
      access: {
        read: personnelStatusAccess,
        update: personnelStatusAccess,
      },
    },
    {
      name: 'suspendedAt',
      type: 'date',
      label: '封停时间',
      access: {
        read: personnelStatusAccess,
        update: personnelStatusAccess,
      },
      admin: { readOnly: true },
    },
    {
      name: 'suspendedBy',
      type: 'relationship',
      label: '操作人',
      relationTo: 'users',
      access: {
        read: personnelStatusAccess,
        update: personnelStatusAccess,
      },
      admin: { readOnly: true },
    },
    {
      name: 'displayName',
      type: 'text',
      label: '显示名',
      minLength: 2,
      maxLength: 50,
      validate: validateDisplayName,
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
