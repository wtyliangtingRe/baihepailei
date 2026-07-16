'use server'

import { logout } from '@payloadcms/next/auth'
import config from '@payload-config'

type AccountActionResult = {
  ok: boolean
  message?: string
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
