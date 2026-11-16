'use client';

import { useState } from 'react';

// 这些错误码的 message 由本站生成（校验提示、业务码的中文说明），可以显示；其他错误码一律显示通用文案，不显示平台原文
const SITE_TEXT_CODES = ['INVALID_PARAM', 'ORDER_NOT_PAID', 'REFUND_EXCEEDS', 'RATE_LIMITED', 'SITE_DISABLED', 'PLATFORM_ERROR', 'INTERNAL_ERROR', 'UNAVAILABLE'];

export default function RefundForm({ siteOrderNo, refundable }) {
  const [amount, setAmount] = useState(refundable);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteOrderNo, amount, reason }),
      });
      const body = await res.json();
      if (body.code === 'OK') {
        window.location.reload();
        return;
      }
      setFailed(true);
      setMessage(SITE_TEXT_CODES.includes(body.code) && body.message ? body.message : '退款失败，请稍后再试');
    } catch {
      setFailed(true);
      setMessage('网络错误，请稍后查看订单的退款记录');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">可退金额：{refundable}</p>
      <p>
        <label>
          退款金额：
          <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
      </p>
      <p>
        <label>
          原因（可选，最长 200 个字符）：
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </label>
      </p>
      <button type="submit" disabled={busy}>
        申请退款
      </button>
      {message ? <p className={failed ? 'error' : ''}>{message}</p> : null}
    </form>
  );
}
