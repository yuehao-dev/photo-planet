'use strict';

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function page(message = '', settings) {
  const { basePath, usernameOnly } = settings;
  const password = usernameOnly ? '' : '<label for="password">密码</label><input type="password" id="password" name="password" autocomplete="current-password" maxlength="256" required>';

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHTML(settings.loginTitle)}</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='.9em' font-size='56'%3E🪐%3C/text%3E%3C/svg%3E"><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f8f4ec;color:#514b42;font-family:system-ui,sans-serif;padding:24px}main{width:min(100%,360px)}.planet{font-size:42px}h1{font-family:Georgia,serif;font-size:29px;margin:24px 0 12px}p{font-size:14px;line-height:1.8;color:#877e70}label{display:block;margin:32px 0 10px;font-size:14px}input,button{width:100%;min-height:52px;border-radius:14px;font:inherit}input{border:1px solid #d9d0c1;background:#fffdf8;padding:14px;outline-color:#8b9870}button{border:0;background:#788765;color:white;margin-top:16px;cursor:pointer}.error{min-height:24px;color:#a35646;font-size:13px}small{display:block;margin-top:24px;color:#9a9183;font-size:12px}</style><main><span class="planet" aria-hidden="true">🪐</span><h1>${escapeHTML(settings.loginTitle)}</h1><p>${escapeHTML(settings.loginNote)}</p><form method="post" action="${basePath}login"><label for="account">我们的账号</label><input id="account" name="account" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" placeholder="输入你的账号" required autofocus>${password}<button type="submit">进去看看 →</button><p class="error" role="status">${message}</p></form><small>${usernameOnly ? '此入口使用显式开启的账号模式。' : '使用你部署时设置的账号与密码。'}</small></main></html>`;
}

function html(res, status, message = '', headers = {}, settings) {
  const body = page(message, settings);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(body);
}

async function login(req, res, guard, logout = false) {
  const settings = guard.settings;
  const respond = (status, message = '', headers = {}) => html(res, status, message, headers, settings);
  if (req.method === 'GET' && !logout) return respond(200);
  if (req.method !== 'POST') { res.writeHead(405, { Allow: logout ? 'POST' : 'GET, POST' }); res.end(); return; }
  if (req.headers.origin !== settings.publicOrigin) { res.writeHead(403); res.end(); return; }
  if (logout) { res.writeHead(303, { Location: settings.basePath + 'login', 'Set-Cookie': guard.sessionCookie(true), 'Cache-Control': 'no-store' }); res.end(); return; }
  if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) return respond(400, '再试一次，好吗？');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) return respond(413, '账号有点长，再检查一下。');
    chunks.push(chunk);
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString());
  const account = fields.get('account') || '';
  const password = settings.usernameOnly ? '' : fields.get('password') || '';
  if (!settings.usernameOnly && (!password || password.length > 256)) return respond(400, '请输入有效的密码。');
  if (!account.trim()) return respond(400, '先写下我们的账号。');
  if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(account)) return respond(400, '检查一下账号，再试试。');
  let status; let headers;
  await guard.handle({ headers: { authorization: 'Basic ' + Buffer.from(account + ':' + password).toString('base64'),
    'x-album-client-ip': req.headers['x-album-client-ip'] } }, { writeHead(code, values) { status = code; headers = values; }, end() {} });
  if (status === 200) { res.writeHead(303, { Location: settings.basePath, 'Set-Cookie': guard.sessionCookie(), 'Cache-Control': 'private, no-store' }); res.end(); return; }
  if (status === 403) return respond(429, '试了好多次啦，15 分钟后再来试试。', { 'Retry-After': headers['Retry-After'] });
  if (status === 401) return respond(401, '账号或密码不对，再试试。');
  return respond(503, '稍等一下，星球正在准备。');
}

module.exports = { login };
