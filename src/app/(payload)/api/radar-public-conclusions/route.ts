import config from '@payload-config'
import { REST_GET } from '@payloadcms/next/routes'
import type { NextRequest } from 'next/server'

import {
  isRadarReadonlyBearer,
  radarReadonlyFind,
} from '../../../../lib/radarReadOnlyAudit'

const standardGET = REST_GET(config)

export async function GET(request: NextRequest) {
  if (isRadarReadonlyBearer(request)) {
    return radarReadonlyFind(request, 'radar-public-conclusions')
  }
  return standardGET(request, {
    params: Promise.resolve({ slug: ['radar-public-conclusions'] }),
  })
}
