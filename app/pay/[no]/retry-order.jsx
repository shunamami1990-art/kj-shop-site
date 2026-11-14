'use client';

import { useState } from 'react';

/** 下单结果未知（本站没有收到平台订单号）：提示不要重复下单，提供用同一个订单号重试 */
export default function RetryOrder({ siteOrderNo }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/pay/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteOrderNo }),
      });
      const body = await res.json();
      if (body.code === 'OK') {
        window.location.reload();
        return;
      }
      setMessage(body.message || body.code);
    } catch {
      setMessage('网络错误，请稍后再试');
    }
    setBusy(false);
  }

  return (
    <div>
      <p className="error">结果未知，请稍后在我的订单里查看，不要重复下单。</p>
      <p>
        <button type="button" onClick={retry} disabled={busy}>
          重试下单
        </button>
      </p>
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
