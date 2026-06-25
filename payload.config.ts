import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor as makeEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Creators } from './src/collections/Creators'
import { Evidence } from './src/collections/Evidence'
import { Media } from './src/collections/Media'
import { Organizations } from './src/collections/Organizations'
import { Rules } from './src/collections/Rules'
import { Tags } from './src/collections/Tags'
import { Terms } from './src/collections/Terms'
import { Users } from './src/collections/Users'
import { Warnings } from './src/collections/Warnings'
import { Works } from './src/collections/Works'

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, Works, Creators, Organizations, Evidence, Terms, Warnings, Tags, Rules],
  db: postgresAdapter({
    pool: {
      connectionString: String(process.env['DATABASE_URL'] || ''),
    },
  }),
  editor: makeEditor(),
  secret: String(process.env['PAYLOAD_SECRET'] || ''),
})
