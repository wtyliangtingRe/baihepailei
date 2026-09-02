export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { code: 'public_raw_evidence_unavailable', message: '首发网站不提供原始研究证据包下载。' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
