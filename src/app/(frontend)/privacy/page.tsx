import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: '隐私政策' }

export default function PrivacyPage() {
  return (
    <main className="page collection-page">
      <header className="page-heading collection-heading">
        <h1>隐私政策</h1>
      </header>

      <section className="detail-card">
        <h2>浏览与反馈</h2>
        <p>网站将你选择的日间或夜间主题保存在当前浏览器中。通过邮件或第三方表单提交反馈时，收件方会收到你主动填写的资料。外部服务按各自的隐私政策处理数据。</p>
      </section>

      <section className="detail-card">
        <h2>Google AdSense 广告</h2>
        <p>启用广告后，Google 及其他广告合作伙伴可能在你的浏览器中写入或读取 Cookie，并使用网络信标、IP 地址或其他标识符来投放广告、衡量效果和识别无效流量。广告合作伙伴可能根据你过往访问本站或其他网站的记录投放个性化广告。</p>
        <p>你可以在 <a href="https://myadcenter.google.com/">Google 我的广告中心</a>关闭 Google 个性化广告，也可以在 <a href="https://optout.aboutads.info/">Digital Advertising Alliance</a> 管理参与计划的其他广告商设置。<a href="https://policies.google.com/technologies/partner-sites?hl=zh-CN">查看 Google 如何处理合作网站的数据</a>。</p>
      </section>

      <section className="detail-card">
        <h2>联系我们</h2>
        <p>关于本站的数据使用，有问题可通过<Link href="/feedback">反馈页</Link>联系站务。</p>
      </section>
    </main>
  )
}
