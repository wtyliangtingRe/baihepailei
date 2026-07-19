import type { CollectionConfig, CollectionSlug } from 'payload'

import { adminsOnly, editorsAndUp, publishedActiveWorkOrSignedIn } from '@/access/roles'

import { localizedTitlesField, mediaGroupOptions } from './fields/localizedMetadata'

const assessmentGradeOptions = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X', 'unknown'].map((value) => ({
  label: value === 'unknown' ? '未知' : value,
  value,
}))

const reviewStatusOptions = [
  { label: '待复核', value: 'pending' },
  { label: '已复核', value: 'reviewed' },
  { label: '有争议', value: 'disputed' },
  { label: '已废弃', value: 'deprecated' },
]

const reviewReasonOptions = [
  { label: '雷达种子命中', value: 'radar_seed_attached' },
  { label: 'Radar v0.6 评估包导入', value: 'radar_v06_package_import' },
  { label: 'Radar 发布保护', value: 'radar_publication_guard' },
  { label: 'Radar 证据覆盖不足', value: 'radar_guard_low_evidence_coverage' },
  { label: 'Radar 来源较弱或冲突', value: 'radar_guard_weak_or_conflicting_source' },
  { label: 'Radar 暂定等级不明确', value: 'radar_guard_unclear_provisional_grade' },
  { label: '来源冲突', value: 'source_conflict' },
  { label: '多来源或变体', value: 'multi_source_or_variant' },
  { label: 'Wikidata 候选待复核', value: 'wikidata_candidate_review' },
  { label: 'Wikidata 隔离', value: 'wikidata_quarantine' },
  { label: '人工复核', value: 'manual_review' },
  { label: '其他', value: 'other' },
]

const ratingNoticeOptions = [
  { label: 'AI 综合，待复核', value: 'ai_synthesized_pending_review' },
  { label: '信息不足', value: 'insufficient_information' },
  { label: '人工已确认', value: 'manual_reviewed' },
  { label: '无', value: 'none' },
  { label: '其他', value: 'other' },
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
  { label: 'Yurizukan', value: 'yurizukan' },
  { label: 'Bangumi', value: 'bangumi' },
  { label: 'MangaDex', value: 'mangadex' },
  { label: 'NDL', value: 'ndl' },
  { label: 'Steam', value: 'steam' },
  { label: 'Wikidata', value: 'wikidata' },
  { label: 'AniList', value: 'anilist' },
  { label: 'VNDB', value: 'vndb' },
  { label: 'Wikipedia', value: 'wikipedia' },
  { label: '手动整理', value: 'manual' },
  { label: '其他', value: 'other' },
]

const creatorCreditRoleOptions = [
  { label: '原作', value: 'original_creator' },
  { label: '原案', value: 'original_concept' },
  { label: '监督', value: 'director' },
  { label: '总监督', value: 'chief_director' },
  { label: '系列监督', value: 'series_director' },
  { label: '系列构成', value: 'series_composition' },
  { label: '脚本', value: 'script' },
  { label: '角色原案', value: 'character_original_design' },
  { label: '角色设计', value: 'character_design' },
  { label: '制作人', value: 'producer' },
  { label: '其他', value: 'other' },
]

const organizationRoleOptions = [
  { label: '出版社', value: 'publisher' },
  { label: '制作公司', value: 'production_company' },
  { label: '动画制作', value: 'animation_studio' },
  { label: '游戏开发', value: 'game_developer' },
  { label: '发行商', value: 'distributor' },
  { label: '社团', value: 'circle' },
  { label: '品牌', value: 'brand' },
  { label: '平台', value: 'platform' },
  { label: '网络播放平台', value: 'streaming_platform' },
  { label: '电视台 / 播出方', value: 'broadcaster' },
  { label: '制作委员会', value: 'committee' },
  { label: '制作委员会成员', value: 'committee_member' },
  { label: '音乐厂牌', value: 'music_label' },
  { label: '出资方', value: 'investor' },
  { label: '版权方', value: 'rights_holder' },
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
    defaultColumns: ['title', 'siteId', 'mediaGroup', 'mediaType', 'rank', 'reviewStatus', 'reviewReasons', 'ratingNotice', 'evidenceStrength', 'isLiteVisible', 'catalogStatus', '_status', 'updatedAt'],
    group: '内容',
    useAsTitle: 'title',
  },
  access: {
    create: editorsAndUp,
    delete: adminsOnly,
    read: publishedActiveWorkOrSignedIn,
    update: editorsAndUp,
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
        description: '仅用于旧链接兼容和导入匹配。公开规范网址使用本站 Works 数据库 ID。',
      },
    },
    {
      name: 'siteId',
      type: 'text',
      label: '导入追踪 ID（兼容）',
      unique: true,
      admin: {
        description: '历史导入与跨来源合并用的追踪值；不作为公开网址，也不等于 Works 数据库主键。',
      },
    },
    {
      name: 'rank',
      type: 'select',
      label: '目录兼容等级（自动优先人工、否则 AI）',
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
        { label: 'X', value: 'X' },
        { label: '垃圾', value: 'trash' },
        { label: '未知', value: 'unknown' },
      ],
    },
    {
      name: 'humanAssessment',
      type: 'group',
      label: '人工审核轨道（参考）',
      admin: {
        description: '与 AI Radar 独立保存。人工审核是可追溯的参考意见，不会覆盖 AI 轨道；目录展示优先采用人工等级，但两条证据始终分别呈现。',
      },
      fields: [
        { name: 'grade', type: 'select', label: '人工参考等级', options: assessmentGradeOptions },
        {
          name: 'status',
          type: 'select',
          label: '人工轨道状态',
          defaultValue: 'pending',
          options: [
            { label: '未提交', value: 'pending' },
            { label: '已记录', value: 'reviewed' },
            { label: '有争议', value: 'disputed' },
          ],
        },
        { name: 'note', type: 'textarea', label: '人工判断说明', maxLength: 4000 },
        { name: 'sourceSummary', type: 'textarea', label: '人工来源摘要', maxLength: 4000 },
        {
          name: 'evidenceStatus',
          type: 'select',
          label: '人工证据状态',
          options: [
            { label: '尚未评估', value: 'unassessed' },
            { label: '来源已核对', value: 'source_checked' },
            { label: '原作已核对', value: 'primary_checked' },
            { label: '证据不足', value: 'insufficient' },
          ],
        },
        {
          name: 'sourceLinks',
          type: 'array',
          label: '人工来源链接',
          fields: [
            { name: 'label', type: 'text', label: '名称' },
            { name: 'url', type: 'text', label: 'URL' },
          ],
        },
        { name: 'assessedAt', type: 'date', label: '人工记录时间', admin: { readOnly: true } },
        { name: 'assessedBy', type: 'relationship', label: '人工记录人', relationTo: 'users', admin: { readOnly: true } },
      ],
    },
    {
      name: 'reviewStatus',
      type: 'select',
      label: '人工轨道兼容状态',
      required: true,
      defaultValue: 'pending',
      options: reviewStatusOptions,
      admin: {
        description: '旧字段兼容状态；新的人工意见请填写 humanAssessment，AI Radar 保留在 radarAssessment。',
      },
    },
    {
      name: 'humanReviewNote',
      type: 'textarea',
      label: '人工轨道兼容记录',
      maxLength: 4000,
      admin: {
        description: '记录本次人工复核的结论、仍待确认的问题或退回原因。',
      },
    },
    {
      name: 'humanReviewedAt',
      type: 'date',
      label: '最近人工复核时间',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'humanReviewedBy',
      type: 'relationship',
      label: '最近人工复核人',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'importBatch',
      type: 'text',
      label: '导入批次',
      admin: {
        description: '记录批量导入、预览或迁移批次，例如 public-catalog-import-v02。用于内部复核筛选。',
      },
    },
    {
      name: 'ratingNotice',
      type: 'select',
      label: '分级提示',
      options: ratingNoticeOptions,
      admin: {
        description: '记录导入阶段给出的分级提示，例如 AI 综合待复核或信息不足。',
      },
    },
    {
      name: 'chosenBaseSource',
      type: 'select',
      label: '导入基准来源',
      options: candidateSourceOptions,
      admin: {
        description: '记录本条导入记录采用的基准来源。候选来源详情仍保存在 candidateSources。',
      },
    },
    {
      name: 'reviewReasons',
      type: 'select',
      label: '复核原因',
      hasMany: true,
      options: reviewReasonOptions,
      admin: {
        description: '结构化记录进入复核队列的原因；用于内部 review dashboard 精确筛选。',
      },
    },
    {
      name: 'sourceConflictNotes',
      type: 'textarea',
      label: '来源冲突备注',
      admin: {
        description: '记录多来源、变体、冲突来源等简要说明。',
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
        description: '按本站当前证据材料评估强弱；未评估不等于没有证据。',
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
    localizedTitlesField(),
    {
      name: 'mediaGroup',
      type: 'select',
      label: '作品大类',
      defaultValue: 'unknown',
      options: mediaGroupOptions,
      admin: {
        description: '前台筛选用的大类：动画、漫画、小说、游戏等。后续导入可由作品类型自动推导。',
      },
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
      name: 'workGroup',
      type: 'group',
      label: '候选系列分组',
      admin: {
        description: '候选导入阶段生成的系列/条目归组提示，仅供后台复核；不代表已经确认公开系列导航。',
      },
      fields: [
        { name: 'key', type: 'text', label: '分组 Key' },
        { name: 'title', type: 'text', label: '分组标题' },
        { name: 'relation', type: 'text', label: '关系类型' },
        { name: 'orderLabel', type: 'text', label: '顺序标签' },
        { name: 'source', type: 'text', label: '来源' },
        { name: 'confidence', type: 'text', label: '置信标记' },
        { name: 'note', type: 'textarea', label: '备注' },
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
      label: '旧 Full 可见标记（兼容保留）',
      defaultValue: true,
      admin: {
        description: '完整版现在默认收录全部记录；此字段仅为旧导出器与历史数据兼容保留。',
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
      name: 'creatorCredits',
      type: 'array',
      label: '关键创作者职位',
      admin: {
        description: '记录会影响剧情、设定或表达方向的关键动画职位，例如监督、总监督、系列构成、脚本、原作等。',
      },
      fields: [
        {
          name: 'creator',
          type: 'relationship',
          label: '创作者',
          relationTo: 'creators' as CollectionSlug,
          required: true,
        },
        {
          name: 'role',
          type: 'select',
          label: '职位',
          defaultValue: 'other',
          required: true,
          options: creatorCreditRoleOptions,
        },
        {
          name: 'originalRole',
          type: 'text',
          label: '原始职位名',
          admin: {
            description: '保留来源里的原文职位，例如 監督、総監督、シリーズ構成、脚本。',
          },
        },
        {
          name: 'source',
          type: 'select',
          label: '来源',
          defaultValue: 'manual',
          options: candidateSourceOptions,
        },
        {
          name: 'note',
          type: 'text',
          label: '备注',
        },
      ],
    },
    {
      name: 'organizations',
      type: 'array',
      label: '相关机构',
      admin: {
        description: '出版社、制作公司、发行商、平台、制作委员会、委员会成员、电视台、音乐厂牌等机构关系。',
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
          options: organizationRoleOptions,
        },
        {
          name: 'originalRole',
          type: 'text',
          label: '原始角色名',
          admin: {
            description: '保留来源里的原文角色，例如 製作、制作、放送、音楽制作、制作委员会成员等。',
          },
        },
        {
          name: 'source',
          type: 'select',
          label: '来源',
          defaultValue: 'manual',
          options: candidateSourceOptions,
        },
        {
          name: 'note',
          type: 'text',
          label: '备注',
          admin: {
            description: '可记录具体名义、系列品牌、委员会成员说明或迁移备注。',
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
      name: 'catalogStatus',
      type: 'select',
      label: '目录状态',
      defaultValue: 'active',
      required: true,
      options: [
        { label: '正常', value: 'active' },
        { label: '归档 / 回收站', value: 'archived' },
      ],
      admin: {
        description: '只表示作品是否仍在本站目录中。草稿与发布由 Payload 内置 _status 管理。',
      },
    },
  ],
}
