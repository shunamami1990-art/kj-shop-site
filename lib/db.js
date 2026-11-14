// SQLite 存储（Node 内置 node:sqlite）。表结构见 docs/database.md，改表先改那份文档。
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NONCE_TTL_MS } from './kj-sign.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  account TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  site_order_no TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  product_id TEXT,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  pay_method TEXT NOT NULL,
  payable_amount TEXT,
  order_no TEXT UNIQUE,
  status TEXT NOT NULL,
  payment_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_account_created ON orders (account, created_at);
CREATE TABLE IF NOT EXISTS fulfillments (
  order_no TEXT PRIMARY KEY,
  site_order_no TEXT NOT NULL,
  account TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  site_refund_no TEXT PRIMARY KEY,
  site_order_no TEXT NOT NULL,
  refund_no TEXT UNIQUE,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_order ON refunds (site_order_no);
`;

const iso = () => new Date().toISOString();

/**
 * @param {string} path 文件路径，或 ':memory:'
 * @param {() => number} [now] 毫秒时间，用于随机串过期
 */
export function openDb(path, now = Date.now) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);

  /**
   * 同步事务：函数里不能有 await，所以同一进程内两次开通不会交错。
   * @template T @param {() => T} fn
   */
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const q = {
    addCustomer: db.prepare('INSERT OR IGNORE INTO customers (account, created_at) VALUES (?, ?)'),
    customer: db.prepare('SELECT account FROM customers WHERE account = ?'),
    insertOrder: db.prepare(
      `INSERT INTO orders (site_order_no, account, product_id, amount, currency, pay_method, payable_amount, order_no, status, payment_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    order: db.prepare('SELECT * FROM orders WHERE site_order_no = ?'),
    orderByNo: db.prepare('SELECT * FROM orders WHERE order_no = ?'),
    ordersOf: db.prepare('SELECT * FROM orders WHERE account = ? ORDER BY created_at DESC, site_order_no DESC'),
    setCreated: db.prepare('UPDATE orders SET order_no = ?, payable_amount = ?, payment_json = ?, updated_at = ? WHERE site_order_no = ?'),
    setStatus: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE site_order_no = ?'),
    markPaid: db.prepare("UPDATE orders SET status = 'paid', order_no = ?, updated_at = ? WHERE site_order_no = ?"),
    fulfilled: db.prepare('SELECT order_no FROM fulfillments WHERE order_no = ?'),
    insertFulfillment: db.prepare(
      'INSERT OR IGNORE INTO fulfillments (order_no, site_order_no, account, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    event: db.prepare('SELECT event_id FROM events WHERE event_id = ?'),
    addEvent: db.prepare('INSERT OR IGNORE INTO events (event_id, received_at) VALUES (?, ?)'),
    deleteNonces: db.prepare('DELETE FROM nonces WHERE seen_at < ?'),
    addNonce: db.prepare('INSERT OR IGNORE INTO nonces (nonce, seen_at) VALUES (?, ?)'),
    insertRefund: db.prepare(
      `INSERT INTO refunds (site_refund_no, site_order_no, refund_no, amount, status, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    refund: db.prepare('SELECT * FROM refunds WHERE site_refund_no = ?'),
    refundByNo: db.prepare('SELECT * FROM refunds WHERE refund_no = ?'),
    refundsOf: db.prepare('SELECT * FROM refunds WHERE site_order_no = ? ORDER BY created_at, site_refund_no'),
    updateRefund: db.prepare('UPDATE refunds SET refund_no = ?, status = ?, updated_at = ? WHERE site_refund_no = ?'),
  };

  return {
    ping() {
      db.prepare('SELECT 1').get();
    },

    addCustomer: (/** @type {string} */ account) => void q.addCustomer.run(account, iso()),
    findCustomer: (/** @type {string} */ account) => (q.customer.get(account) ? {} : null),

    /** @param {{ siteOrderNo: string, account: string, productId: string | null, amount: string, currency: string, payMethod: string, status: string }} o */
    insertOrder(o) {
      const t = iso();
      q.insertOrder.run(o.siteOrderNo, o.account, o.productId, o.amount, o.currency, o.payMethod, null, null, o.status, null, t, t);
    },
    getOrder: (/** @type {string} */ siteOrderNo) => /** @type {any} */ (q.order.get(siteOrderNo)) ?? null,
    getOrderByOrderNo: (/** @type {string} */ orderNo) => /** @type {any} */ (q.orderByNo.get(orderNo)) ?? null,
    listOrders: (/** @type {string} */ account) => /** @type {any[]} */ (q.ordersOf.all(account)),
    /** 下单成功后保存平台订单号和 payment */
    saveCreated(/** @type {string} */ siteOrderNo, /** @type {string} */ orderNo, /** @type {string | null} */ payableAmount, /** @type {unknown} */ payment) {
      q.setCreated.run(orderNo, payableAmount, JSON.stringify(payment ?? null), iso(), siteOrderNo);
    },
    setOrderStatus: (/** @type {string} */ siteOrderNo, /** @type {string} */ status) => void q.setStatus.run(status, iso(), siteOrderNo),

    /**
     * 开通：以 order_no 为唯一键插入开通记录，同一事务里把本地订单改为 paid。
     * 返回 true 表示这次是第一次开通；已开通过返回 false（视为成功）。
     * 站点事先没有记录的订单（paycode、shop）按查单返回的数据建一条本地订单。
     * @param {{ orderNo: string, siteOrderNo?: string | null, customerAccount: string, amount: string, currency: string, payMethod: string, payableAmount?: string | null }} order 查单返回的订单
     */
    fulfill(order) {
      return transaction(() => {
        const local = order.siteOrderNo ? q.order.get(order.siteOrderNo) : q.orderByNo.get(order.orderNo);
        const t = iso();
        /** @type {string} */
        let siteOrderNo;
        if (local) {
          siteOrderNo = /** @type {string} */ (local.site_order_no);
          q.markPaid.run(order.orderNo, t, siteOrderNo);
        } else {
          siteOrderNo = order.siteOrderNo || order.orderNo;
          q.insertOrder.run(siteOrderNo, order.customerAccount, null, order.amount, order.currency, order.payMethod, order.payableAmount ?? null, order.orderNo, 'paid', null, t, t);
        }
        const result = q.insertFulfillment.run(order.orderNo, siteOrderNo, order.customerAccount, order.amount, order.currency, t);
        return Number(result.changes) === 1;
      });
    },
    isFulfilled: (/** @type {string} */ orderNo) => q.fulfilled.get(orderNo) !== undefined,

    isEventDone: (/** @type {string} */ eventId) => q.event.get(eventId) !== undefined,
    markEventDone: (/** @type {string} */ eventId) => void q.addEvent.run(eventId, iso()),

    /** 随机串没用过时记下并返回 true；10 分钟内用过返回 false */
    remember(/** @type {string} */ keyId, /** @type {string} */ nonce) {
      const t = now();
      q.deleteNonces.run(t - NONCE_TTL_MS);
      return Number(q.addNonce.run(`${keyId}\n${nonce}`, t).changes) === 1;
    },

    /** @param {{ siteRefundNo: string, siteOrderNo: string, refundNo?: string | null, amount: string, status: string, reason?: string | null }} r */
    insertRefund(r) {
      const t = iso();
      q.insertRefund.run(r.siteRefundNo, r.siteOrderNo, r.refundNo ?? null, r.amount, r.status, r.reason ?? null, t, t);
    },
    getRefund: (/** @type {string} */ siteRefundNo) => /** @type {any} */ (q.refund.get(siteRefundNo)) ?? null,
    getRefundByNo: (/** @type {string} */ refundNo) => /** @type {any} */ (q.refundByNo.get(refundNo)) ?? null,
    listRefunds: (/** @type {string} */ siteOrderNo) => /** @type {any[]} */ (q.refundsOf.all(siteOrderNo)),
    updateRefund: (/** @type {string} */ siteRefundNo, /** @type {string | null} */ refundNo, /** @type {string} */ status) =>
      void q.updateRefund.run(refundNo, status, iso(), siteRefundNo),
  };
}

/** @typedef {ReturnType<typeof openDb>} ShopDb */
