import type { RadarRatingClass } from './ratingPolicy'

export const PUBLIC_TAG_KEYS = [
  'setting-ts',
  'setting-futa',
  'setting-abo',
  'setting-otokonoko-crossdressing',
  'setting-queer-general',
  'content-adult',
] as const

export type PublicTagKey = (typeof PUBLIC_TAG_KEYS)[number]

export type PublicTagDefinition = {
  group: '设定提示' | '内容提示'
  label: string
  description: string
}

export const publicTagDefinitions: Record<PublicTagKey, PublicTagDefinition> = {
  'setting-ts': {
    group: '设定提示',
    label: 'TS / 性别转换',
    description: '本作含 TS / 性别转换设定；请结合角色身份与关系证据判断是否符合个人偏好。',
  },
  'setting-futa': {
    group: '设定提示',
    label: '扶她设定',
    description: '本作含扶她设定；该提示与其他关系、剧情雷点分开阅读。',
  },
  'setting-abo': {
    group: '设定提示',
    label: 'ABO 设定',
    description: '本作含 ABO（Alpha / Beta / Omega）设定。',
  },
  'setting-otokonoko-crossdressing': {
    group: '设定提示',
    label: '男娘 / 女装设定',
    description: '本作含男娘、女装或相关身份呈现设定。',
  },
  'setting-queer-general': {
    group: '设定提示',
    label: '泛 queer 设定',
    description: '本作含泛 queer 设定或身份语境；它不自动等于某个核心等级。',
  },
  'content-adult': {
    group: '内容提示',
    label: '成人 / 性描写',
    description: '本作可能涉及成人向、性描写或其他不适合所有读者的内容。',
  },
}

const classTags: Partial<Record<RadarRatingClass, PublicTagKey>> = {
  'D-TS-SETTING': 'setting-ts',
  'D-FUTA-SETTING': 'setting-futa',
  'E-ABO': 'setting-abo',
  'D-OTOKONOKO-CROSSDRESSING': 'setting-otokonoko-crossdressing',
}

export function isPublicTagKey(value: string): value is PublicTagKey {
  return (PUBLIC_TAG_KEYS as readonly string[]).includes(value)
}

export function publicTagsFor(
  explicitTags: readonly string[] = [],
  ratingClasses: readonly string[] = [],
) {
  const keys = new Set<PublicTagKey>(explicitTags.filter(isPublicTagKey))
  for (const ratingClass of ratingClasses) {
    const key = classTags[ratingClass as RadarRatingClass]
    if (key) keys.add(key)
  }
  return [...keys].map((key) => ({ key, ...publicTagDefinitions[key] }))
}
