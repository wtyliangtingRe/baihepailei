import type { CollectionConfig, Field } from 'payload'

export function stewardshipNoticesField(): Field {
  return {
    name: 'stewardshipNotices',
    type: 'relationship',
    relationTo: 'stewardship-notices',
    hasMany: true,
    label: '站务与用语提示',
    admin: {
      description: '可选。用于身份争议、版本差异、站务裁量、用语说明或其他特殊提醒；可以关联多条。',
    },
  }
}

export function withStewardshipNotices(collection: CollectionConfig): CollectionConfig {
  const alreadyPresent = collection.fields.some((field) => 'name' in field && field.name === 'stewardshipNotices')
  if (alreadyPresent) return collection

  return {
    ...collection,
    fields: [...collection.fields, stewardshipNoticesField()],
  }
}
