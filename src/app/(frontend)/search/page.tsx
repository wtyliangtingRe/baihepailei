import { redirect } from 'next/navigation'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw || '').trim().slice(0, 200)
  redirect(q ? `/works?q=${encodeURIComponent(q)}` : '/works')
}
