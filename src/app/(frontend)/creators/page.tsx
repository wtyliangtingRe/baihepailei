import CollectionIndexPage from '../_components/CollectionIndexPage'

type Args = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function CreatorsIndexPage({ searchParams }: Args) {
  const params = searchParams ? await searchParams : {}

  return (
    <CollectionIndexPage
      collection="creators"
      description="浏览创作者资料、别名与关联条目。创作者页面用于整理公开资料，不对创作者本人做单独评级。"
      eyebrow="创作者"
      title="创作者"
      searchParams={params}
    />
  )
}
