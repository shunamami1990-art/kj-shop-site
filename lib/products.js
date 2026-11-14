// 固定商品表。价格是固定小数位的字符串（CNY 两位，USDT 六位），下单只看这里，不看浏览器传来的金额。

export const PRODUCTS = [
  { id: 'p-100', name: '体验套餐', price: '10.00', currency: 'CNY' },
  { id: 'p-200', name: '标准套餐', price: '60.00', currency: 'CNY' },
  { id: 'p-300', name: '高级套餐', price: '100.00', currency: 'CNY' },
  { id: 'u-100', name: '体验套餐（USDT）', price: '8.300000', currency: 'USDT' },
];

/** 币种可用的支付方式（契约 PayMethod；店铺码由平台分配，站点不选） */
export const PAY_METHODS = {
  CNY: [
    { id: 'wechat', label: '微信支付' },
    { id: 'alipay', label: '支付宝' },
  ],
  USDT: [{ id: 'usdt', label: 'USDT' }],
};

/** @param {unknown} id */
export function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}

/**
 * @param {string} currency @param {unknown} payMethod
 */
export function isPayMethodAllowed(currency, payMethod) {
  return (PAY_METHODS[currency] ?? []).some((m) => m.id === payMethod);
}
