import { handleNotify } from '../../../../lib/kj-notify.js';
import { createNotifyStore } from '../../../../lib/orders.js';
import { getSite } from '../../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 平台的订单事件通知：验签、去重、先查单确认再开通，成功回复 success */
export async function POST(request) {
  const { db, client, config } = getSite();
  return handleNotify({
    request,
    siteId: config.siteId,
    secret: config.secret,
    nonceStore: db,
    client,
    store: createNotifyStore(db),
  });
}
