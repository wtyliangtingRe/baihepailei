import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor as makeEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig } from 'payload'

import { isAdmin } from './src/access/roles'
import { Comments } from './src/collections/Comments'
import { Creators } from './src/collections/Creators'
import { Evidence } from './src/collections/Evidence'
import { FeedbackSubmissions } from './src/collections/FeedbackSubmissions'
import { Media } from './src/collections/Media'
import { Organizations } from './src/collections/Organizations'
import { RadarResearchRecords } from './src/collections/RadarResearchRecords'
import { Rules } from './src/collections/Rules'
import { StewardshipNotices } from './src/collections/StewardshipNotices'
import { Tags } from './src/collections/Tags'
import { Terms } from './src/collections/Terms'
import { UserLists } from './src/collections/UserLists'
import { Users } from './src/collections/Users'
import { Warnings } from './src/collections/Warnings'
import { Works } from './src/collections/Works'
import { withRadarAssessmentFields } from './src/collections/fields/radarAssessment'
import { withStewardshipNotices } from './src/collections/fields/stewardshipNotices'
import { syncWorkToPublicIndexes } from './src/lib/publicIndexSync'

/**
 * Stewardship notices are part of the current schema. Only an explicit false
 * disables them for a deliberately isolated migration process; the default is
 * true so an existing database is never asked to drop the stewardship tables.
 */
const stewardshipSchemaReady = String(process.env['STEWARDSHIP_NOTICES_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'

const WorksWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Works) : Works
const CreatorsWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Creators) : Creators
const OrganizationsWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Organizations) : Organizations
const WorksWithRadarAssessment = withRadarAssessmentFields(WorksWithOptionalStewardship)
const WorksWithSafePublicationStatus: CollectionConfig = {
  ...WorksWithRadarAssessment,
  hooks: {
    ...WorksWithRadarAssessment.hooks,
    beforeValidate: [
      ...(WorksWithRadarAssessment.hooks?.beforeValidate || []),
      ({ data }) => {
        if (!data || data.status !== 'review') return data
        return {
          ...data,
          status: data.reviewStatus === 'reviewed' ? 'published' : 'draft',
        }
      },
    ],
    afterChange: [
      ...(WorksWithRadarAssessment.hooks?.afterChange || []),
      async ({ context, doc }) => {
        if (!context?.firstPartyStudio) return doc
        try {
          syncWorkToPublicIndexes(doc)
        } catch (error) {
          console.error('Payload work saved but public index sync failed', { workID: doc?.id, error })
        }
        return doc
      },
    ],
  },
}
const UsersWithRestrictedAdmin: CollectionConfig = {
  ...Users,
  access: {
    ...Users.access,
    admin: ({ req }) => isAdmin(req.user),
  },
}

function smtpValue(value: unknown) {
  const normalized = String(value || '').trim()
  const placeholder = normalized.toLowerCase()
  if (
    !normalized ||
    placeholder === 'change_me' ||
    placeholder === 'smtp.example.com' ||
    placeholder.endsWith('@example.com')
  ) {
    return ''
  }
  return normalized
}

const smtpHost = smtpValue(process.env['SMTP_HOST'])
const smtpUser = smtpValue(process.env['SMTP_USER'])
const smtpPass = smtpValue(process.env['SMTP_PASS'])
const smtpFromAddress = smtpValue(process.env['SMTP_FROM_ADDRESS'])
const emailAdapter = smtpHost
  ? nodemailerAdapter({
      defaultFromAddress: smtpFromAddress || smtpUser || 'no-reply@localhost',
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
    user: UsersWithRestrictedAdmin.slug,
  },
  collections: [
    UsersWithRestrictedAdmin,
    Media,
    WorksWithSafePublicationStatus,
    CreatorsWithOptionalStewardship,
    OrganizationsWithOptionalStewardship,
    Evidence,
    ...(stewardshipSchemaReady ? [StewardshipNotices] : []),
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
