import { createRefund } from '../../../lib/orders.js';
import { currentAccount, getSite, jsonError, readJsonObject } from '../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 申请退款：只能退当前账号自己的已开通订单，可退金额由平台判断 */
export async function POST(request) {
  const account = currentAccount(request.headers.get('cookie'));
  if (!account) return jsonError(401, 'UNAUTHORIZED', '请先登录');
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'INVALID_PARAM', '请求格式不对');

  const { db, client } = getSite();
  const result = await createRefund(
    { db, client },
    { account, siteOrderNo: body.siteOrderNo, amount: body.amount, reason: body.reason },
  );
  if (!result.ok) return jsonError(result.status, result.code, result.message);
  return Response.json({ code: 'OK', message: '', data: { siteRefundNo: result.siteRefundNo, status: result.status } });
}
