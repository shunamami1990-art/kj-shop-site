import { LOCAL_STATUS_TEXT, PAY_METHOD_TEXT, localRefundable, textOf } from '../../lib/orders.js';
import { findProduct } from '../../lib/products.js';
import { getSite } from '../../lib/site.js';
import { requireAccount } from '../require-account.js';

export default async function Orders() {
  const account = await requireAccount();
  const { db } = getSite();
  const orders = db.listOrders(account);
  return (
    <main>
      <h1>我的订单</h1>
      {orders.length === 0 ? <p className="muted">还没有订单。</p> : null}
      <table>
        <thead>
          <tr>
            <th>订单号</th>
            <th>商品</th>
            <th>金额</th>
            <th>支付方式</th>
            <th>状态</th>
            <th>已开通</th>
            <th>时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.site_order_no}>
              <td>{o.site_order_no}</td>
              <td>{findProduct(o.product_id)?.name ?? '-'}</td>
              <td>
                {o.amount} {o.currency}
              </td>
              <td>{textOf(PAY_METHOD_TEXT, o.pay_method)}</td>
              <td>{textOf(LOCAL_STATUS_TEXT, o.status)}</td>
              <td>{o.status === 'paid' ? '是' : '否'}</td>
              <td>{o.created_at}</td>
              <td>
                <a href={`/orders/${o.site_order_no}`}>查看</a>
                {/* 按本地退款记录判断，已退完的订单不再显示入口；精确的可退金额以订单详情和平台为准 */}
                {o.status === 'paid' && Number(localRefundable(o.amount, db.listRefunds(o.site_order_no)).replace('.', '')) > 0 ? (
                  <>
                    {' '}
                    <a href={`/orders/${o.site_order_no}#refund`}>申请退款</a>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
