import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const host = '127.0.0.1'
const port = Number(process.env.PUBLIC_SMOKE_PORT || 3100)
const base = `http://${host}:${port}`
let serverOutput = ''

const server = spawn(process.execPath, ['scripts/start-production.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HOSTNAME: host, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-12_000)
  })
}

async function stopServer() {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(2_000),
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
}

async function response(path, init) {
  return fetch(`${base}${path}`, init)
}

async function json(path) {
  const result = await response(path)
  assert.equal(result.status, 200, `${path} should return 200`)
  return result.json()
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) break
    try {
      const health = await response('/api/health')
      if (health.ok) {
        ready = true
        break
      }
    } catch {}
    await delay(250)
  }
  assert.ok(ready, `production server did not become ready\n${serverOutput}`)

  const pages = [
    '/',
    '/works',
    '/works/w-36946',
    '/works/w-4971',
    '/works/w-18556',
    '/ratings',
    '/rules',
    '/radar',
    '/feedback',
    '/privacy',
    '/creators',
    '/organizations',
  ]
  for (const path of pages) {
    const result = await response(path)
    assert.equal(result.status, 200, `${path} should return 200`)
  }

  const rules = (await (await response('/rules')).text()).replaceAll('<!-- -->', '')
  const ruleCount = [...rules.matchAll(/<article class="release-rule-card /g)].length
  assert.ok(ruleCount > 0)
  assert.match(rules, /<h1>排雷规则<\/h1>/)
  assert.ok(rules.includes(`查看 ${ruleCount} 条细则的证据要求和适用范围。`))
  assert.doesNotMatch(rules, /当前快照的特殊数据状态|D-UNCLEAR/)

  const publisherFile = await response('/ads.txt')
  assert.equal(publisherFile.status, 200)
  assert.match(publisherFile.headers.get('content-type') || '', /^text\/plain\b/)
  assert.equal(await publisherFile.text(), 'google.com, pub-3988080014945439, DIRECT, f08c47fec0942fa0\n')

  const homepage = await (await response('/')).text()
  const head = homepage.match(/<head>(.*?)<\/head>/s)?.[1] || ''
  assert.match(head, /<meta name="google-adsense-account" content="ca-pub-3988080014945439"/)
  const adScript = /<script [^>]*src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-3988080014945439"/
  assert.equal(adScript.test(head), process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true')
  assert.match(homepage, /href="\/privacy"/)

  const correctionFeedback = await (
    await response('/feedback?workId=18556&title=%E5%AE%89%E9%81%94%E3%81%A8%E3%81%97%E3%81%BE%E3%82%80%E3%82%89')
  ).text()
  for (const expected of [
    '填写并提交线索',
    '打开作品补充与纠错表',
    'github.com/wtyliangtingRe/baihepailei/issues/new',
    'work-correction.yml',
    'work_id=18556',
    '匿名文字表单',
    '不接收图片或任何附件',
    '投稿与图片证据',
  ]) {
    assert.ok(correctionFeedback.includes(expected), `correction feedback should include ${expected}`)
  }

  const newWorkFeedback = await (await response('/feedback?type=new_work')).text()
  for (const expected of ['打开新作品提交表', 'new-work.yml', '推荐收录新作品']) {
    assert.ok(newWorkFeedback.includes(expected), `new-work feedback should include ${expected}`)
  }

  assert.ok(correctionFeedback.includes('mailto:wty1123581321@gmail.com?'))
  for (const file of ['wechat.png', 'bilibili.png', 'douyin.png']) {
    const path = `/contact/${file}`
    assert.ok(correctionFeedback.includes(path), `feedback should display ${path}`)
    const asset = await response(path)
    assert.equal(asset.status, 200, `${path} should be available in production`)
    assert.match(asset.headers.get('content-type') || '', /^image\/png/)
    assert.ok(Buffer.from(await asset.arrayBuffer()).equals(readFileSync(`public${path}`)), `${path} must preserve the supplied original`)
  }

  const redirects = new Map([
    ['/browse', '/works'],
    ['/evidence', '/feedback'],
  ])
  for (const [path, destination] of redirects) {
    const result = await response(path, { redirect: 'manual' })
    assert.ok([307, 308].includes(result.status), `${path} should redirect`)
    assert.equal(new URL(result.headers.get('location'), base).pathname, destination)
  }

  const reviewManifest = JSON.parse(readFileSync('data/public-release/review-20261121/manifest.json', 'utf8'))
  const intake = JSON.parse(readFileSync('data/public-release/identity-20261121/recent-works.json', 'utf8'))
  const additions = intake.entries.filter(entry => entry.edition)
  const health = await json('/api/health')
  assert.deepEqual(
    {
      ok: health.ok,
      catalogWorks: health.catalogWorks,
      visibleWorks: health.visibleWorks,
      mergedAway: health.mergedAway,
      mergedGroups: health.mergedGroups,
      largestMergedGroup: health.largestMergedGroup,
      ratedWorks: health.ratedWorks,
    },
    {
      ok: true,
      catalogWorks: 35_411 + additions.length,
      visibleWorks: 34_540 + additions.length,
      mergedAway: 871,
      mergedGroups: 843,
      largestMergedGroup: 3,
      ratedWorks: reviewManifest.ratedSourceRecords + additions.length,
    },
  )
  assert.equal(health.visibleWorks + health.mergedAway, health.catalogWorks)
  assert.equal(health.ratedVisibleWorks + health.unratedVisibleWorks, health.visibleWorks)
  assert.ok(health.reviewedVisibleWorks > 0 && health.reviewedVisibleWorks <= health.ratedVisibleWorks)
  const ratedCatalog = await json('/api/work-lineage/works?status=rated&limit=1')
  assert.equal(health.ratedVisibleWorks, ratedCatalog.total)

  if (intake.entries.length) {
    const recent = await (await response('/updates')).text()
    assert.ok(recent.includes('2026 年秋季新作评级'))
    assert.ok(recent.includes('銀の河に星の城'), 'Featured existing work should use its publication title')
    const contested = additions.find(entry => entry.edition.review.siteId === 'STEAM-3863090')
    const result = await json('/api/work-lineage/works/' + contested.workId)
    assert.equal(result.rating.grade, 'F')
    assert.equal(result.rating.decidingSource, 'community')
    assert.ok(result.rating.sourceFindings.some(finding => finding.kind === 'official' && finding.grade === 'B'))
    for (const { workId, edition } of additions.slice(0, 3)) {
      const detail = await json('/api/work-lineage/works/' + workId)
      assert.equal(detail.title, edition.title)
      assert.equal(detail.rating.gradeReviewed, true)
      assert.ok(detail.rating.decidingSource)
    }
  }

  const [ibaraNovel, ibaraComics] = await Promise.all(['39261', '40085'].map(id => json('/api/work-lineage/works/' + id)))
  assert.notEqual(ibaraNovel.workId, ibaraComics.workId)
  assert.equal(ibaraNovel.media.group, 'novel')
  assert.equal(ibaraComics.media.group, 'manga')
  assert.ok(ibaraNovel.creators.some(credit => credit.name === '深水紅茶' && credit.role === '作者'))
  assert.ok(ibaraNovel.creators.some(credit => credit.name === '椎名くろ' && credit.role === '插画'))
  assert.ok(ibaraComics.creators.some(credit => credit.name === '椎名くろ' && credit.role === '人物原案'))
  assert.ok(!ibaraNovel.sources.some(source => source.url.endsWith('/4407')))

  const greenYuri = await json('/api/work-lineage/works/15652')
  assert.equal(greenYuri.rating.grade, 'S')
  assert.ok(greenYuri.creators.some(credit => credit.creatorId === '1007134' && credit.role === '作者'))
  assert.ok(greenYuri.localizedTitles.some(title => title.title === '我在意的對象並不是男人' && title.kind === 'official'))

  const [grotesque, euphonium] = await Promise.all(['11721', '23392'].map(id => json('/api/work-lineage/works/' + id)))
  assert.equal(grotesque.firstPublished, '2026-07-24')
  assert.equal(grotesque.rating.grade, 'C')
  assert.ok(grotesque.creators.every(credit => !credit.name.includes(' / ')))
  assert.ok(grotesque.creators.some(credit => credit.name === '岩崎将大' && credit.role === '人物设定'))
  assert.equal(euphonium.rating.grade, 'C')
  assert.ok(euphonium.creators.some(credit => credit.name === '小川太一' && credit.role === '导演'))

  const [oldOkanRecord, collectedOkan, natori] = await Promise.all(
    ['4282', '14486', '20128'].map(id => json('/api/work-lineage/works/' + id)),
  )
  assert.equal(oldOkanRecord.workId, collectedOkan.workId)
  assert.equal(collectedOkan.rating.grade, 'E')
  assert.ok(collectedOkan.printEditions.some(edition => edition.isbn === '9784046801470'))
  assert.equal(natori.firstPublished, '2026-05-26')
  assert.ok(intake.entries.some(entry => entry.workId === natori.workId && entry.releasedOn === '2026-10-09'))
  assert.ok(natori.printEditions.some(edition => edition.isbn === '9784098548392' && edition.onSale === '2026-10-09'))

  const vtuber = await json('/api/work-lineage/works/22762')
  assert.equal(vtuber.firstPublished, '2026-04-24')
  assert.equal(vtuber.rating.grade, 'B')
  assert.equal(vtuber.rating.decidingSource, 'official')
  assert.ok(vtuber.printEditions.some(edition => edition.isbn === '9784049721812' && edition.onSale === '2026-09-07'))
  assert.ok(intake.entries.some(entry => entry.workId === vtuber.workId && entry.releasedOn === '2026-09-07'))

  const commercialAlone = await json('/api/work-lineage/works/4196')
  assert.equal(commercialAlone.firstPublished, '2025-06-07')
  assert.equal(commercialAlone.rating.grade, 'E')
  for (const isbn of ['9784049722253', '9784049722260']) {
    assert.ok(commercialAlone.printEditions.some(edition => edition.isbn === isbn && edition.onSale === '2026-11-06'))
  }
  const dismantled = additions.find(entry => entry.edition.printEdition?.isbn === '9784825101210')
  assert.equal(dismantled.releasedOn, '2026-11-18')
  const dismantledWork = await json('/api/work-lineage/works/' + dismantled.workId)
  assert.equal(dismantledWork.firstPublished, '2026-02-18')
  assert.equal(dismantledWork.rating.grade, 'B')

  const robinRelease = additions.find(entry => entry.edition.review.siteId === 'recent-isbn-9784781625980')
  const [robinOriginal, robinCollected] = await Promise.all([
    json('/api/work-lineage/works/39338'),
    json('/api/work-lineage/works/' + robinRelease.workId),
  ])
  assert.notEqual(robinOriginal.workId, robinCollected.workId)
  assert.equal(robinOriginal.firstPublished, '2025-10-10')
  assert.equal(robinOriginal.rating.grade, 'D')
  assert.equal(robinCollected.firstPublished, '2026-10-19')
  assert.equal(robinCollected.rating.grade, 'F')
  assert.equal(robinCollected.rating.decidingSource, 'community')
  assert.deepEqual(robinCollected.printEditions.map(edition => edition.isbn), ['9784781625980', '9784781625997'])
  assert.equal(robinOriginal.creators[0].creatorId, robinCollected.creators[0].creatorId)

  const remake = additions.find(entry => entry.edition.review.siteId === 'catalog-anilist-220069')
  const [digicata, digicataIndex, digicataLegacy, remakeWork, panzer] = await Promise.all(
    ['21559', '32955', '4344', remake.workId, '32697'].map(id => json('/api/work-lineage/works/' + id)),
  )
  assert.equal(digicata.workId, digicataIndex.workId)
  assert.equal(digicata.workId, digicataLegacy.workId)
  assert.notEqual(digicata.workId, remakeWork.workId)
  assert.equal(digicata.rating.grade, 'B')
  assert.equal(remakeWork.rating.grade, 'B')
  assert.equal(digicata.creators.find(credit => credit.name === 'しらいぬ').creatorId,
    remakeWork.creators.find(credit => credit.name === 'しらいぬ').creatorId)
  assert.equal(panzer.firstPublished, '2026-10-08')
  assert.ok(intake.entries.some(entry => entry.workId === panzer.workId && entry.releasedOn === '2026-10-09'))

  const [butterflyNovel, butterflyNovelIndex, butterflySerial, butterflyVolume] = await Promise.all(
    ['4124', '37195', '8406', '38635'].map(id => json('/api/work-lineage/works/' + id)),
  )
  assert.equal(butterflyNovel.workId, butterflyNovelIndex.workId)
  assert.equal(butterflyNovel.rating.grade, 'E')
  assert.equal(butterflySerial.media.group, 'manga')
  assert.notEqual(butterflySerial.workId, butterflyVolume.workId)
  assert.equal(butterflySerial.rating.grade, 'B')
  assert.equal(butterflyVolume.rating.grade, 'B')
  assert.ok(butterflyVolume.printEditions.some(edition => edition.isbn === '9784046824936'))
  assert.ok(butterflyVolume.creators.some(credit => credit.name === '箕田海道' && credit.role === '作画'))

  const [doujin, reissuedDoujin, collection, indexedCollection] = await Promise.all(
    ['6751', '39003', '6752', '38241'].map(id => json('/api/work-lineage/works/' + id)),
  )
  assert.equal(doujin.workId, reissuedDoujin.workId)
  assert.equal(collection.workId, indexedCollection.workId)
  assert.notEqual(doujin.workId, collection.workId)
  assert.equal(doujin.rating.grade, 'S')
  assert.ok(doujin.creators.some(person => person.creatorId === '1008243'))
  assert.ok(collection.sources.some(source => source.url === 'https://data.ichijinsha.co.jp/detail/75807681'))

  const watanare = await json('/api/work-lineage/works/28502')
  assert.equal(watanare.rating.grade, 'B')
  const imprint = watanare.organizations.find(org => org.creatorId === '90011345416')
  assert.equal(imprint?.role, '出版品牌')
  assert.ok(imprint.sourceUrls.includes('https://prtimes.jp/a/?c=1227&f=d1227-20140217-9965.pdf&r=498'))
  for (const [id, role] of [['1007912', '原作'], ['1007803', '漫画'], ['1007923', '角色原案']]) {
    const credit = watanare.creators.find(author => author.creatorId === id && author.role === role)
    assert.ok(credit?.sourceUrls.includes('https://www.s-manga.net/items/contents.html?isbn=9784088934327'))
  }
  const [webComic, redrawnComic] = await Promise.all(['25454', '25453'].map(id => json('/api/work-lineage/works/' + id)))
  assert.notEqual(webComic.workId, redrawnComic.workId)
  assert.equal(webComic.rating.grade, 'E')
  assert.equal(redrawnComic.rating.grade, 'F')

  const [ada, adaEntry] = await Promise.all(['5407', '38870'].map(id => json('/api/work-lineage/works/' + id)))
  assert.equal(ada.workId, adaEntry.workId)
  assert.equal(ada.rating.grade, 'S')
  const [officeClover, sistersClover, clampClover] = await Promise.all(['8579', '8580', '8581'].map(id => json('/api/work-lineage/works/' + id)))
  assert.equal(new Set([officeClover.workId, sistersClover.workId, clampClover.workId]).size, 3)
  assert.equal(officeClover.rating.grade, 'F')
  assert.equal(sistersClover.rating.grade, 'E')
  assert.equal(clampClover.rating.grade, 'F')
  const sistersReview = 'https://okazu.yuricon.com/2008/12/26/yuri-manga-clover/'
  assert.ok(sistersClover.sources.some(source => source.url === sistersReview))
  assert.ok([officeClover, clampClover].every(work => !work.sources.some(source => source.url === sistersReview)))

  const twoDk = await json('/api/work-lineage/works/5221')
  assert.equal(twoDk.workId, (await json('/api/work-lineage/works/4260')).workId)
  assert.ok(twoDk.organizations.some(row => row.name.toLowerCase() === 'altraverse'))
  const twoDkAuthor = twoDk.creators.find(row => row.creatorId === '1007880' && row.role === '作者')
  assert.ok(twoDkAuthor?.sourceUrls.includes('https://anilist.co/staff/110537'))
  assert.ok(twoDkAuthor?.sourceUrls.includes('https://bgm.tv/subject/140536/persons'))
  const keionManga = await json('/api/work-lineage/works/14748')
  assert.equal(keionManga.workId, (await json('/api/work-lineage/works/32611')).workId)
  assert.equal(keionManga.media.group, 'manga')
  const keionAnime = await json('/api/work-lineage/works/14749')
  assert.equal(keionAnime.media.group, 'anime')
  assert.notEqual(keionAnime.workId, keionManga.workId)
  const happyGoLucky = await json('/api/work-lineage/works/9706')
  assert.equal(happyGoLucky.workId, '32594')
  assert.ok(happyGoLucky.sources.some(source => source.url === 'https://anilist.co/manga/35750'))
  assert.ok(!JSON.stringify(happyGoLucky).includes('https://anilist.co/manga/30294'))

  const originalCitrus = await json('/api/work-lineage/works/4402')
  const sequelCitrus = await json('/api/work-lineage/works/36758')
  assert.notEqual(originalCitrus.workId, sequelCitrus.workId)
  assert.ok(originalCitrus.printEditions.some(edition => edition.isbn === '9784758072649'))
  const citrusFourth = await json('/api/work-lineage/works/4621')
  assert.ok(citrusFourth.printEditions.some(edition => edition.url === 'https://data.ichijinsha.co.jp/detail/75807448'))
  const madokaAnthology = await json('/api/work-lineage/works/3798')
  assert.ok(madokaAnthology.printEditions.some(edition => edition.isbn === '9784832240643' && edition.onSale === '2011-09-12'))
  assert.ok(madokaAnthology.organizations.some(credit => credit.creatorId === '1002004' && credit.name === '芳文社'))
  const madokaPage = await (await response('/works/w-3798')).text()
  assert.ok(madokaPage.includes('纸书版本') && madokaPage.includes('2011-09-12 发售'))
  const translatedBook = await json('/api/work-lineage/works/4982')
  const originalPublisher = translatedBook.organizations.find(credit => credit.role === '原版出版社')
  assert.equal(originalPublisher?.creatorId, '700000002322')
  const author = translatedBook.creators.find(credit => credit.role === '作者')
  assert.equal(author?.creatorId, '503223358886')
  assert.ok(translatedBook.creators.some(credit => credit.role === '绘者' && credit.creatorId === author.creatorId))
  assert.ok(author.sourceUrls.some(url => url.includes('mangaupdates.com/author/')))
  assert.ok(translatedBook.sources.some(source => source.url === 'https://bgm.tv/subject/26072'))
  const shortManga = await json('/api/work-lineage/works/5048')
  const forumManga = await json('/api/work-lineage/works/5121')
  assert.ok(forumManga.sources.some(source => source.tier === 'community' && source.url === 'https://dynasty-scans.com/forum/topics/20307-100-days-until-the-president-and-new-hire-have-xxx-discussion'))
  assert.ok(shortManga.sources.some(source => source.tier === 'official' && source.url === 'https://www.pixiv.net/artworks/95560265'))
  assert.ok(shortManga.sources.some(source => source.tier === 'community' && source.url === 'https://mangadex.org/title/931b2dc4-0c44-43cf-a2b3-a15d629c95c6'))
  const creditedManga = await json('/api/work-lineage/works/5072')
  assert.ok(creditedManga.sources.some(source => source.tier === 'official' && source.url === 'https://flowercomics.jp/title/2867'))

  const darkKnight = await json('/api/work-lineage/works/10891')
  assert.ok(darkKnight.sources.some(source => source.tier === 'community' && source.url === 'https://www.yurimiru.com/works/f34397fc-e4e1-4c54-bb85-daf1d9a0e99e'))

  const yuriReview = 'https://www.ishiyuri.com/entry/20100723/p1'
  for (const [id, grade, includesReview] of [['12686', 'E', false], ['12853', 'B', true]]) {
    const work = await json(`/api/work-lineage/works/${id}`)
    assert.equal(work.rating.grade, grade)
    assert.equal(work.rating.decidingSource, 'official')
    assert.equal(work.sources.some(source => source.url === yuriReview), includesReview)
    assert.equal(work.rating.evidenceSources.some(source => source.url === yuriReview), includesReview)
  }
  for (const [original, remake, appId] of [['30533', '30530', '282900'], ['30536', '30531', '351710'], ['31486', '31485', '353270'], ['30999', null, '1901370']]) {
    const sources = (await json(`/api/work-lineage/works/${original}`)).sources
    assert.ok(sources.some(source => source.tier === 'official'))
    assert.ok(!sources.some(source => source.url.includes(`steampowered.com/app/${appId}`)))
    if (remake) {
      const entry = await json(`/api/work-lineage/works/${remake}`)
      assert.ok(entry.sources.some(source => source.url === `https://store.steampowered.com/app/${appId}/`))
    }
  }
  const translatedPage = await (await response('/works/w-4982')).text()
  for (const value of ['-6mm的禁忌', '-6mm no Taboo', 'マガジン・マガジン', '/organizations/o-700000002322', '/creators/c-503223358886']) {
    assert.ok(translatedPage.includes(value), `Missing book or publisher identity: ${value}`)
  }
  const translatedSearch = await json('/api/work-lineage/works?q=' + encodeURIComponent('-6mm的禁忌'))
  assert.ok(translatedSearch.items.some(work => work.workId === '4982'))
  assert.equal((await response('/organizations/o-700000002322')).status, 200)

  for (const [id, grade] of [['29019', 'B'], ['28505', 'A'], ['23732', 'F']]) {
    const work = await json(`/api/work-lineage/works/${id}`)
    assert.equal(work.rating.grade, grade)
    assert.equal(work.rating.needsMoreResearch, true)
    assert.ok(work.rating.evidenceSources.some((source) => source.kind === 'community'))
    assert.ok(work.rating.evidenceSources.some((source) => source.kind === 'official'))
    const page = await response(`/works/w-${id}`)
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.ok(html.includes('第三方 / 社区资料 · 评级依据'))
    for (const source of work.rating.evidenceSources) {
      assert.ok(html.includes(source.url.replaceAll('&', '&amp;')), `missing source for ${id}: ${source.url}`)
    }
  }

  for (const query of ['男性替身', 'NTR', '岸 虎次郎', '安達としまむら', 'Adachi and Shimamura', '安达与岛村']) {
    const result = await json(`/api/work-lineage/works?q=${encodeURIComponent(query)}&limit=2`)
    assert.ok(result.total > 0, `${query} should return matching works`)
  }

  const taggedWork = await json('/api/work-lineage/works/18556')
  assert.equal(taggedWork.rating.grade, 'E')
  assert.equal(taggedWork.rating.class, 'E-MALE-INTIMACY')
  assert.equal(taggedWork.rating.decidingSource, 'official')
  assert.ok(taggedWork.publicTags.some((tag) => tag.key === 'setting-otokonoko-crossdressing'))
  assert.equal('identity' in taggedWork, false)
  assert.equal('ordinal' in taggedWork, false)

  const remasteredCollection = await json('/api/work-lineage/works/4971')
  assert.equal(remasteredCollection.rating.class, 'B-LIGHT')
  assert.equal(remasteredCollection.rating.decidingSource, 'official')
  assert.equal(remasteredCollection.rating.uncertaintyKind, undefined)
  assert.equal(remasteredCollection.media.group, 'visual_novel')
  assert.equal(remasteredCollection.firstPublished, '2023-05-25')
  assert.ok(remasteredCollection.summary.text.includes('同一张游戏卡'))
  assert.ok(remasteredCollection.organizations.some(credit => credit.creatorId === '1013030' && credit.role === '发行'))
  const collectionPage = await (await response('/works/w-4971')).text()
  for (const expected of ['2023-05-25', 'サクセス', '/organizations/o-1013030', 'https://akaao.success-corp.co.jp/']) {
    assert.ok(collectionPage.includes(expected), `Switch collection should display ${expected}`)
  }
  const successReleases = await (await response('/organizations/o-1013030?year=2023')).text()
  assert.ok(successReleases.includes('/works/w-4971'))
  assert.equal((await json('/api/work-lineage/works/30231')).media.group, 'visual_novel')
  const repairedNovel = await json('/api/work-lineage/works/32114')
  assert.equal(repairedNovel.title, '剑刻的银乙女')
  assert.equal(repairedNovel.media.group, 'novel')

  const rainbows = await json('/api/work-lineage/works/12120')
  assert.equal(rainbows.rating.grade, 'B')
  assert.equal(rainbows.rating.decidingSource, 'community')
  assert.ok(rainbows.rating.sourceFindings.some(finding => finding.kind === 'official' && finding.classes.includes('S-RELATIONSHIP')))
  assert.ok(rainbows.rating.sourceFindings.some(finding => finding.kind === 'community' && finding.classes.includes('B-MALE-NOISE')))

  for (const [id, grade] of [['23622','S'],['18154','B'],['3934','C'],['19473','D'],['8506','E'],['12159','E'],['7925','F'],['18574','F']]) {
    const work = await json(`/api/work-lineage/works/${id}`)
    assert.equal(work.rating.grade,grade,`New assessment ${id}`)
    assert.ok(work.rating.reasoningSummary && work.rating.evidenceUrl)
  }
  const reissuedBl = await json('/api/work-lineage/works/8506')
  assert.equal(reissuedBl.rating.class, 'E-BL-HEAVY')
  assert.equal(reissuedBl.rating.decidingSource, 'official')
  const completedRouteReview = await json('/api/work-lineage/works/33717')
  assert.equal(completedRouteReview.rating.class, 'F-MALE-ROMANTIC-AXIS')
  assert.equal(completedRouteReview.rating.decidingSource, 'official')
  const renamedGame = await json('/api/work-lineage/works/32002')
  assert.equal(renamedGame.title, '鸢之歌：归途')
  assert.ok(renamedGame.aliases.includes('鸢之歌2:星纪元'))
  for (const [id, source] of [['4206', 'source-official'], ['6093', 'source-community']]) {
    const work = await json(`/api/work-lineage/works/${id}`)
    assert.equal(work.rating.grade, 'E')
    assert.deepEqual(work.publicTags.filter(tag => tag.group === '评级来源').map(tag => tag.key), [source])
  }
  for (const id of ['15053', '15056']) {
    const work = await json(`/api/work-lineage/works/${id}`)
    assert.equal(work.rating.grade, 'F', `Official assessment ${id}`)
    assert.ok(work.rating.reasoningSummary && work.rating.evidenceUrl)
    assert.equal(work.rating.needsMoreResearch, true)
  }
  const shortStoryCollection = await json('/api/work-lineage/works/38850')
  assert.equal(shortStoryCollection.rating.class, 'B-LIGHT')
  assert.ok(shortStoryCollection.rating.sourceFindings.some(finding =>
    finding.kind === 'community' && finding.urls.includes('https://www.yurizukan.com/articles/articleDetail/5932')))
  const newClip=await json('/api/work-lineage/works/32107')
  assert.equal(newClip.workId,'15896','New evidence must preserve the established public Work node')
  assert.equal(newClip.rating.grade,'C')
  assert.ok(newClip.rating.sourceFindings.some(finding => finding.classes.includes('C-FRIENDSHIP')))
  for (const credit of newClip.organizations) {
    const page=await response(`/organizations/o-${credit.creatorId}?year=2017`)
    assert.equal(page.status,200)
    assert.ok((await page.text()).includes('/works/w-15896'))
  }

  // Punctuation and exact-provider identity must keep distinct seasons/works distinct.
  // These pairs were concrete false merges under the retired punctuation-stripping policy.
  const yuruYuri = await json('/api/work-lineage/works/29857')
  const yuruYuriSeason2 = await json('/api/work-lineage/works/29865')
  assert.equal(yuruYuri.title, 'Yuru Yuri')
  assert.equal(yuruYuri.rating.grade, 'B')
  assert.equal(yuruYuriSeason2.title, 'Yuru Yuri♪♪')
  assert.equal(yuruYuriSeason2.rating.grade, 'B')
  assert.notEqual(yuruYuri.rating.evidenceUrl, yuruYuriSeason2.rating.evidenceUrl)
  assert.notEqual(yuruYuri.workId, yuruYuriSeason2.workId)

  const showByRock = await json('/api/work-lineage/works/25024')
  const showByRockSeason2 = await json('/api/work-lineage/works/25027')
  assert.equal(showByRock.title, 'SHOW BY ROCK!!')
  assert.equal(showByRock.rating.grade, 'C')
  assert.equal(showByRockSeason2.title, 'SHOW BY ROCK!!#')
  assert.equal(showByRockSeason2.rating.grade, 'D')
  assert.notEqual(showByRock.workId, showByRockSeason2.workId)

  // Evidence-backed cross-provider aliases resolve to one public work from every old Work ID.
  for (const [left, right] of [
    ['14098', '36929'], // One Ichijinsha anthology in two catalogues
    ['19062', '38373'], // One Mikanuji short-story collection
    ['3792', '11369'], // KUJIRA's single-volume Futabasha edition
    ['3846', '12356'], // The single-volume 2007 Ichijinsha edition
    ['37053', '10465'], // 2019 Fragtime theatrical OVA
    ['4612', '11811'], // Gurenki, the same Japanese collected manga series
    ['38644', '10470'], // Free Soul, the same Shodensha single-volume manga
    ['4130', '19875'], // The same Korean Another Revolution Story
    ['4341', '25029'], // The same Team Gaji webtoon
    ['36714', '31964'], // The Gaze of The Eternal Sun, full Steam app
    ['36722', '36481'], // No Fap Island, full game rather than its separate demo
    ['8384', '32723'], // Cosmic Princess Kaguya!, same streaming film
    ['9874', '32690'], // Sword Oratoria, TV adaptation
    ['36579', '31411'], // Cinderella Gray, second cour
    ['36586', '31414'], // Pretty Derby, third season
    ['3899', '25104'], // Three records for one edition
    ['33042', '25104'],
    ['36617', '31936'], // Kirakira Monstars, Windows release
    ['32484', '32572'], // The author renamed the same game in November 2023
    ['32659', '6340'], // Original manga series
    ['32671', '18148'], // Part one of the theatrical re-edit
    ['32703', '29863'], // Tenth-anniversary OVA
    ['33202', '31879'], // Loren, original game and its Steam storefront
    ['5409', '30268'], // Adachi and Shimamura / 安達としまむら
    ['5411', '30267'], // Mani's Gangan Online adaptation
    ['5412', '30265'], // Moke Yuzuhara's Dengeki Daioh adaptation
    ['24940', '31464'], // Kuu's Gangan Joker serialization
    ['26201', '31620'], // Tadokoro-san in Comic Valkyrie
    ['18664', '31953'], // Horoda's Manga Time Kirara Carat series
    ['33424', '31670'], // Studio 3.14's 2012 Windows release
    ['25236', '31618'], // Sky Girls 2007 TV
    ['25237', '31619'], // Sky Girls 2006 OVA
    ['17930', '31034'], // Lycoris Recoil WEB shorts
  ]) {
    const leftWork = await json(`/api/work-lineage/works/${left}`)
    const rightWork = await json(`/api/work-lineage/works/${right}`)
    assert.equal(leftWork.workId, rightWork.workId, `${left}/${right} should resolve to one public work`)
  }

  // Stale crosswalks and same-provider partial identities stay separate.
  for (const [left, right] of [
    ['33116', '33117'], // Light novel and manga adaptation
    ['5411', '5412'], // Two manga adaptations with different artists
    ['26200', '26201'], // Original webcomic and commercial redraw
    ['31170', '18695'], // Three-story selection and its eponymous early serial
    ['32671', '32674'], // Madoka's two theatrical editions
    ['32740', '32659'], // First printed volume and serial
    ['25237', '31618'],
    ['17926', '31034'],
    ['4142', '4978'],
    ['4918', '4979'],
    ['36426', '36701'], // The full Assistant and its first season
    ['31936', '32462'], // Windows game and its mobile adaptation
  ]) {
    const leftWork = await json(`/api/work-lineage/works/${left}`)
    const rightWork = await json(`/api/work-lineage/works/${right}`)
    assert.notEqual(leftWork.workId, rightWork.workId, `${left}/${right} should remain separate`)
  }

  const firstVolume = await json('/api/work-lineage/works/32072')
  const fullSeries = await json('/api/work-lineage/works/32073')
  assert.notEqual(firstVolume.workId, fullSeries.workId)
  assert.ok(firstVolume.title.includes('第 1 卷') && fullSeries.title.includes('全 3 卷'))
  const anthology = await json('/api/work-lineage/works/14098')
  assert.ok(anthology.creators.some(credit => credit.name === '南方純' && credit.role === '封面绘制'))
  const eternalSun = await json('/api/work-lineage/works/36714')
  assert.equal(eternalSun.workId, '31964')
  assert.equal(eternalSun.media.group, 'visual_novel')
  assert.ok(eternalSun.organizations.some(credit => credit.name === 'DogMade制作组'))
  assert.ok(!eternalSun.aliases.includes('null') && !eternalSun.summary.text.includes('null'))
  assert.ok(!eternalSun.organizations.some(credit => credit.name === 'null'))
  const enrichedDetail = await (await response('/works/w-36946')).text()
  for (const expected of ['岸 虎次郎', '集英社', '2011-03-18', '作品介绍']) {
    assert.ok(enrichedDetail.includes(expected), `enriched detail should include ${expected}`)
  }

  const creditedWork = await json('/api/work-lineage/works/36946')
  for (const credit of [creditedWork.creators[0], creditedWork.organizations[0]]) {
    assert.ok(credit.creatorId, 'Credits must expose stable CreatorIds')
    const organization = credit.creatorKind === 'organization'
    const path = `/${organization ? 'organizations/o' : 'creators/c'}-${credit.creatorId}`
    assert.ok(enrichedDetail.includes(`href="${path}"`), 'Work credits link to internal creator pages')
    const result = await response(path)
    assert.equal(result.status, 200)
    const creatorPage = await result.text()
    assert.ok(creatorPage.includes('按首次发行年份排列'))
    assert.ok(/href="\/works\/w-\d+"/.test(creatorPage), 'Creator pages link back to real Works')
    const wrongKind = `/${organization ? 'creators/c' : 'organizations/o'}-${credit.creatorId}`
    assert.equal((await response(wrongKind)).status, 404)
  }
  assert.equal((await response('/creators/c-999999999999')).status, 404)
  assert.ok(enrichedDetail.includes('role="doc-noteref"'))
  assert.ok(enrichedDetail.includes('id="ref-1"'))
  assert.ok(enrichedDetail.includes('资料来源与获取方式'))

  const [marriageCollection, marriageAlias] = await Promise.all(
    ['11643', '4290'].map(id => json('/api/work-lineage/works/' + id)),
  )
  assert.equal(marriageAlias.workId, marriageCollection.workId)
  assert.equal(marriageCollection.rating.grade, 'S')
  assert.equal(marriageCollection.rating.decidingSource, 'official')
  assert.ok(marriageCollection.printEditions.some(edition =>
    edition.isbn === '9784758075428' && edition.onSale === '2016-05-18'))

  const reasonDirectory = await (await response('/works?q=' + encodeURIComponent('合法百合夫婦本'))).text()
  assert.match(reasonDirectory, /<details class="card-assessment-reason"><summary>评级理由<span>含剧透<\/span><\/summary><p>[^<]+<\/p>/)
  const originalStudio = await (await response('/organizations/o-1011068')).text()
  assert.ok(originalStudio.includes('机构官方资料') && originalStudio.includes('P.A.WORKS'))
  const taggedDetail = await (await response('/works/w-18556')).text()
  for (const expected of [
    'AI 综合，待复核',
    '作品基本资料',
    '作者与创作机构',
    '排雷结论',
    '男娘 / 女装设定',
    '查看这条规则的判定边界',
    '资料来源',
  ]) {
    assert.ok(taggedDetail.includes(expected), `tagged detail should include ${expected}`)
  }
  assert.match(taggedDetail, /<details class="work-story-evidence">/)
  assert.ok(taggedDetail.indexOf('为什么这样评') < taggedDetail.indexOf('译名与别名'))
  assert.match(taggedDetail, /<details class="release-credit-more work-title-more">/)
  assert.ok(taggedDetail.includes('资料来源 · 目录信息'))
  assert.equal(taggedDetail.includes('资料来源 · official_metadata'), false)
  assert.ok(taggedDetail.indexOf('作品基本资料') < taggedDetail.indexOf('排雷结论'))
  assert.ok(taggedDetail.indexOf('作品介绍') < taggedDetail.indexOf('排雷结论'))
  assert.ok(taggedDetail.indexOf('排雷结论') < taggedDetail.indexOf('资料来源'))
  for (const forbidden of ['目录序号', '身份状态', '外部提供方', '外部站点 ID', '研究覆盖']) {
    assert.equal(taggedDetail.includes(forbidden), false, `detail should hide ${forbidden}`)
  }

  const ratings = await (await response('/ratings')).text()
  for (const expected of ['独立偏好层', 'TS / 性别转换', '扶她设定', 'ABO 设定', '成人 / 性描写']) {
    assert.ok(ratings.includes(expected), `ratings should include ${expected}`)
  }

  console.log(JSON.stringify({
    pages: pages.length,
    redirects: redirects.size,
    searches: 6,
    visibleWorks: health.visibleWorks,
    mergedAway: health.mergedAway,
    mergedGroups: health.mergedGroups,
    largestMergedGroup: health.largestMergedGroup,
    identitySafeFalseMergeRegressions: 'PASS',
    enrichedWorkDetails: 'PASS',
    ratingWarnings: 'PASS',
    structuredFeedbackIssueForms: 'PASS',
    anonymousWriteBoundary: 'PASS',
    publicFieldBoundary: 'PASS',
    creatorNavigationAndFootnotes: 'PASS',
    status: 'PASS',
  }, null, 2))
} catch (error) {
  console.error(error)
  if (serverOutput) console.error(`\nProduction server output:\n${serverOutput}`)
  process.exitCode = 1
} finally {
  await stopServer()
}
