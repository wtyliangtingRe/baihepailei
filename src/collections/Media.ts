import type { CollectionConfig } from 'payload'

import { anyone, trustedAndUp } from '@/access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Content',
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
      name: 'alt',
      type: 'text',
      label: 'Alt text',
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Caption',
    },
  ],
}
