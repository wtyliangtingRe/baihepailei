import Link from 'next/link'

export default function EvidencePage() {
  return <main className="page"><section className="empty-state small"><h1>当前研究证据尚未生成</h1><p>旧证据只作为隔离参考，不属于正式数据库。新的 Research 会创建独立证据对象。</p><Link className="back-link" href="/radar">查看研究状态</Link></section></main>
}
