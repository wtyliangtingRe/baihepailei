import type { CollectionConfig, Field } from 'payload'

const lifecycleOptions = [
  { label: '正式作品', value: 'active' },
  { label: '临时作品', value: 'temporary' },
  { label: '归档 / 回收站', value: 'archived' },
]

function lifecycleField(field: Field): Field {
  if (!('name' in field) || field.name !== 'catalogStatus' || field.type !== 'select') return field
  return {
    ...field,
    label: '作品阶段',
    options: lifecycleOptions,
    admin: {
      ...field.admin,
      description: '正式与临时作品都保持发布并进入前台；临时表示事实资料已入库、仍待补齐或复核。归档才会从前台隐藏。',
    },
  }
}

export function withWorkLifecycleFields(collection: CollectionConfig): CollectionConfig {
  return {
    ...collection,
    fields: collection.fields.map(lifecycleField),
    hooks: {
      ...collection.hooks,
      beforeValidate: [
        ...(collection.hooks?.beforeValidate || []),
        ({ context, data, originalDoc }) => {
          if (!data) return data
          const flags = (context || {}) as Record<string, unknown>
          if (!flags.firstPartyStudio || flags.aiPipelineWrite) return data

          const previous = (originalDoc || {}) as { radarAssessment?: unknown }
          const next = { ...data } as Record<string, unknown>
          if (previous.radarAssessment === undefined) delete next.radarAssessment
          else next.radarAssessment = previous.radarAssessment
          return next
        },
      ],
    },
  }
}
