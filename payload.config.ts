import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor as makeEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Comments } from './src/collections/Comments'
import { Creators } from './src/collections/Creators'
import { Evidence } from './src/collections/Evidence'
import { FeedbackSubmissions } from './src/collections/FeedbackSubmissions'
import { Media } from './src/collections/Media'
import { Organizations } from './src/collections/Organizations'
import { RadarResearchRecords } from './src/collections/RadarResearchRecords'
import { Rules } from './src/collections/Rules'
import { Tags } from './src/collections/Tags'
import { Terms } from './src/collections/Terms'
import { UserLists } from './src/collections/UserLists'
import { Users } from './src/collections/Users'
import { Warnings } from './src/collections/Warnings'
import { Works } from './src/collections/Works'
import { withRadarAssessmentFields } from './src/collections/fields/radarAssessment'

const WorksWithRadarAssessment = withRadarAssessmentFields(Works)
const smtpHost = String(process.env['SMTP_HOST'] || '').trim()
const smtpUser = String(process.env['SMTP_USER'] || '').trim()
const smtpPass = String(process.env['SMTP_PASS'] || '')
const emailAdapter = smtpHost
  ? nodemailerAdapter({
      defaultFromAddress: String(process.env['SMTP_FROM_ADDRESS'] || smtpUser || 'no-reply@localhost'),
      defaultFromName: String(process.env['SMTP_FROM_NAME'] || 'Baihepailei'),
      transportOptions: {
        host: smtpHost,
        port: Number(process.env['SMTP_PORT'] || 587),
        secure: String(process.env['SMTP_SECURE'] || '').toLowerCase() === 'true',
        auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
      },
    })
  : undefined

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [
    Users,
    Media,
    WorksWithRadarAssessment,
    Creators,
    Organizations,
    Evidence,
    RadarResearchRecords,
    Comments,
    UserLists,
    FeedbackSubmissions,
    Terms,
    Warnings,
    Tags,
    Rules,
  ],
  db: postgresAdapter({
    pool: {
      connectionString: String(process.env['DATABASE_URL'] || ''),
    },
  }),
  editor: makeEditor(),
  ...(emailAdapter ? { email: emailAdapter } : {}),
  secret: String(process.env['PAYLOAD_SECRET'] || ''),
  serverURL: String(process.env['NEXT_PUBLIC_SERVER_URL'] || 'http://localhost:3000'),
})
