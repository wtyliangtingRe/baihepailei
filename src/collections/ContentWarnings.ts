import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const ContentWarnings: CollectionConfig = {
  slug: 'content-warnings',
  admin: {
    defaultColumns: ['name', 'level', 'updatedAt'],
    group: 'Content',
    useAsTitle: 'name',
  },
  access: {
    create: trustedAndUp,
    read: anyone,
    update: trustedAndUp,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
    },
    {
      name: 'level',
      type: 'select',
      defaultValue: 'medium',
      required: true,
      options: ['low', 'medium', 'high'],
    },
    {
      name: 'body',
      type: 'richText',
    },
  ],
}
