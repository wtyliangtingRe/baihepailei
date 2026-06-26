import type { DetailItem } from '../_lib/detail-index'

export default function CommentBlock({ item }: { item: DetailItem }) {
  return (
    <section className="page comment-block-shell" aria-label="评论区">
      <div className="detail-card comment-block">
        <div>
          <p className="eyebrow">评论区</p>
          <h2>简易评论</h2>
          <p className="muted">这里预留给注册用户发表短评、补充阅读感想或提醒条目需要复核。</p>
        </div>
        <div className="comment-compose-placeholder">
          <label htmlFor={`comment-${item.collection}-${item.slug}`}>发表评论</label>
          <textarea id={`comment-${item.collection}-${item.slug}`} placeholder="后续会开放给已登录用户填写。" disabled />
          <button type="button" disabled>登录后评论</button>
        </div>
      </div>
    </section>
  )
}
