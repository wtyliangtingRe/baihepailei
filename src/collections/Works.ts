import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Works: CollectionConfig = {
  slug: 'works',
  labels: {
    singular: '作品',
    plural: '作品',
  },
  admin: {
    defaultColumns: ['title', 'rank', 'isLiteVisible', 'isFullVisible', 'status', 'updatedAt'],
    group: '内容',
    useAsTitle: 'title',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: publishedOrSignedIn,
    update: trustedAndUp,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: '标题',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      label: 'Slug',
      required: true,
      unique: true,
      admin: {
        description: '用于 URL 和导入匹配，例如 magical-girl-lyrical-nanoha。',
      },
    },
    {
      name: 'rank',
      type: 'select',
      label: '分级',
      required: true,
      defaultValue: 'unknown',
      options: [
        { label: 'S', value: 'S' },
        { label: 'AA', value: 'AA' },
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
        { label: 'C', value: 'C' },
        { label: 'D', value: 'D' },
        { label: 'E', value: 'E' },
        { label: 'F', value: 'F' },
        { label: '垃圾', value: 'trash' },
        { label: '未知', value: 'unknown' },
      ],
    },
    {
      name: 'originalTitle',
      type: 'text',
      label: '原名',
      admin: {
        description: '作品原始标题，例如日文、英文、韩文原名。',
      },
    },
    {
      name: 'aliases',
      type: 'array',
      label: '别名',
      fields: [
        {
          name: 'value',
          type: 'text',
          label: '别名',
        },
      ],
    },
    {
      name: 'isLiteVisible',
      type: 'checkbox',
      label: '进入 Lite 文字版',
      defaultValue: true,
      admin: {
        description: '关闭后不进入低成本文字主站。',
      },
    },
    {
      name: 'isFullVisible',
      type: 'checkbox',
      label: '进入 Full 完整版',
      defaultValue: true,
      admin: {
        description: '关闭后不进入完整归档/离线包。',
      },
    },
    {
      name: 'hasEvidence',
      type: 'checkbox',
      label: '有证据材料',
      defaultValue: false,
      admin: {
        description: '用于提示 Full 版是否存在截图、附件或来源材料。',
      },
    },
    {
      name: 'creators',
      type: 'relationship',
      label: '创作者',
      relationTo: 'creators',
      hasMany: true,
    },
    {
      name: 'organizations',
      type: 'array',
      label: '相关机构',
      admin: {
        description: '出版社、制作公司、发行商、平台、制作委员会等机构关系。',
      },
      fields: [
        {
          name: 'organization',
          type: 'relationship',
          label: '机构',
          relationTo: 'organizations',
          required: true,
        },
        {
          name: 'role',
          type: 'select',
          label: '机构角色',
          defaultValue: 'other',
          required: true,
          options: [
            { label: '出版社', value: 'publisher' },
            { label: '制作公司', value: 'production_company' },
            { label: '动画制作', value: 'animation_studio' },
            { label: '游戏开发', value: 'game_developer' },
            { label: '发行商', value: 'distributor' },
            { label: '社团', value: 'circle' },
            { label: '品牌', value: 'brand' },
            { label: '平台', value: 'platform' },
            { label: '制作委员会', value: 'committee' },
            { label: '版权方', value: 'rights_holder' },
            { label: '其他', value: 'other' },
          ],
        },
        {
          name: 'note',
          type: 'text',
          label: '备注',
          admin: {
            description: '可记录具体名义、系列品牌、旧站说明或迁移备注。',
          },
        },
      ],
    },
    {
      name: 'tags',
      type: 'relationship',
      label: '标签',
      relationTo: 'tags',
      hasMany: true,
    },
    {
      name: 'warnings',
      type: 'relationship',
      label: '注意点',
      relationTo: 'warnings',
      hasMany: true,
    },
    {
      name: 'cover',
      type: 'upload',
      label: '封面',
      relationTo: 'media',
    },
    {
      name: 'summary',
      type: 'richText',
      label: '摘要',
    },
    {
      name: 'analysis',
      type: 'richText',
      label: '分析',
    },
    {
      name: 'sourceLinks',
      type: 'array',
      label: '来源链接',
      fields: [
        {
          name: 'label',
          type: 'text',
          label: '名称',
        },
        {
          name: 'url',
          type: 'text',
          label: 'URL',
        },
      ],
    },
    {
      name: 'searchText',
      type: 'textarea',
      label: '搜索补充文本',
      admin: {
        description: '用于导出前台搜索索引的补充文本，不在数据库中建立 btree 索引。可放日文名、英文名、别名、作者名、关键词、旧站残留关键字等。',
      },
    },
    {
      name: 'evidenceNote',
      type: 'textarea',
      label: '证据备注',
      admin: {
        description: '先记录证据材料说明；后续可迁移到独立 evidence collection。',
      },
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
      label: '旧 XWiki 页面',
      admin: {
        description: '旧站页面全名，仅用于迁移追踪。',
      },
    },
    {
      name: 'status',
      type: 'select',
      label: '状态',
      defaultValue: 'draft',
      required: true,
      options: [
        { label: '草稿', value: 'draft' },
        { label: '待审核', value: 'review' },
        { label: '已发布', value: 'published' },
        { label: '归档', value: 'archived' },
      ],
    },
  ],
}
