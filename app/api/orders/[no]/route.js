import { getOrderStatus } from '../../../../lib/orders.js';
import { currentAccount, getSite, jsonError } from '../../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 本站订单状态（本地记录 + 平台查单）；只返回当前账号自己的订单 */
export async function GET(request, { params }) {
  const account = currentAccount(request.headers.get('cookie'));
  if (!account) return jsonError(401, 'UNAUTHORIZED', '请先登录');

  const { no } = await params;
  const { db, client } = getSite();
  const status = await getOrderStatus({ db, client }, { account, siteOrderNo: no });
  if (!status) return jsonError(404, 'NOT_FOUND', '订单不存在');
  return Response.json({ code: 'OK', message: '', data: status });
}
