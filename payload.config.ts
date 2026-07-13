import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor as makeEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Comments } from './src/collections/Comments'
import { Creators } from './src/collections/Creators'
import { Evidence } from './src/collections/Evidence'
import { Media } from './src/collections/Media'
import { Organizations } from './src/collections/Organizations'
import { Rules } from './src/collections/Rules'
import { Tags } from './src/collections/Tags'
import { Terms } from './src/collections/Terms'
import { UserLists } from './src/collections/UserLists'
import { Users } from './src/collections/Users'
import { Warnings } from './src/collections/Warnings'
import { Works } from './src/collections/Works'
import { withRadarAssessmentFields } from './src/collections/fields/radarAssessment'

const WorksWithRadarAssessment = withRadarAssessmentFields(Works)

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, WorksWithRadarAssessment, Creators, Organizations, Evidence, Comments, UserLists, Terms, Warnings, Tags, Rules],
  db: postgresAdapter({
    pool: {
      connectionString: String(process.env['DATABASE_URL'] || ''),
    },
  }),
  editor: makeEditor(),
  secret: String(process.env['PAYLOAD_SECRET'] || ''),
})
