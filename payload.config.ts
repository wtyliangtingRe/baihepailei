import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { Creators } from './src/collections/Creators'
import { Media } from './src/collections/Media'
import { Rules } from './src/collections/Rules'
import { Terms } from './src/collections/Terms'
import { Users } from './src/collections/Users'

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, Creators, Terms, Rules],
  db: postgresAdapter({
    pool: {
      connectionString: String(process.env['DATABASE_URL'] || ''),
    },
  }),
  secret: String(process.env['PAYLOAD_SECRET'] || ''),
})
