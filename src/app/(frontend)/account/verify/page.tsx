import AuthPanel from '../../_components/AuthPanel'

type SearchParams = Promise<{ token?: string | string[] }>

export default async function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const token = Array.isArray(params.token) ? params.token[0] || '' : params.token || ''
  return <main className="page account-page"><AuthPanel mode="verify" token={token} /></main>
}
