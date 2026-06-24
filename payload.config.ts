import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'

import { Creators } from './src/collections/Creators'
import { Entries } from './src/collections/Entries'
import { Media } from './src/collections/Media'
import { Rules } from './src/collections/Rules'
import { Terms } from './src/collections/Terms'
import { Users } from './src/collections/Users'

const dbUrl = process.env['DATABASE_URL']
const appSecret = process.env['PAYLOAD_SECRET'] || ''

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, Entries, Creators, Terms, Rules],
  db: postgresAdapter({
    pool: {
      connectionString: dbUrl,
    },
  }),
  secret: appSecret,
})
