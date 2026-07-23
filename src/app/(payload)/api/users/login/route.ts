import config from '@payload-config'
import { REST_POST } from '@payloadcms/next/routes'

import {
  isRadarReadonlyLogin,
  radarReadonlyLoginResponse,
} from '../../../../../lib/radarReadOnlyAudit'

const standardPOST = REST_POST(config)

export const POST: typeof standardPOST = async (...args) => {
  const [request] = args
  if (await isRadarReadonlyLogin(request)) {
    return radarReadonlyLoginResponse()
  }
  return standardPOST(...args)
}
