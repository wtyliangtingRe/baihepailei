import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const ContentTags: CollectionConfig = {
  slug: 'content-tags',
  admin: {
    defaultColumns: ['name', 'slug'],
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
    }
  ],
}
