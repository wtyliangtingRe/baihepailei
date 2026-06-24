import { buildConfig } from 'payload'

import { Creators } from './src/collections/Creators'
import { Entries } from './src/collections/Entries'
import { Media } from './src/collections/Media'
import { Rules } from './src/collections/Rules'
import { Terms } from './src/collections/Terms'
import { Users } from './src/collections/Users'

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media, Entries, Creators, Terms, Rules],
  secret: process.env.PAYLOAD_SECRET || '',
})
