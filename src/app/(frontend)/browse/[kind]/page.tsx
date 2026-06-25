import { notFound, redirect } from 'next/navigation'

type PageArgs = {
  params: Promise<{ kind: string }>
}

const canonicalPaths: Record<string, string> = {
  works: '/works',
  creators: '/creators',
  terms: '/terms',
  rules: '/rules',
}

export default async function Page({ params }: PageArgs) {
  const { kind } = await params
  const path = canonicalPaths[kind]

  if (!path) notFound()

  redirect(path)
}
