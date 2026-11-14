import { getSite, jsonError } from '../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 存活检查：不验签，数据库可用返回 200，否则 503，不返回配置或错误详情 */
export async function GET() {
  try {
    getSite().db.ping();
  } catch {
    return jsonError(503, 'UNAVAILABLE', '');
  }
  return Response.json({ code: 'OK', message: '', data: { service: 'shop-site', version: 'dev+unknown' } });
}
