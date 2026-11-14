'use client';

import { useEffect, useState } from 'react';

const TEXT = {
  created: '等待付款……',
  paid: '已开通',
  closed: '订单已关闭（超时或未支付），请重新下单',
};

export default function PayStatus({ siteOrderNo, initialStatus }) {
  const [state, setState] = useState({ status: initialStatus, fulfilled: initialStatus === 'paid', stale: false });

  useEffect(() => {
    if (state.fulfilled || state.status === 'closed') return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${siteOrderNo}`);
        const body = await res.json();
        if (body.code === 'OK') setState(body.data);
      } catch {
        // 网络错误：保持上次状态，下次再查
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [siteOrderNo, state.fulfilled, state.status]);

  const paidNotFulfilled = state.status === 'created' && state.remote?.status === 'paid';
  return (
    <p>
      <strong>{paidNotFulfilled ? '已收到付款，正在开通……' : TEXT[state.fulfilled ? 'paid' : state.status]}</strong>
      {state.stale ? <span className="muted">（状态暂时无法更新，稍后自动重试）</span> : null}
    </p>
  );
}
