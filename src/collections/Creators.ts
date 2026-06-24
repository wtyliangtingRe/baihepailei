import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Creators: CollectionConfig = {
  slug: 'creators',
  admin: {
    defaultColumns: ['name', 'rank', 'status', 'updatedAt'],
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
      name: 'rank',
      type: 'select',
      options: ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'],
    },
    {
      name: 'aliases',
      type: 'array',
      fields: [
        {
          name: 'value',
          type: 'text',
        },
      ],
    },
    {
      name: 'notes',
      type: 'richText',
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
