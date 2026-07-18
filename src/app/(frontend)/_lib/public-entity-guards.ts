const hiddenCreatorTitles = [
  '《魔法少女小圆 scene0》：下倉バイオ',
  '《魔法少女小圆 scene0》: 下倉バイオ',
  '「女子かう生」若井ケン',
  '「女子かう生」 若井ケン',
  '「アイドルマスター シンデレラガールズ U149」井之',
  '「アイドルマスター シンデレラガールズ U149」 井之',
  '「バーナード嬢曰く。」',
  '「ライフル・イズ・ビューティフル」サルミアッキ',
  '「ライフル・イズ・ビューティフル」 サルミアッキ',
  '『不思議の国のアリス』',
  '『荒野のコトブキ飛行隊』',
  '『アズールレーン』運営',
  '『アズールレーン』 運営',
  '『ワガママハイスペック』',
  '【原案】祁答院慎',
  '【原案】祁答院慎【角色原画】神城咲弥',
  '【原案】祁答院慎 【角色原画】神城咲弥',
  '07th Expansion',
] as const

function compactKey(value?: string) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, '')
    .trim()
    .toLowerCase()
}

const hiddenCreatorKeys = new Set(hiddenCreatorTitles.map(compactKey))

export function isPublicCreatorTitle(value?: string) {
  const key = compactKey(value)
  return Boolean(key) && !hiddenCreatorKeys.has(key)
}

export function isPublicSearchItem(item: { collection?: string; title?: string; status?: string }) {
  if (item.collection === 'works' && item.status === 'archived') return false
  if (item.collection !== 'creators') return true
  return isPublicCreatorTitle(item.title)
}

export { hiddenCreatorTitles }
