import { PRODUCTS } from '../lib/products.js';
import { requireAccount } from './require-account.js';

export default async function Home() {
  const account = await requireAccount();
  return (
    <main>
      <h1>商品列表</h1>
      <p className="muted">当前账号：{account}</p>
      <table>
        <thead>
          <tr>
            <th>商品</th>
            <th>价格</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {PRODUCTS.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {p.price} {p.currency}
              </td>
              <td>
                <a className="button" href={`/buy/${p.id}`}>
                  购买
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
