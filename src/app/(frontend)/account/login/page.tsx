import AuthPanel from '../../_components/AuthPanel'

type SearchParams = Promise<{ redirect?: string | string[] }>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const redirectTo = Array.isArray(params.redirect) ? params.redirect[0] : params.redirect
  return <main className="page account-page"><AuthPanel mode="login" redirectTo={redirectTo} /></main>
}
