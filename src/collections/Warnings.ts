import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Warnings: CollectionConfig = {
  slug: 'warnings',
  admin: {
    defaultColumns: ['name', 'severity', 'category', 'updatedAt'],
    group: 'Content',
    useAsTitle: 'name',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: anyone,
    update: trustedAndUp,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'severity',
      type: 'select',
      defaultValue: 'medium',
      required: true,
      options: ['low', 'medium', 'high', 'critical'],
    },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'content',
      required: true,
      options: ['content', 'relationship', 'creator', 'operation', 'other'],
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'relatedTerms',
      type: 'relationship',
      relationTo: 'terms',
      hasMany: true,
    },
  ],
}
