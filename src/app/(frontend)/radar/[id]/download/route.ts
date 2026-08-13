export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { code: 'historical_radar_retired', message: '历史 Radar 数据未进入新正式数据库。' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
