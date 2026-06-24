import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    defaultColumns: ['filename', 'mediaScope', 'updatedAt'],
    group: '内容',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: anyone,
    update: trustedAndUp,
  },
  upload: {
    staticDir: 'media',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Alt text',
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
    },
    {
      name: 'mediaScope',
      type: 'select',
      label: '媒体用途',
      defaultValue: 'legacy',
      required: true,
      options: [
        { label: '站点 UI / Logo', value: 'site-ui' },
        { label: '封面', value: 'cover' },
        { label: '证据截图', value: 'evidence' },
        { label: '旧站附件', value: 'legacy' },
        { label: '仅 Full 完整版', value: 'full-only' },
      ],
      admin: {
        description: 'Lite 主站默认只使用 site-ui，cover 可选；evidence / legacy / full-only 默认只进入 Full 版。',
      },
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
      label: '旧 XWiki 页面',
      admin: {
        description: '旧站附件来源页面，仅用于迁移追踪。',
      },
    },
    {
      name: 'originalFilename',
      type: 'text',
      label: '原始文件名',
      admin: {
        description: '旧站或外部来源中的原始文件名。',
      },
    },
    {
      name: 'sourceNote',
      type: 'textarea',
      label: '来源备注',
      admin: {
        description: '记录图片来源、证据说明、迁移备注等。',
      },
    },
  ],
}
