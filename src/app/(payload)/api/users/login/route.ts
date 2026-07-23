import config from '@payload-config'
import { REST_POST } from '@payloadcms/next/routes'
import type { NextRequest } from 'next/server'

import {
  isRadarReadonlyLogin,
  radarReadonlyLoginResponse,
} from '../../../../../lib/radarReadOnlyAudit'

const standardPOST = REST_POST(config)

export async function POST(request: NextRequest) {
  if (await isRadarReadonlyLogin(request)) {
    return radarReadonlyLoginResponse()
  }
  return standardPOST(request, {
    params: Promise.resolve({ slug: ['users', 'login'] }),
  })
}
