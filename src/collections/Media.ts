import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    defaultColumns: ['filename', 'mediaScope', 'alt', 'updatedAt'],
    group: '内容',
  },
  access: {
    create: trustedAndUp,
    delete: trustedAndUp,
    read: anyone,
    update: trustedAndUp,
  },
  upload: {
    staticDir: 'media',
  },
  fields: [
    {
      name: 'mediaScope',
      type: 'select',
      label: 'Media scope',
      defaultValue: 'full-only',
      required: true,
      options: [
        { label: 'Site UI', value: 'site-ui' },
        { label: 'Cover', value: 'cover' },
        { label: 'Evidence', value: 'evidence' },
        { label: 'Legacy import', value: 'legacy' },
        { label: 'Full only', value: 'full-only' },
      ],
      admin: {
        description: 'Controls whether media belongs to the Lite site, Full package, or migration archive.',
      },
    },
    {
      name: 'alt',
      type: 'text',
      label: 'Alt text',
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
    },
    {
      name: 'originalFilename',
      type: 'text',
      label: 'Original filename',
    },
    {
      name: 'legacyXWikiPage',
      type: 'text',
      label: 'Legacy XWiki page',
    },
    {
      name: 'sourceNote',
      type: 'textarea',
      label: 'Source note',
      admin: {
        rows: 4,
      },
    },
  ],
}
