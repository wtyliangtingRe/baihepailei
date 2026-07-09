import CollectionIndexPage from '../_components/CollectionIndexPage'

type Args = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function CreatorsIndexPage({ searchParams }: Args) {
  const params = searchParams ? await searchParams : {}

  return (
    <CollectionIndexPage
      collection="creators"
      description="浏览从旧 XWiki 清理出来的创作者资料。"
      eyebrow="创作者"
      title="创作者"
      searchParams={params}
    />
  )
}
