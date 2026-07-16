import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { defaultColumns: ['filename', 'mediaScope', 'updatedAt'], group: '内容' },
  access: { create: trustedAndUp, delete: trustedAndUp, read: anyone, update: trustedAndUp },
  upload: { staticDir: 'media' },
  fields: [
    { name: 'alt', type: 'text', label: 'Alt text' },
    { name: 'caption', type: 'text', label: 'Caption' },
    {
      name: 'mediaScope', type: 'select', label: '媒体用途', defaultValue: 'legacy', required: true,
      options: [
        { label: '站点 UI / Logo', value: 'site-ui' }, { label: '封面', value: 'cover' },
        { label: '证据截图', value: 'evidence' }, { label: '历史归档附件', value: 'legacy' }, { label: '仅 Full 完整版', value: 'full-only' },
      ],
      admin: { description: '低流量正式版不渲染封面和证据图片；增强媒体版可按用途展示。' },
    },
    { name: 'legacyXWikiPage', type: 'text', admin: { hidden: true } },
    { name: 'originalFilename', type: 'text', label: '原始文件名', admin: { description: '外部来源中的原始文件名。' } },
    { name: 'sourceNote', type: 'textarea', label: '来源备注', admin: { description: '记录图片来源、证据说明和整理备注等。' } },
  ],
}
