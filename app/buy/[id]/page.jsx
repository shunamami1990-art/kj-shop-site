import { notFound } from 'next/navigation';
import { PAY_METHODS, findProduct } from '../../../lib/products.js';
import { requireAccount } from '../../require-account.js';
import BuyForm from './buy-form.jsx';

export default async function Buy({ params }) {
  await requireAccount();
  const { id } = await params;
  const product = findProduct(id);
  if (!product) notFound();
  return (
    <main>
      <h1>{product.name}</h1>
      <p>
        价格：{product.price} {product.currency}
      </p>
      <BuyForm productId={product.id} methods={PAY_METHODS[product.currency]} />
    </main>
  );
}
