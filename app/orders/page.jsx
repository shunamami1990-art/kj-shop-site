import { findProduct } from '../../lib/products.js';
import { getSite } from '../../lib/site.js';
import { requireAccount } from '../require-account.js';

const STATUS_TEXT = { created: '待付款', paid: '已支付', closed: '已关闭' };

export default async function Orders() {
  const account = await requireAccount();
  const orders = getSite().db.listOrders(account);
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
              <td>{o.pay_method}</td>
              <td>{STATUS_TEXT[o.status] ?? o.status}</td>
              <td>{o.status === 'paid' ? '是' : '否'}</td>
              <td>{o.created_at}</td>
              <td>
                <a href={`/orders/${o.site_order_no}`}>查看</a>
                {o.status === 'paid' ? (
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
