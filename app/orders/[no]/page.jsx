import { notFound } from 'next/navigation';
import { getOrderStatus, refundableAmount } from '../../../lib/orders.js';
import { getSite } from '../../../lib/site.js';
import { requireAccount } from '../../require-account.js';
import RefundForm from './refund-form.jsx';

export default async function OrderDetail({ params }) {
  const account = await requireAccount();
  const { no } = await params;
  const { db, client } = getSite();
  const info = await getOrderStatus({ db, client }, { account, siteOrderNo: no, force: true });
  if (!info) notFound();
  const order = db.getOrder(no);
  const refunds = db.listRefunds(no);
  const remote = info.remote;
  // 平台查单失败时不知道已退金额，仍显示退款表单，由平台判断
  const refundable = remote ? refundableAmount(order.amount, remote.refundedAmount) : order.amount;
  const canRefund = info.fulfilled && Number(refundable.replace('.', '')) > 0;

  return (
    <main>
      <h1>订单 {order.site_order_no}</h1>
      <p>
        金额：{order.amount} {order.currency}，支付方式：{order.pay_method}，本地状态：{order.status}，已开通：{info.fulfilled ? '是' : '否'}
      </p>
      {remote ? (
        <table>
          <tbody>
            <tr><th>平台订单号</th><td>{remote.orderNo}</td></tr>
            <tr><th>平台状态</th><td>{remote.status}</td></tr>
            <tr><th>实付金额</th><td>{remote.paidAmount ?? '-'}</td></tr>
            <tr><th>已退金额</th><td>{remote.refundedAmount}</td></tr>
            <tr><th>到期时间</th><td>{remote.expireAt ?? '-'}</td></tr>
          </tbody>
        </table>
      ) : (
        <p className="muted">{info.stale ? '暂时无法获取平台上的最新状态。' : '订单尚未提交到平台。'}</p>
      )}

      <h2>退款记录</h2>
      {refunds.length === 0 ? <p className="muted">没有退款记录。</p> : null}
      <ul>
        {refunds.map((r) => (
          <li key={r.site_refund_no}>
            {r.site_refund_no}：{r.amount}，{r.status}
            {r.reason ? `，${r.reason}` : ''}
          </li>
        ))}
      </ul>

      <h2 id="refund">申请退款</h2>
      {canRefund ? (
        <RefundForm siteOrderNo={order.site_order_no} refundable={refundable} />
      ) : (
        <p className="muted">{info.fulfilled ? '没有可退金额。' : '订单已支付并开通后才能申请退款。'}</p>
      )}
    </main>
  );
}
