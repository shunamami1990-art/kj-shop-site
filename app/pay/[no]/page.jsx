import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { describePayment } from '../../../lib/kj-payment.js';
import { getSite } from '../../../lib/site.js';
import { requireAccount } from '../../require-account.js';
import PayStatus from './pay-status.jsx';
import RetryOrder from './retry-order.jsx';

/** 二维码在服务端生成图片，不把付款内容交给第三方 */
async function qrImage(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 240 });
}

async function PaymentView({ payment, productId }) {
  const view = describePayment(payment);
  if (!view.supported) {
    return (
      <p className="error">
        {view.message}。<a href={productId ? `/buy/${productId}` : '/'}>重新选择支付方式</a>
      </p>
    );
  }
  const { type, content } = view;
  if (type === 'usdt') {
    return (
      <div>
        <p>网络：{content.network}</p>
        <p>收款地址：{content.address}</p>
        <p>
          应付金额：<strong>{content.amount}</strong> USDT
        </p>
        <p className="error">请按应付金额精确转账（含全部 6 位小数），金额不符无法自动确认。</p>
      </div>
    );
  }
  const image = content.qrcodeImage ?? (content.qrcode ? await qrImage(content.qrcode) : null);
  return (
    <div>
      {content.url ? (
        <p>
          <a className="button" href={content.url} target="_blank" rel="noopener noreferrer">
            前往付款
          </a>
        </p>
      ) : null}
      {image ? (
        <p>
          <img src={image} alt="付款二维码" width={240} height={240} />
        </p>
      ) : null}
    </div>
  );
}

export default async function Pay({ params }) {
  const account = await requireAccount();
  const { no } = await params;
  const order = getSite().db.getOrder(no);
  if (!order || order.account !== account) notFound();

  const payment = order.payment_json ? JSON.parse(order.payment_json) : null;
  return (
    <main>
      <h1>付款</h1>
      <p>订单号：{order.site_order_no}</p>
      <p>
        订单金额：{order.amount} {order.currency}
        {order.payable_amount && order.payable_amount !== order.amount ? `，应付金额：${order.payable_amount} ${order.currency}` : ''}
      </p>
      {order.status === 'created' && !order.order_no ? <RetryOrder siteOrderNo={order.site_order_no} /> : null}
      {order.status === 'created' && order.order_no ? <PaymentView payment={payment} productId={order.product_id} /> : null}
      {order.status === 'created' && order.order_no ? <p className="muted">付款后由平台核对，可能需要几分钟。</p> : null}
      <PayStatus siteOrderNo={order.site_order_no} initialStatus={order.status} />
      <p>
        <a href="/orders">我的订单</a>
      </p>
    </main>
  );
}
