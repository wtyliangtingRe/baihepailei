import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor as makeEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig } from 'payload'

import { isAdmin } from './src/access/roles'
import { AuditEvents } from './src/collections/AuditEvents'
import { Comments } from './src/collections/Comments'
import { Creators } from './src/collections/Creators'
import { Evidence } from './src/collections/Evidence'
import { FeedbackSubmissions } from './src/collections/FeedbackSubmissions'
import { Media } from './src/collections/Media'
import { Organizations } from './src/collections/Organizations'
import { RadarPublicConclusions } from './src/collections/RadarPublicConclusions'
import { RadarPublicRecords } from './src/collections/RadarPublicRecords'
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
import { withWorkLifecycleFields } from './src/collections/fields/workLifecycle'
import { recordAuditEvent } from './src/lib/audit'
import { syncWorkToPublicIndexes } from './src/lib/publicIndexSync'

/**
 * Stewardship notices are part of the current schema. Only an explicit false
 * disables them for a deliberately isolated migration process; the default is
 * true so an existing database is never asked to drop the stewardship tables.
 */
const payloadSchemaPush = String(process.env['PAYLOAD_DB_PUSH'] || 'false').toLowerCase() === 'true'
const stewardshipSchemaReady = String(process.env['STEWARDSHIP_NOTICES_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'
/**
 * Radar public conclusions are enabled by default. The migration preparer sets
 * this to false only while taking a no-SQL snapshot of the already-deployed
 * schema, then restores it before generating the additive Radar migration.
 */
const radarPublicConclusionsSchemaReady = String(process.env['RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'
/** Radar public records stay optional only during isolated migration snapshot generation. */
const radarPublicRecordsSchemaReady = String(process.env['RADAR_PUBLIC_RECORDS_SCHEMA_READY'] || 'true').toLowerCase() !== 'false'

const WorksWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Works) : Works
const CreatorsWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Creators) : Creators
const OrganizationsWithOptionalStewardship = stewardshipSchemaReady ? withStewardshipNotices(Organizations) : Organizations
const WorksWithRadarAssessment = withRadarAssessmentFields(WorksWithOptionalStewardship)
const WorksWithLifecycle = withWorkLifecycleFields(WorksWithRadarAssessment)
const WorksWithSafeLifecycleStatus: CollectionConfig = {
  ...WorksWithLifecycle,
  hooks: {
    ...WorksWithLifecycle.hooks,
    beforeValidate: [
      ...(WorksWithLifecycle.hooks?.beforeValidate || []),
      ({ context, data, originalDoc }) => {
        if (!data) return data

        // Payload keeps the technical _status column because version history is
        // enabled, but live Works no longer use a user-facing draft state.
        const next = { ...data } as Record<string, unknown>
        const previous = (originalDoc || {}) as Record<string, unknown>
        const flags = (context || {}) as Record<string, unknown>
        const legacyStatus = String(next.status || '').trim()
        delete next.status

        const requestedCatalog = String(next.catalogStatus || previous.catalogStatus || 'active').trim()
        const archived = legacyStatus === 'archived' || requestedCatalog === 'archived'
        const intakeTemporary = Boolean(flags.manualCreate || flags.feedbackIntake)
        const preserveTemporary = !flags.lifecycleStageUpdate
          && previous.catalogStatus === 'temporary'
          && requestedCatalog === 'active'

        if (archived) {
          next.catalogStatus = 'archived'
          next._status = 'draft'
          next.isLiteVisible = false
          next.isFullVisible = false
        } else {
          next.catalogStatus = requestedCatalog === 'temporary' || intakeTemporary || preserveTemporary
            ? 'temporary'
            : 'active'
          next._status = 'published'
          next.isLiteVisible = true
          next.isFullVisible = true

          const radar = (next.radarAssessment || previous.radarAssessment || {}) as Record<string, unknown>
          const human = (next.humanAssessment || previous.humanAssessment || {}) as Record<string, unknown>
          if (radar.assessedAt && human.status !== 'reviewed') {
            next.reviewStatus = next.reviewStatus === 'disputed' ? 'disputed' : 'pending'
            next.ratingNotice = 'ai_synthesized_pending_review'
          }
        }

        return next
      },
    ],
    afterChange: [
      ...(WorksWithLifecycle.hooks?.afterChange || []),
      async ({ context, doc, previousDoc, req, operation }) => {
        if (context?.auditEvent) return doc
        await recordAuditEvent({
          req,
          action: operation === 'create' ? 'work.created' : 'work.updated',
          targetCollection: 'works',
          targetID: doc?.id,
          targetTitle: doc?.title,
          summary: '作品内容被工作人员写入。',
          metadata: {
            operation,
            beforeRank: previousDoc?.rank,
            afterRank: doc?.rank,
            beforeReviewStatus: previousDoc?.reviewStatus,
            afterReviewStatus: doc?.reviewStatus,
            beforeCatalogStatus: previousDoc?.catalogStatus,
            afterCatalogStatus: doc?.catalogStatus,
            beforePublicationStatus: previousDoc?._status,
            afterPublicationStatus: doc?._status,
            beforeHumanAssessmentGrade: previousDoc?.humanAssessment?.grade,
            afterHumanAssessmentGrade: doc?.humanAssessment?.grade,
            beforeHumanAssessmentStatus: previousDoc?.humanAssessment?.status,
            afterHumanAssessmentStatus: doc?.humanAssessment?.status,
            beforeAISuggestedGrade: previousDoc?.radarAssessment?.suggestedGrade,
            afterAISuggestedGrade: doc?.radarAssessment?.suggestedGrade,
            humanNoteChanged: previousDoc?.humanAssessment?.note !== doc?.humanAssessment?.note,
            humanSourceSummaryChanged: previousDoc?.humanAssessment?.sourceSummary !== doc?.humanAssessment?.sourceSummary,
            aiSourceSummaryChanged: previousDoc?.radarAssessment?.sourceSummary !== doc?.radarAssessment?.sourceSummary,
            aiRuleSetChanged: JSON.stringify(previousDoc?.radarAssessment?.matchedRules || []) !== JSON.stringify(doc?.radarAssessment?.matchedRules || []),
            context: Object.keys(context || {}).filter((key) => key !== 'auditEvent'),
          },
        })
        if (!context?.firstPartyStudio) return doc
        try {
          syncWorkToPublicIndexes(doc)
        } catch (error) {
          console.error('Payload work saved but public index sync failed', { workID: doc?.id, error })
        }
        return doc
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await recordAuditEvent({
          req,
          action: 'work.deleted',
          targetCollection: 'works',
          targetID: doc?.id,
          targetTitle: doc?.title,
          summary: '作品记录被永久删除；软隐藏优先使用回收站。',
          metadata: {
            catalogStatus: doc?.catalogStatus,
            publicationStatus: doc?._status,
            reviewStatus: doc?.reviewStatus,
          },
        })
      },
    ],
  },
}
function withContentAudit(collection: CollectionConfig, targetCollection: string): CollectionConfig {
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [
        ...(collection.hooks?.afterChange || []),
        async ({ doc, previousDoc, req, operation }) => {
          await recordAuditEvent({
            req,
            action: operation === 'create' ? targetCollection + '.created' : targetCollection + '.updated',
            targetCollection,
            targetID: doc?.id,
            targetTitle: doc?.title || doc?.name,
            summary: targetCollection + ' 内容被工作人员写入。',
            metadata: {
              operation,
              beforeStatus: previousDoc?.status,
              afterStatus: doc?.status,
              beforeReviewStatus: previousDoc?.reviewStatus,
              afterReviewStatus: doc?.reviewStatus,
              beforeReviewOrigin: previousDoc?.reviewOrigin,
              afterReviewOrigin: doc?.reviewOrigin,
              beforeTitle: previousDoc?.title || previousDoc?.name,
              afterTitle: doc?.title || doc?.name,
              beforeSlug: previousDoc?.slug,
              afterSlug: doc?.slug,
            },
          })
        },
      ],
      afterDelete: [
        ...(collection.hooks?.afterDelete || []),
        async ({ doc, req }) => {
          await recordAuditEvent({
            req,
            action: targetCollection + '.deleted',
            targetCollection,
            targetID: doc?.id,
            targetTitle: doc?.title || doc?.name,
            summary: targetCollection + ' 记录被永久删除。',
            metadata: { status: doc?.status },
          })
        },
      ],
    },
  }
}

const CreatorsWithAudit = withContentAudit(CreatorsWithOptionalStewardship, 'creators')
const OrganizationsWithAudit = withContentAudit(OrganizationsWithOptionalStewardship, 'organizations')

const EvidenceWithAudit = withContentAudit(Evidence, 'evidence')
const RadarPublicConclusionsWithAudit = withContentAudit(RadarPublicConclusions, 'radar-public-conclusions')
const RadarPublicRecordsWithAudit = withContentAudit(RadarPublicRecords, 'radar-public-records')
const RadarResearchRecordsWithAudit = withContentAudit(RadarResearchRecords, 'radar-research-records')
const TermsWithAudit = withContentAudit(Terms, 'terms')
const WarningsWithAudit = withContentAudit(Warnings, 'warnings')
const TagsWithAudit = withContentAudit(Tags, 'tags')
const RulesWithAudit = withContentAudit(Rules, 'rules')

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
    AuditEvents,
    Media,
    WorksWithSafeLifecycleStatus,
    ...(radarPublicConclusionsSchemaReady ? [RadarPublicConclusionsWithAudit] : []),
    ...(radarPublicRecordsSchemaReady ? [RadarPublicRecordsWithAudit] : []),
    CreatorsWithAudit,
    OrganizationsWithAudit,
    EvidenceWithAudit,
    ...(stewardshipSchemaReady ? [StewardshipNotices] : []),
    RadarResearchRecordsWithAudit,
    Comments,
    UserLists,
    FeedbackSubmissions,
    TermsWithAudit,
    WarningsWithAudit,
    TagsWithAudit,
    RulesWithAudit,
  ],
  db: postgresAdapter({
    push: payloadSchemaPush,
    pool: {
      connectionString: String(process.env['DATABASE_URL'] || ''),
    },
  }),
  editor: makeEditor(),
  ...(emailAdapter ? { email: emailAdapter } : {}),
  secret: String(process.env['PAYLOAD_SECRET'] || ''),
  serverURL: String(process.env['NEXT_PUBLIC_SERVER_URL'] || 'http://localhost:3000'),
})