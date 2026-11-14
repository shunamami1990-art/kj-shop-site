import { isSecureRequest, normalizeAccount, sessionCookie } from '../../../lib/session.js';
import { getSite } from '../../../lib/site.js';

export const dynamic = 'force-dynamic';

/** 登录页表单提交：只输入账号名，登录过的账号记入 customers（校验客户账号接口以此判断账号是否存在） */
export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const account = normalizeAccount(form?.get('account'));
  if (!account) return new Response(null, { status: 303, headers: { Location: '/login?error=1' } });

  const { db, config } = getSite();
  db.addCustomer(account);
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': sessionCookie(account, config.sessionSecret, isSecureRequest(request.headers)) },
  });
}
