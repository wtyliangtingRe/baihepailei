import config from '@payload-config'
import { REST_GET } from '@payloadcms/next/routes'

import {
  isRadarReadonlyBearer,
  radarReadonlyFind,
} from '../../../../lib/radarReadOnlyAudit'

const standardGET = REST_GET(config)

export const GET: typeof standardGET = async (...args) => {
  const [request] = args
  if (isRadarReadonlyBearer(request)) {
    return radarReadonlyFind(request, 'works')
  }
  return standardGET(...args)
}
