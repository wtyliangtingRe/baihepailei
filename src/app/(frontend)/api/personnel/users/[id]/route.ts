import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { getRole, type Role } from '@/access/roles'

type Params = { params: Promise<{ id: string }> }
type AccountStatus = 'active' | 'suspended'

type ManagedUser = {
  id: string | number
  accountStatus?: AccountStatus
  email?: string
  role?: string
}

const ownerAssignableRoles = new Set<Role>(['admin', 'editor', 'member'])
const adminAssignableRoles = new Set<Role>(['editor', 'member'])
const accountStatuses = new Set<AccountStatus>(['active', 'suspended'])

function responseError(message: string, status: number) {
  return NextResponse.json({ errors: [{ message }], message }, { status })
}

function normalizedOrigin(value: string | null) {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function requestOrigin(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(/:$/u, '')
  return host ? `${protocol}://${host}` : request.nextUrl.origin
}

function isSameOrigin(request: NextRequest) {
  const supplied = normalizedOrigin(request.headers.get('origin'))
  const expected = normalizedOrigin(requestOrigin(request))
  return Boolean(supplied && expected && supplied === expected)
}

function requestedRole(value: unknown): Role | null {
  const role = String(value || '').trim() as Role
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'member' ? role : null
}

function requestedAccountStatus(value: unknown): AccountStatus | null {
  const status = String(value || '').trim() as AccountStatus
  return accountStatuses.has(status) ? status : null
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) return responseError('请求来源不受信任，请从站内人员页面重试。', 403)

  const payload = await getPayload({ config })
  const auth = await payload.auth({ headers: request.headers })
  const authUser = auth.user
  const actor = authUser as ManagedUser | null
  const actorRole = getRole(actor)

  if (!authUser || !actor) return responseError('请先登录。', 401)
  if (actorRole !== 'owner' && actorRole !== 'admin') return responseError('你没有人员管理权限。', 403)

  const { id } = await params
  if (!id) return responseError('缺少目标用户 ID。', 400)

  let target: ManagedUser
  try {
    target = await payload.findByID({
      collection: 'users',
      id,
      depth: 0,
      overrideAccess: true,
    }) as ManagedUser
  } catch {
    return responseError('没有找到目标账户。', 404)
  }

  if (String(target.id) === String(actor.id)) return responseError('不能在人员页面修改自己的身份或状态。', 403)
  if (target.role === 'owner') return responseError('最高领袖账户不能通过人员页面修改。', 403)
  if (actorRole === 'admin' && target.role === 'admin') return responseError('管理员不能修改另一位管理员。', 403)

  let input: Record<string, unknown>
  try {
    input = await request.json() as Record<string, unknown>
  } catch {
    return responseError('请求内容不是有效的 JSON。', 400)
  }

  const data: Record<string, unknown> = {}

  if (Object.prototype.hasOwnProperty.call(input, 'role')) {
    const role = requestedRole(input.role)
    const allowed = actorRole === 'owner' ? ownerAssignableRoles : adminAssignableRoles
    if (!role || !allowed.has(role)) return responseError('不能任命为该身份。', 403)
    data.role = role
  }

  if (Object.prototype.hasOwnProperty.call(input, 'accountStatus')) {
    const accountStatus = requestedAccountStatus(input.accountStatus)
    if (!accountStatus) return responseError('账户状态无效。', 400)
    data.accountStatus = accountStatus

    if (accountStatus === 'suspended') {
      const suspensionReason = String(input.suspensionReason || '').trim()
      if (!suspensionReason) return responseError('封停账户时必须填写原因。', 400)
      data.suspensionReason = suspensionReason.slice(0, 500)
    }
  }

  if (Object.keys(data).length === 0) return responseError('没有可更新的人员字段。', 400)

  try {
    const updated = await payload.update({
      collection: 'users',
      id,
      depth: 0,
      data: data as any,
      overrideAccess: false,
      user: authUser,
    })
    return NextResponse.json({ doc: updated })
  } catch (caught) {
    const error = caught as { message?: string; status?: number }
    return responseError(error.message || '人员信息更新失败。', error.status || 500)
  }
}
