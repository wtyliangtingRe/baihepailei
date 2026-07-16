'use server'

import { login, logout } from '@payloadcms/next/auth'
import config from '@payload-config'

type AccountActionResult = {
  ok: boolean
  message?: string
}

export async function loginAccount(input: {
  email: string
  password: string
}): Promise<AccountActionResult> {
  try {
    await login({
      collection: 'users',
      config,
      email: String(input.email || '').trim().toLowerCase(),
      password: String(input.password || ''),
    })
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: '登录失败，请检查邮箱、密码以及邮箱验证状态。',
    }
  }
}

export async function logoutAccount(): Promise<AccountActionResult> {
  try {
    const result = await logout({ allSessions: false, config })
    return result.success
      ? { ok: true }
      : { ok: false, message: '退出登录失败，请稍后重试。' }
  } catch {
    return { ok: false, message: '退出登录失败，请稍后重试。' }
  }
}
