import type { Field } from 'payload'

export const mediaGroupOptions = [
  { label: '动画', value: 'anime' },
  { label: '漫画', value: 'manga' },
  { label: '小说', value: 'novel' },
  { label: '游戏', value: 'game' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const languageOptions = [
  { label: '日语', value: 'ja' },
  { label: '简体中文', value: 'zh-Hans' },
  { label: '繁体中文', value: 'zh-Hant' },
  { label: '英语', value: 'en' },
  { label: '韩语', value: 'ko' },
  { label: '法语', value: 'fr' },
  { label: '德语', value: 'de' },
  { label: '西班牙语', value: 'es' },
  { label: '多语言 / 不适用', value: 'und' },
  { label: '其他', value: 'other' },
  { label: '未知', value: 'unknown' },
]

const localizedTitleKindOptions = [
  { label: '原名', value: 'original' },
  { label: '官方译名', value: 'official' },
  { label: '地区译名', value: 'localized' },
  { label: '罗马字', value: 'romanized' },
  { label: '别名', value: 'alias' },
  { label: '民间译名', value: 'fan' },
  { label: '直译名', value: 'literal' },
  { label: '仅搜索', value: 'search_only' },
  { label: '其他', value: 'other' },
]

const localizedNameKindOptions = [
  { label: '原名', value: 'original' },
  { label: '官方名称', value: 'official' },
  { label: '地区名称', value: 'localized' },
  { label: '罗马字', value: 'romanized' },
  { label: '别名', value: 'alias' },
  { label: '法定名称', value: 'legal' },
  { label: '旧名', value: 'former' },
  { label: '仅搜索', value: 'search_only' },
  { label: '其他', value: 'other' },
]

function localizedBaseFields({ valueFieldName, valueLabel, kindOptions }: {
  valueFieldName: string
  valueLabel: string
  kindOptions: { label: string; value: string }[]
}): Field[] {
  return [
    {
      name: valueFieldName,
      type: 'text',
      label: valueLabel,
      required: true,
    },
    {
      name: 'language',
      type: 'select',
      label: '语言',
      defaultValue: 'unknown',
      options: languageOptions,
    },
    {
      name: 'region',
      type: 'text',
      label: '地区 / 市场',
      admin: {
        description: '可填 JP、CN、TW、HK、US 等，也可留空。',
      },
    },
    {
      name: 'kind',
      type: 'select',
      label: '名称类型',
      defaultValue: 'alias',
      options: kindOptions,
    },
    {
      name: 'isPrimary',
      type: 'checkbox',
      label: '该语言/地区主名称',
      defaultValue: false,
    },
    {
      name: 'source',
      type: 'text',
      label: '来源',
      admin: {
        description: '例如 Bangumi、AniList、VNDB、Wikidata、manual。',
      },
    },
    {
      name: 'note',
      type: 'text',
      label: '备注',
    },
  ]
}

export function localizedTitlesField(): Field {
  return {
    name: 'localizedTitles',
    type: 'array',
    label: '多语言 / 地区标题',
    admin: {
      description: '用于记录原名、官方译名、地区译名、罗马字、民间译名和仅搜索名称；不是完整多语言站点内容。',
    },
    fields: localizedBaseFields({
      valueFieldName: 'title',
      valueLabel: '标题',
      kindOptions: localizedTitleKindOptions,
    }),
  }
}

export function localizedNamesField(): Field {
  return {
    name: 'localizedNames',
    type: 'array',
    label: '多语言 / 地区名称',
    admin: {
      description: '用于记录原名、官方名、地区名、罗马字、旧名和仅搜索名称；不要求每种语言都填写。',
    },
    fields: localizedBaseFields({
      valueFieldName: 'name',
      valueLabel: '名称',
      kindOptions: localizedNameKindOptions,
    }),
  }
}
