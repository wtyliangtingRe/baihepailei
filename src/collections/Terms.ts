import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Terms: CollectionConfig = {
  slug: 'terms',
  admin: {
    defaultColumns: ['name', 'status', 'updatedAt'],
    group: 'Content',
    useAsTitle: 'name',
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
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'definition',
      type: 'richText',
    },
    {
      name: 'relatedTerms',
      type: 'relationship',
      relationTo: 'terms',
      hasMany: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      required: true,
      options: ['draft', 'review', 'published', 'archived'],
    },
  ],
}
