import type { CollectionConfig } from 'payload'

import { publishedOrSignedIn, trustedAndUp } from '@/access/roles'

export const Entries: CollectionConfig = {
  slug: 'entries',
  admin: {
    defaultColumns: ['title', 'grade', 'status'],
    group: 'Content',
    useAsTitle: 'title',
  },
  access: {
    create: trustedAndUp,
    read: publishedOrSignedIn,
    update: trustedAndUp,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
    },
    {
      name: 'grade',
      type: 'select',
      required: true,
      options: ['S', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'unknown'],
    },
    {
      name: 'creators',
      type: 'relationship',
      relationTo: 'creators',
      hasMany: true,
    },
    {
      name: 'labels',
      type: 'relationship',
      relationTo: 'content-tags',
      hasMany: true,
    },
    {
      name: 'summary',
      type: 'richText',
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
    }
  ],
}
