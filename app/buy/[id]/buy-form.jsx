'use client';

import { useState } from 'react';

export default function BuyForm({ productId, methods }) {
  const [payMethod, setPayMethod] = useState(methods[0].id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, payMethod }),
      });
      const body = await res.json();
      if (body.code === 'OK') {
        window.location.href = `/pay/${body.data.siteOrderNo}`;
        return;
      }
      if (body.data?.siteOrderNo) {
        // 结果未知：订单已记录，到付款页查看，不要重复下单
        window.location.href = `/pay/${body.data.siteOrderNo}`;
        return;
      }
      setError(body.message || body.code);
    } catch {
      setError('网络错误，请稍后再试');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <p>选择支付方式：</p>
      {methods.map((m) => (
        <label key={m.id} style={{ display: 'block' }}>
          <input type="radio" name="payMethod" value={m.id} checked={payMethod === m.id} onChange={() => setPayMethod(m.id)} /> {m.label}
        </label>
      ))}
      <p>
        <button type="submit" disabled={busy}>
          去支付
        </button>
      </p>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
