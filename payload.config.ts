import { buildConfig } from 'payload'

export default buildConfig({
  collections: [],
  secret: process.env.PAYLOAD_SECRET || '',
})
