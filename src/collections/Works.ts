import type { CollectionConfig, CollectionSlug } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

const reviewStatusOptions = [
  { label: '待复核', value: 'pending' },
  { label: '已复核', value: 'reviewed' },
  { label: '有争议', value: 'disputed' },
  { label: '已废弃', value: 'deprecated' },
]

const evidenceStrengthOptions = [
  { label: '未评估', value: 'unassessed' },
  { label: '弱', value: 'weak' },
  { label: '中', value: 'medium' },
  { label: '强', value: 'strong' },
]

const mediaTypeOptions = [
  { label: '动画', value: 'anime' },
  { label: '漫画', value: 'manga' },
  { label: '小说', value: 'novel' },
  { label: '轻小说', value: 'light_novel' },
  { label: '视觉小说', value: 'visual_novel' },
  { label: '游戏', value: 'game' },
  { label: '广播剧 / 音声', value: 'audio_drama' },
  { label: '真人影视', value: 'live_action' },
  { label: 'Webtoon', value: 'webtoon' },
  { label: '同人作品', value: 'doujin' },
  { label: '合集 / 选集', value: 'anthology' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const workFormatOptions = [
  { label: 'TV 动画', value: 'tv_anime' },
  { label: '动画电影', value: 'anime_movie' },
  { label: 'OVA', value: 'ova' },
  { label: 'ONA / 网络动画', value: 'ona' },
  { label: '漫画连载', value: 'manga_series' },
  { label: '漫画短篇', value: 'manga_oneshot' },
  { label: '小说系列', value: 'novel_series' },
  { label: '轻小说系列', value: 'light_novel_series' },
  { label: 'Web 连载', value: 'web_serial' },
  { label: '视觉小说', value: 'visual_novel' },
  { label: 'PC 游戏', value: 'pc_game' },
  { label: '主机游戏', value: 'console_game' },
  { label: '手机游戏', value: 'mobile_game' },
  { label: '广播剧 / 音声', value: 'audio_drama' },
  { label: '真人影视', value: 'live_action' },
  { label: 'Webtoon 连载', value: 'webtoon_series' },
  { label: '同人作品', value: 'doujin' },
  { label: '合集 / 选集', value: 'anthology' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const datePrecisionOptions = [
  { label: '精确到日', value: 'day' },
  { label: '精确到月', value: 'month' },
  { label: '精确到年', value: 'year' },
  { label: '未知', value: 'unknown' },
]

const candidateSourceOptions = [
  { label: 'Bangumi', value: 'bangumi' },
  { label: 'AniList', value: 'anilist' },
  { label: 'VNDB', value: 'vndb' },
  { label: 'Wikidata', value: 'wikidata' },
  { label: 'Wikipedia', value: 'wikipedia' },
  { label: '手动整理', value: 'manual' },
  { label: '其他', value: 'other' },
]

const riskUnassessedOption = { label: '未评估', value: 'unassessed' }

export const Works: CollectionConfig = {
  slug: 'works',
  labels: {
    singular: '作品',
    plural: '作品',
  },
  admin: {
    defaultColumns: ['title', 'mediaType', 'rank', 'reviewStatus', 'evidenceStrength', 'isLiteVisible', 'status', 'updatedAt'],
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
      name: 'reviewStatus',
      type: 'select',
      label: '复核状态',
      required: true,
      defaultValue: 'pending',
      options: reviewStatusOptions,
      admin: {
        description: '新站自己的复核状态，不表示旧站来源。',
      },
    },
    {
      name: 'evidenceStrength',
      type: 'select',
      label: '证据强度',
      required: true,
      defaultValue: 'unassessed',
      options: evidenceStrengthOptions,
      admin: {
        description: '按当前新站证据材料评估强弱；未评估不等于没有证据。',
      },
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
      name: 'mediaType',
      type: 'select',
      label: '作品类型',
      defaultValue: 'unknown',
      required: true,
      options: mediaTypeOptions,
      admin: {
        description: '用于区分动画、漫画、小说、游戏、视觉小说等候选作品底板类型。',
      },
    },
    {
      name: 'format',
      type: 'select',
      label: '作品形态',
      defaultValue: 'unknown',
      options: workFormatOptions,
      admin: {
        description: '比作品类型更细的形态，例如 TV 动画、漫画连载、视觉小说、手机游戏等。',
      },
    },
    {
      name: 'firstPublishedAt',
      type: 'date',
      label: '首次发表 / 播出 / 发售日期',
      admin: {
        description: '用于排序的机器日期。若只知道年份，可先填当年 1 月 1 日，并用日期精度和显示文本说明。',
      },
    },
    {
      name: 'firstPublishedPrecision',
      type: 'select',
      label: '首次日期精度',
      defaultValue: 'unknown',
      options: datePrecisionOptions,
      admin: {
        description: '避免把只知道年份或月份的外部数据误显示成精确日期。',
      },
    },
    {
      name: 'firstPublishedLabel',
      type: 'text',
      label: '首次日期显示文本',
      admin: {
        description: '前台可优先显示这个文本，例如 2015、2015-04、2018-10-05、待定。',
      },
    },
    {
      name: 'externalIds',
      type: 'group',
      label: '外部 ID',
      admin: {
        description: '用于候选导入、去重和跨来源对齐，不直接代表本站复核结论。',
      },
      fields: [
        { name: 'bangumiSubjectId', type: 'text', label: 'Bangumi Subject ID' },
        { name: 'anilistMediaId', type: 'text', label: 'AniList Media ID' },
        { name: 'vndbId', type: 'text', label: 'VNDB ID' },
        { name: 'wikidataQid', type: 'text', label: 'Wikidata QID' },
        { name: 'malId', type: 'text', label: 'MyAnimeList ID' },
        { name: 'officialUrl', type: 'text', label: '官网 URL' },
      ],
    },
    {
      name: 'candidateSources',
      type: 'array',
      label: '候选来源',
      admin: {
        description: '记录候选作品来自哪些外部来源。这里只保存来源链接和派生说明，不保存用户评论原文。',
      },
      fields: [
        {
          name: 'source',
          type: 'select',
          label: '来源',
          defaultValue: 'other',
          options: candidateSourceOptions,
        },
        { name: 'label', type: 'text', label: '来源名称' },
        { name: 'externalId', type: 'text', label: '来源 ID' },
        { name: 'url', type: 'text', label: '来源链接' },
        { name: 'fetchedAt', type: 'date', label: '采集时间' },
        { name: 'note', type: 'textarea', label: '来源备注' },
      ],
    },
    {
      name: 'candidateReasons',
      type: 'array',
      label: '入选候选理由',
      admin: {
        description: '例如 Bangumi 标签命中、AniList Yuri tag、Wikidata 类型匹配、旧站已有记录等。',
      },
      fields: [
        {
          name: 'value',
          type: 'text',
          label: '理由',
        },
      ],
    },
    {
      name: 'yuriCandidateScore',
      type: 'number',
      label: '百合候选分',
      min: 0,
      max: 1,
      admin: {
        description: '0 到 1 的候选强度分，只用于底板导入和复核排序，不代表本站评级。',
      },
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
      name: 'riskMatrix',
      type: 'group',
      label: '雷点 / 注意点矩阵',
      admin: {
        description: '用于作品页快速展示核心排雷维度；没有把握时保持未评估即可。',
      },
      fields: [
        {
          name: 'maleImpact',
          type: 'select',
          label: '男性角色影响',
          defaultValue: 'unassessed',
          options: [
            riskUnassessedOption,
            { label: '无', value: 'none' },
            { label: '轻微', value: 'minor' },
            { label: '明显', value: 'noticeable' },
            { label: '严重', value: 'severe' },
          ],
        },
        {
          name: 'relationshipClarity',
          type: 'select',
          label: '恋爱关系明确度',
          defaultValue: 'unassessed',
          options: [
            riskUnassessedOption,
            { label: '明确恋爱', value: 'confirmed' },
            { label: '发展中', value: 'developing' },
            { label: '暧昧 / 亚文本', value: 'subtext' },
            { label: '友情向', value: 'friendship' },
            { label: '不明确', value: 'unclear' },
          ],
        },
        {
          name: 'endingSafety',
          type: 'select',
          label: '结局安全性',
          defaultValue: 'unassessed',
          options: [
            riskUnassessedOption,
            { label: '安全', value: 'safe' },
            { label: '开放式', value: 'open' },
            { label: '未完结', value: 'unfinished' },
            { label: '有风险', value: 'risky' },
            { label: '明确雷', value: 'bad' },
          ],
        },
        {
          name: 'creatorSpeechRisk',
          type: 'select',
          label: '创作者言论风险',
          defaultValue: 'unassessed',
          options: [
            riskUnassessedOption,
            { label: '无记录', value: 'none' },
            { label: '轻微', value: 'minor' },
            { label: '有争议', value: 'disputed' },
            { label: '严重', value: 'severe' },
          ],
        },
        {
          name: 'note',
          type: 'textarea',
          label: '矩阵备注',
          admin: {
            description: '简短说明矩阵判断依据；详细材料仍放到证据材料和材料留存。',
          },
        },
      ],
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
          relationTo: 'organizations' as CollectionSlug,
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
            description: '可记录具体名义、系列品牌或迁移备注。',
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
        { name: 'label', type: 'text', label: '名称' },
        { name: 'url', type: 'text', label: 'URL' },
      ],
    },
    {
      name: 'searchText',
      type: 'textarea',
      label: '搜索补充文本',
      admin: {
        description: '用于导出前台搜索索引的补充文本，不在数据库中建立 btree 索引。可放日文名、英文名、别名、作者名、关键词等。',
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
