export default async function Login({ searchParams }) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>登录</h1>
      <p className="muted">示例站不设密码，输入账号名即可登录（首次使用的账号会自动建立）。</p>
      <form method="post" action="/api/login">
        <label>
          账号名（1～64 个字符）：
          <input name="account" maxLength={64} required />
        </label>{' '}
        <button type="submit">登录</button>
      </form>
      {error ? <p className="error">账号名不合格，请重新输入</p> : null}
    </main>
  );
}
