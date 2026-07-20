import configPromise from '@payload-config'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { getRole, isAdmin, isEditor } from '@/access/roles'

import { canonicalContentUrl } from '../../../../../_lib/content-identity'
import { plainTextToRichText, richTextToPlainText } from '@/lib/richTextPlain'

export const dynamic = 'force-dynamic'

type EntityCollection = 'creators' | 'organizations'
type LocalizedName = {
  name?: string
  language?: string
  kind?: string
  region?: string
  isPrimary?: boolean
  source?: string
  note?: string
}
type Relation = string | number | { id?: string | number } | null | undefined
type Entity = {
  id: string | number
  name?: string
  slug?: string
  siteId?: string
  rank?: string
  type?: string
  aliases?: Array<{ value?: string } | string>
  localizedNames?: LocalizedName[]
  notes?: unknown
  profileImage?: Relation
  reviewStatus?: string
  reviewOrigin?: string
  humanReviewNote?: string
  searchText?: string
  sourceLinks?: Array<{ label?: string; url?: string }>
  isLiteVisible?: boolean
  isFullVisible?: boolean
  status?: string
}

const organizationTypes = ['publisher', 'production_company', 'animation_studio', 'game_company', 'distributor', 'circle', 'brand', 'platform', 'committee', 'other']
const languages = new Set(['ja', 'zh-Hans', 'zh-Hant', 'en', 'ko', 'fr', 'de', 'es', 'und', 'other', 'unknown'])
const nameKinds = new Set(['original', 'official', 'localized', 'romanized', 'alias', 'legal', 'former', 'search_only', 'other'])

function collectionOf(value: string): EntityCollection | null {
  return value === 'organizations' ? 'organizations' : value === 'creators' ? 'creators' : null
}
function canEdit(user: unknown) {
  return isEditor(user)
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}
function text(formData: FormData, key: string, max = 4000) {
  return String(formData.get(key) || '').trim().slice(0, max)
}
function lines(value: string) {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))]
}
function aliasesText(value: Entity['aliases']) {
  return (value || []).map((item) => typeof item === 'string' ? item : item?.value || '').filter(Boolean).join('\n')
}
function sourceLinksText(value: Entity['sourceLinks']) {
  return (value || []).map((item) => [item?.label, item?.url].filter(Boolean).join(' | ')).filter(Boolean).join('\n')
}
function relationID(value: Relation) {
  return value && typeof value === 'object' ? String(value.id || '') : String(value || '')
}
function localizedNamesText(value: Entity['localizedNames']) {
  return (value || []).map((item) => {
    const name = String(item?.name || '').trim()
    if (!name) return ''
    return [item.language || 'unknown', item.kind || 'alias', name, item.region || '', item.isPrimary ? 'primary' : '', item.source || '', item.note || ''].join(' | ')
  }).filter(Boolean).join('\n')
}
function localizedNamesFromText(value: string): LocalizedName[] {
  return lines(value).flatMap((line) => {
    const parts = line.split('|').map((part) => part.trim())
    const name = parts[2] || parts[0]
    if (!name) return []
    return [{
      language: languages.has(parts[0]) ? parts[0] : 'unknown',
      kind: nameKinds.has(parts[1]) ? parts[1] : 'alias',
      name,
      region: parts[3] || '',
      isPrimary: parts[4] === 'primary',
      source: parts[5] || 'manual',
      note: parts[6] || '',
    }]
  })
}
function sourceLinksFromText(value: string) {
  return lines(value).flatMap((line) => {
    const [label, ...urlParts] = line.split('|').map((part) => part.trim())
    const url = urlParts.join('|')
    if (!url) return []
    return [{ label: label || url, url }]
  })
}

async function saveEntity(formData: FormData) {
  'use server'
  const collection = collectionOf(String(formData.get('collection') || ''))
  const id = text(formData, 'id', 80)
  if (!collection || !id) throw new Error('invalid_entity')

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user || !canEdit(auth.user)) throw new Error('没有实体编辑权限。')

  const name = text(formData, 'name', 300)
  const slug = text(formData, 'slug', 300)
  const status = text(formData, 'status', 20)
  const reviewStatus = text(formData, 'reviewStatus', 20)
  const reviewOrigin = text(formData, 'reviewOrigin', 40)
  if (!name || !slug || !['draft', 'review', 'published', 'archived'].includes(status)) {
    throw new Error('名称、Slug 或状态无效。')
  }

  const data: Record<string, unknown> = {
    name,
    slug,
    siteId: text(formData, 'siteId', 200),
    aliases: lines(text(formData, 'aliases', 4000)).map((value) => ({ value })),
    localizedNames: localizedNamesFromText(text(formData, 'localizedNames', 8000)),
    notes: plainTextToRichText(text(formData, 'notes', 12000)),
    reviewStatus: ['pending', 'reviewed', 'disputed', 'deprecated'].includes(reviewStatus) ? reviewStatus : 'pending',
    reviewOrigin: ['unassessed', 'ai_assessed', 'human_reviewed', 'imported_unverified'].includes(reviewOrigin) ? reviewOrigin : 'unassessed',
    humanReviewNote: text(formData, 'humanReviewNote', 4000),
    searchText: text(formData, 'searchText', 6000),
    status,
    isLiteVisible: formData.get('isLiteVisible') === 'on',
    isFullVisible: formData.get('isFullVisible') === 'on',
  }

  if (collection === 'creators') {
    const rank = text(formData, 'rank', 20)
    const profileImageID = text(formData, 'profileImage', 40)
    data.rank = ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'].includes(rank) ? rank : 'unknown'
    data.profileImage = /^\d+$/u.test(profileImageID) ? Number(profileImageID) : null
  } else {
    const type = text(formData, 'type', 40)
    data.type = organizationTypes.includes(type) ? type : 'other'
    data.sourceLinks = sourceLinksFromText(text(formData, 'sourceLinks', 6000))
  }

  if (reviewStatus !== 'pending') {
    data.humanReviewedAt = new Date().toISOString()
    data.humanReviewedBy = (auth.user as { id?: string | number }).id
  }

  await payload.update({
    collection,
    id,
    depth: 0,
    draft: false,
    overrideAccess: true,
    context: { reviewWorkbench: true, auditActorID: (auth.user as { id?: string | number }).id },
    data: data as never,
  })

  revalidatePath('/me/studio/entities/' + collection + '/' + id)
  revalidatePath('/me/studio/entities/' + collection)
  revalidatePath(canonicalContentUrl(collection, id))
  redirect('/me/studio/entities/' + collection + '/' + id + '?saved=1')
}

export default async function EntityEditor({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { collection: rawCollection, id } = await params
  const collection = collectionOf(rawCollection)
  if (!collection) notFound()

  const payload = await getPayload({ config: configPromise })
  const auth = await payload.auth({ headers: await headers() })
  if (!auth.user) redirect('/account/login?redirect=' + encodeURIComponent('/me/studio/entities/' + collection + '/' + id))
  if (!canEdit(auth.user)) {
    return <main className="page review-workbench"><section className="review-empty"><h1>权限不足</h1></section></main>
  }

  const entity = await payload.findByID({
    collection,
    id,
    depth: 0,
        overrideAccess: true,
  }) as unknown as Entity
  const paramsValue = await searchParams
  const isCreator = collection === 'creators'
  const canOpenPayloadAdmin = isAdmin(auth.user)

  return (
    <main className="page review-workbench">
      <section className="review-hero">
        <div className="review-hero-copy">
          <p className="eyebrow">{isCreator ? '创作者' : '机构'}完整编辑</p>
          <h1>{entity.name || ('记录 #' + entity.id)}</h1>
          <p className="muted">编辑常用资料、别名、多语言名称、备注、审核状态和可见性。复杂关系仍可从完整后台补充。</p>
        </div>
        <div className="review-row-actions">
          <Link className="review-link" href={'/me/studio/entities/' + collection}>返回列表</Link>
          <Link className="review-link" href={canonicalContentUrl(collection, entity.id)}>查看前台</Link>
          {canOpenPayloadAdmin ? <Link className="review-link" href={'/admin/collections/' + collection + '/' + entity.id}>完整 Payload 编辑</Link> : null}
        </div>
      </section>

      {first(paramsValue.saved) ? (
        <div className="review-action-message review-action-message-success" role="status">
          已保存，前台索引会在下一次完整导出或同步后更新。
        </div>
      ) : null}

      <form action={saveEntity} className="review-editor-form">
        <input name="collection" type="hidden" value={collection} />
        <input name="id" type="hidden" value={String(entity.id)} />

        <section className="review-editor-section">
          <header><h2>身份与搜索</h2><p>这些字段影响内部匹配与前台检索。</p></header>
          <div className="review-editor-grid">
            <label className="review-editor-field"><span>名称</span><input defaultValue={entity.name || ''} name="name" required /></label>
            <label className="review-editor-field"><span>Slug</span><input defaultValue={entity.slug || ''} name="slug" required /></label>
            <label className="review-editor-field"><span>站内 ID / Site ID</span><input defaultValue={entity.siteId || ''} name="siteId" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>别名（每行一个）</span><textarea defaultValue={aliasesText(entity.aliases)} name="aliases" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>多语言名称（每行：语言 | 类型 | 名称 | 地区 | primary | 来源 | 备注）</span><textarea defaultValue={localizedNamesText(entity.localizedNames)} name="localizedNames" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>备注</span><textarea defaultValue={richTextToPlainText(entity.notes)} name="notes" /></label>
            <label className="review-editor-field review-editor-field-wide"><span>搜索补充文本</span><textarea defaultValue={entity.searchText || ''} name="searchText" /></label>
          </div>
        </section>

        <section className="review-editor-section">
          <header><h2>审核与可见性</h2><p>状态可编辑，但发布仍需遵守本站双轨和内容边界。</p></header>
          <div className="review-editor-grid">
            {isCreator ? (
              <>
                <label className="review-editor-field"><span>分级</span><select defaultValue={entity.rank || 'unknown'} name="rank">{['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className="review-editor-field"><span>头像 / 图片 Media ID（留空清除）</span><input defaultValue={relationID(entity.profileImage)} inputMode="numeric" name="profileImage" /></label>
              </>
            ) : (
              <>
                <label className="review-editor-field"><span>机构类型</span><select defaultValue={entity.type || 'other'} name="type">{organizationTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                <label className="review-editor-field review-editor-field-wide"><span>来源链接（每行“名称 | URL”）</span><textarea defaultValue={sourceLinksText(entity.sourceLinks)} name="sourceLinks" /></label>
              </>
            )}
            <label className="review-editor-field"><span>复核状态</span><select defaultValue={entity.reviewStatus || 'pending'} name="reviewStatus">{['pending', 'reviewed', 'disputed', 'deprecated'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="review-editor-field"><span>评估来源</span><select defaultValue={entity.reviewOrigin || 'unassessed'} name="reviewOrigin">{['unassessed', 'ai_assessed', 'human_reviewed', 'imported_unverified'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="review-editor-field"><span>状态</span><select defaultValue={entity.status || 'draft'} name="status">{['draft', 'review', 'published', 'archived'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="review-editor-field review-editor-field-wide"><span>人工复核记录</span><textarea defaultValue={entity.humanReviewNote || ''} name="humanReviewNote" /></label>
            <label className="review-editor-check"><input defaultChecked={entity.isLiteVisible !== false} name="isLiteVisible" type="checkbox" /><span>进入 Lite 文字版</span></label>
            <label className="review-editor-check"><input defaultChecked={entity.isFullVisible !== false} name="isFullVisible" type="checkbox" /><span>完整版可见</span></label>
          </div>
        </section>

        <div className="review-editor-submit">
          <button className="review-button review-button-primary" type="submit">保存实体</button>
          <Link className="review-link" href={'/me/studio/entities/' + collection}>取消</Link>
        </div>
      </form>
    </main>
  )
}
