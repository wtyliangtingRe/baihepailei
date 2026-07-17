import config from '@payload-config'
import { type NextRequest, NextResponse } from 'next/server'
import { generatePayloadCookie, getPayload } from 'payload'

type AccountUser = {
  id: number | string
  accountStatus?: string
  displayName?: string
  email?: string
  role?: string
}

function publicUser(value: unknown) {
  const user = value as AccountUser | null | undefined
  if (!user?.id) return null
  return {
    id: String(user.id),
    accountStatus: user.accountStatus || 'active',
    displayName: user.displayName || '',
    email: user.email || '',
    role: user.role || 'member',
  }
}

function sameSiteValue(value: unknown): 'lax' | 'none' | 'strict' {
  if (value === true) return 'strict'
  const normalized = String(value || 'lax').toLowerCase()
  if (normalized === 'none' || normalized === 'strict') return normalized
  return 'lax'
}

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: NextRequest) {
  const payload = await getPayload({ config })
  const result = await payload.auth({ headers: request.headers })
  return noStore(NextResponse.json({ user: publicUser(result.user) }))
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json()
    const email = String(input?.email || '').trim().toLowerCase()
    const password = String(input?.password || '')
    if (!email || !password) {
      return noStore(NextResponse.json({ message: '请输入邮箱和密码。' }, { status: 400 }))
    }

    const payload = await getPayload({ config })
    const result = await payload.login({
      collection: 'users',
      data: { email, password },
    })
    const authConfig = payload.collections.users?.config.auth
    if (!result.token || !authConfig) {
      return noStore(NextResponse.json({ message: '登录没有建立会话，请重试。' }, { status: 401 }))
    }

    const cookie = generatePayloadCookie({
      collectionAuthConfig: authConfig,
      cookiePrefix: payload.config.cookiePrefix,
      returnCookieAsObject: true,
      token: result.token,
    })
    const response = NextResponse.json({ ok: true, user: publicUser(result.user) })
    response.cookies.set({
      name: cookie.name,
      value: cookie.value || result.token,
      domain: authConfig.cookies.domain || undefined,
      httpOnly: true,
      maxAge: authConfig.tokenExpiration,
      path: '/',
      sameSite: sameSiteValue(authConfig.cookies.sameSite),
      secure: Boolean(authConfig.cookies.secure),
    })
    return noStore(response)
  } catch (caught) {
    const error = caught as { data?: { code?: string }; message?: string; status?: number }
    if (error?.status === 403 && (error.data?.code === 'account_suspended' || error.message === '此账户已被封停。')) {
      return noStore(
        NextResponse.json(
          { code: 'account_suspended', message: '此账户已被封停。' },
          { status: 403 },
        ),
      )
    }
    return noStore(
      NextResponse.json(
        { message: '登录失败，请检查邮箱、密码以及邮箱验证状态。' },
        { status: 401 },
      ),
    )
  }
}
