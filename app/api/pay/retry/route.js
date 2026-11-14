import { retryPayOrder } from '../../../../lib/orders.js';
import { currentAccount, getSite, jsonError, readJsonObject } from '../../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 重试下单：用同一个 siteOrderNo 再提交，平台按幂等处理（付款页上"结果未知"的订单用） */
export async function POST(request) {
  const account = currentAccount(request.headers.get('cookie'));
  if (!account) return jsonError(401, 'UNAUTHORIZED', '请先登录');
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'INVALID_PARAM', '请求格式不对');

  const { db, client } = getSite();
  const result = await retryPayOrder({ db, client }, { account, siteOrderNo: body.siteOrderNo });
  if (!result.ok) {
    return jsonError(result.status, result.code, result.message, result.siteOrderNo ? { siteOrderNo: result.siteOrderNo } : null);
  }
  return Response.json({ code: 'OK', message: '', data: { siteOrderNo: result.siteOrderNo } });
}
