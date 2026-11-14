export const metadata = { title: '示例商品站' };

const css = `
  body { font-family: sans-serif; max-width: 760px; margin: 0 auto; padding: 16px; color: #222; }
  nav a { margin-right: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  button, .button { padding: 6px 14px; cursor: pointer; }
  .error { color: #b00020; }
  .muted { color: #666; }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <style>{css}</style>
        <nav>
          <a href="/">商品</a>
          <a href="/orders">我的订单</a>
          <a href="/login">切换账号</a>
        </nav>
        <hr />
        {children}
      </body>
    </html>
  );
}
