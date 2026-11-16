import { notFound } from 'next/navigation';
import {
  LOCAL_STATUS_TEXT,
  PAY_METHOD_TEXT,
  REFUND_STATUS_TEXT,
  REMOTE_STATUS_TEXT,
  getOrderStatus,
  notSubmittedText,
  refundableAmount,
  textOf,
} from '../../../lib/orders.js';
import { getSite } from '../../../lib/site.js';
import { requireAccount } from '../../require-account.js';
import RefundForm from './refund-form.jsx';

export default async function OrderDetail({ params }) {
  const account = await requireAccount();
  const { no } = await params;
  const { db, client } = getSite();
  // 注意：页面的 GET 请求会触发查单；查到平台订单已关闭且本地仍是 created 时，getOrderStatus 会把本地订单回写为 closed
  const info = await getOrderStatus({ db, client }, { account, siteOrderNo: no, force: true });
  if (!info) notFound();
  const order = db.getOrder(no);
  const refunds = db.listRefunds(no);
  const remote = info.remote;
  // 平台查单失败时不知道已退金额，仍显示退款表单，由平台判断
  const refundable = remote ? refundableAmount(order.amount, remote.refundedAmount) : order.amount;
  const rejected = !order.order_no && Boolean(order.last_error_code);
  const canRefund = info.fulfilled && Number(refundable.replace('.', '')) > 0;

  return (
    <main>
      <h1>订单 {order.site_order_no}</h1>
      <p>
        金额：{order.amount} {order.currency}，支付方式：{textOf(PAY_METHOD_TEXT, order.pay_method)}，状态：{textOf(LOCAL_STATUS_TEXT, order.status)}，已开通：{info.fulfilled ? '是' : '否'}
      </p>
      {remote ? (
        <table>
          <tbody>
            <tr><th>平台订单号</th><td>{remote.orderNo}</td></tr>
            <tr><th>平台状态</th><td>{textOf(REMOTE_STATUS_TEXT, remote.status)}</td></tr>
            <tr><th>实付金额</th><td>{remote.paidAmount ?? '-'}</td></tr>
            <tr><th>已退金额</th><td>{remote.refundedAmount}</td></tr>
            <tr><th>到期时间</th><td>{remote.expireAt ?? '-'}</td></tr>
          </tbody>
        </table>
      ) : (
        <p className={rejected ? 'error' : 'muted'}>
          {info.queryError
            ? '平台未找到该订单/配置有误，请联系站点。'
            : info.stale
              ? '暂时无法获取平台上的最新状态。'
              : notSubmittedText(order)}
          {rejected && order.product_id ? <> <a href={`/buy/${order.product_id}`}>重新下单</a></> : null}
        </p>
      )}

      <h2>退款记录</h2>
      {refunds.length === 0 ? <p className="muted">没有退款记录。</p> : null}
      <ul>
        {refunds.map((r) => (
          <li key={r.site_refund_no}>
            {r.site_refund_no}：{r.amount}，{textOf(REFUND_STATUS_TEXT, r.status)}
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
