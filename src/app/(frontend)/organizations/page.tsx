import CollectionIndexPage from '../_components/CollectionIndexPage'

type Args = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function OrganizationsIndexPage({ searchParams }: Args) {
  const params = searchParams ? await searchParams : {}

  return (
    <CollectionIndexPage
      collection="organizations"
      eyebrow="机构"
      title="机构"
      description="浏览出版社、制作公司、动画公司、平台、品牌、制作委员会等相关机构。"
      visualHeading
      searchParams={params}
    />
  )
}
