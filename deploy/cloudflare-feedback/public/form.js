const form = document.querySelector('#feedback')
const status = document.querySelector('#status')
const button = document.querySelector('#submit')
let challengeToken = ''
let widget
let busy = false
const params = new URLSearchParams(location.search)
for (const [name, limit] of [['title', 200], ['workId', 12]]) {
  const value = (params.get(name) || '').slice(0, limit)
  if (name !== 'workId' || /^\d{0,12}$/.test(value)) form.elements[name].value = value
}
if (params.get('type') === 'new_work') form.elements.kind.value = 'new_work'
const messages = {
  closed: '投稿入口暂时关闭。你可以保留文字，或改用 GitHub 投稿。',
  unconfigured: '投稿入口尚未开放，请先使用网站的 GitHub 投稿入口。',
  daily_capacity: '今天的接收量已满，请明天再试。文字仍保留在当前页面。',
  duplicate: '近期已收到相同线索，无需重复提交。',
  rate_limited: '提交太频繁了，请稍后再试。',
  invalid_fields: '请检查字数、作品编号和来源链接。仅支持纯文字，链接请放在来源栏。',
  challenge: '验证失效了，请重新完成验证。',
  session: '页面会话已过期。请先复制保存文字，再刷新页面。',
  too_large: '内容过长，请缩短文字后再提交。',
}
function showError(code) { status.textContent = messages[code] || '暂时无法提交。文字仍保留在当前页面，请稍后再试。' }
async function init() {
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
    const config = await response.json()
    if (!response.ok) { showError(config.error); return }
    window.onTurnstileReady = () => {
      widget = window.turnstile.render('#challenge', {
        sitekey: config.siteKey, action: 'feedback',
        callback: token => { challengeToken = token; button.disabled = busy; },
        'expired-callback': () => { challengeToken = ''; button.disabled = true; },
        'error-callback': () => { challengeToken = ''; button.disabled = true; showError('challenge'); },
      })
      status.textContent = '填写完成并通过验证后即可提交。'
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit'
    script.async = true
    script.onerror = () => showError('challenge')
    document.head.append(script)
  } catch { showError('network') }
}
form.addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || !form.reportValidity() || !challengeToken) return
  const value = name => form.elements[name].value.trim()
  const sources = value('sources').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (sources.length > 3 || sources.some(url => !url.startsWith('https://') || url.length > 500)) {
    status.textContent = '来源最多 3 条，每条必须以 https:// 开头，且不超过 500 字。'; return
  }
  busy = true
  button.disabled = true
  status.textContent = '正在提交……'
  try {
    const response = await fetch('/api/submissions', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: value('kind'), workId: value('workId'), title: value('title'),
        description: value('description'), sources, location: value('location'), spoilers: value('spoilers'),
        website: value('website'), token: challengeToken, consent: form.elements.consent.checked }),
    })
    const result = await response.json()
    if (!response.ok) { showError(result.error); return }
    form.elements.description.value = ''
    status.textContent = `已收到，等待核实。提交编号：${result.id}`
  } catch { showError('network') }
  finally {
    busy = false
    challengeToken = ''
    button.disabled = true
    if (window.turnstile && widget !== undefined) window.turnstile.reset(widget)
  }
})
init()
