'use client';

import { useEffect, useState } from 'react';

const TEXT = {
  created: '等待付款……',
  paid: '已开通',
  closed: '订单已关闭（超时或未支付），请重新下单',
};

const POLL_MS = 3000;
// 订单关闭后仍可能收到迟到的付款：低频轮询，开通后自动显示
const CLOSED_POLL_MS = 30000;

export default function PayStatus({ siteOrderNo, initialStatus }) {
  const [state, setState] = useState({ status: initialStatus, fulfilled: initialStatus === 'paid', stale: false, queryError: null });

  useEffect(() => {
    if (state.fulfilled) return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${siteOrderNo}`);
        const body = await res.json();
        if (body.code === 'OK') setState(body.data);
      } catch {
        // 网络错误：保持上次状态，下次再查
      }
    }, state.status === 'closed' ? CLOSED_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [siteOrderNo, state.fulfilled, state.status]);

  const paidNotFulfilled = state.status === 'created' && state.remote?.status === 'paid';
  return (
    <p>
      <strong>{paidNotFulfilled ? '已收到付款，正在开通……' : TEXT[state.fulfilled ? 'paid' : state.status]}</strong>
      {state.status === 'closed' && !state.fulfilled ? <span className="muted">（若已付款，开通后会自动显示）</span> : null}
      {state.queryError ? <span className="error">（平台未找到该订单/配置有误，请联系站点）</span> : null}
      {state.stale ? <span className="muted">（状态暂时无法更新，稍后自动重试）</span> : null}
    </p>
  );
}
