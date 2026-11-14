import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentAccount } from '../lib/site.js';

/** 页面用：取登录账号，未登录跳转到登录页 */
export async function requireAccount() {
  const account = currentAccount((await headers()).get('cookie'));
  if (!account) redirect('/login');
  return account;
}
