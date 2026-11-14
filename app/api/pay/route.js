import { createPayOrder } from '../../../lib/orders.js';
import { currentAccount, getSite, jsonError, readJsonObject } from '../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 去支付：金额和币种只看服务端商品表，请求体里即使带了金额也忽略 */
export async function POST(request) {
  const account = currentAccount(request.headers.get('cookie'));
  if (!account) return jsonError(401, 'UNAUTHORIZED', '请先登录');
  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'INVALID_PARAM', '请求格式不对');

  const { db, client } = getSite();
  const result = await createPayOrder({ db, client }, { account, productId: body.productId, payMethod: body.payMethod });
  if (!result.ok) return jsonError(result.status, result.code, result.message);
  return Response.json({ code: 'OK', message: '', data: { siteOrderNo: result.siteOrderNo } });
}
