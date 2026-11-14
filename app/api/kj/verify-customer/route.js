import { handleVerifyCustomer } from '../../../../lib/kj-verify-customer.js';
import { getSite } from '../../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 校验客户账号：账号登录过本站即存在 */
export async function POST(request) {
  const { db, config } = getSite();
  return handleVerifyCustomer({
    request,
    siteId: config.siteId,
    secret: config.secret,
    nonceStore: db,
    findCustomer: (account) => db.findCustomer(account),
  });
}
