/**
 * Rung-3 measurement target: a local CRUD app with a real HTTP API.
 *
 * Rung 2 proved the schema against a static page. It could not touch the two
 * paths that matter most downstream and are still running on hand-written
 * fixtures:
 *
 *   endpoints[]     §5 makes the inferred response schema "the mock backend's
 *                   data model"; §8 seeds the store from it. Codegen leans on
 *                   this harder than on anything else.
 *   states.probed   §6's hover/click probing, for the JS-driven changes that are
 *                   absent from the CSSOM by construction.
 *   flows/          §6: "This tuple set IS the functional specification."
 *
 * Plus both auth contexts (§6): anonymous is redirected to /login, authenticated
 * gets the app.
 *
 * A todo app rather than Gitea: the thing under test is inference over an
 * observed HTTP conversation — path patterns, response schemas across
 * observations, mutation and auth detection — which is mechanical, and a small
 * honest API exercises it as well as a large one while staying readable.
 *
 *   node packages/capture/scripts/crud-app.mjs [port]
 */
import { createServer } from 'node:http';

/* --------------------------------------------------------------- the store */

const USER = { id: 'usr_1', email: 'operator@localhost', password: 'pw-8Qv3n2Lx-rung3', displayName: 'Operator' };

const LISTS = [
  { id: 'lst_1', name: 'Today', colour: 'blue' },
  { id: 'lst_2', name: 'Someday', colour: 'grey' },
];

let nextTodo = 5;
let todos = [
  // `status` is the field whose domain the UI constrains, and `title` is the one
  // it does not. Rung 3 exists to show inference telling them apart: both have
  // few distinct values across four records, and only one is an enum.
  { id: 'td_1', listId: 'lst_1', title: 'Write the capture stage', status: 'doing', done: false, priority: 2, createdAt: '2026-09-01T09:00:00.000Z' },
  { id: 'td_2', listId: 'lst_1', title: 'Validate the schema against reality', status: 'done', done: true, priority: 1, createdAt: '2026-09-02T09:00:00.000Z' },
  { id: 'td_3', listId: 'lst_2', title: 'Read the CSSOM instead of hovering', status: 'open', done: false, priority: 3, createdAt: '2026-09-03T09:00:00.000Z' },
  { id: 'td_4', listId: 'lst_2', title: 'Stop trusting green checks', status: 'open', done: false, priority: 2, createdAt: '2026-09-04T09:00:00.000Z' },
];
const reset = () => {
  nextTodo = 5;
  todos = todos.map((t) => ({ ...t }));
};

const sessions = new Map();
// Monotonic, not `sessions.size + 1`: session-destructive probing deletes
// sessions on purpose now, and a size-derived id reissues a live one after the
// first logout.
let nextSession = 1;
const sid = () => `sess_${(nextSession++).toString(16).padStart(8, '0')}`;

/* -------------------------------------------------------------------- html */

const CSS = `
:root{--ink:#1c1917;--muted:#78716c;--accent:#2563eb;--line:#e7e5e4}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:#fafaf9}
header{display:flex;align-items:center;gap:16px;padding:16px 24px;background:#fff;border-bottom:1px solid var(--line)}
main{max-width:720px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:0 0 20px}
.btn{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}
.btn:hover{background:#1d4ed8}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
.todo{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.todo[data-done="true"] .title{text-decoration:line-through;color:var(--muted)}
.todo input:checked+.title{color:var(--muted)}
.title{flex:1}
.filters{display:flex;gap:8px;margin-bottom:16px}
.filters .btn[aria-pressed="true"]{background:var(--ink)}
/* No CSS rule keys off .is-open: the details panel is JS-driven only, so §6's
   probing is the only way to discover it. That is deliberate. */
.panel{display:none}
.panel.is-open{display:block;padding:8px 0;color:var(--muted);font-size:14px}
form{display:flex;gap:8px;margin-top:20px}
input[type=text],input[type=password]{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px}
.error{color:#b91c1c;font-size:14px}
`;

const APP = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Rung Three — todos</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app.css"></head>
<body>
<header><strong>Rung Three</strong>
  <button class="btn secondary" id="logout" type="button" style="margin-left:auto">Sign out</button>
</header>
<main>
  <h1>Todos</h1>
  <div class="filters">
    <button class="btn secondary" type="button" data-filter="all" aria-pressed="true">All</button>
    <button class="btn secondary" type="button" data-filter="open" aria-pressed="false">Open</button>
    <button class="btn secondary" type="button" data-filter="done" aria-pressed="false">Done</button>
  </div>
  <div id="list" aria-live="polite"></div>
  <button class="btn secondary" id="details" type="button">Show details</button>
  <div class="panel" id="panel">Four todos across two lists. Priority 1 is highest.</div>
  <label for="status-filter">Status</label>
  <select name="status" id="status-filter" aria-label="Filter by status">
    <option value="open">Open</option>
    <option value="doing">Doing</option>
    <option value="done">Done</option>
  </select>
  <form id="new"><input type="text" id="title" placeholder="New todo" aria-label="New todo">
    <button class="btn" type="submit">Add</button></form>
  <p><button class="btn" id="delete-all" type="button">Delete all todos</button></p>
  <!--
    The designated target-destructive control (decision 0011). Unlike "Delete all
    todos" it is never fired, even under --allow-destructive, so the synthesized
    path — a control bound to a URL by infer, with responses: [] — keeps its
    coverage against a real crawl instead of only against a fixture.
  -->
  <p><button class="btn btn-danger" id="delete-account" type="button">Delete account</button></p>
  <!-- out-of-scope: another origin. Not destructive, just not ours to exercise. -->
  <p><a id="docs" href="https://example.net/help">Help (external)</a>
     <a id="contact" href="mailto:support@example.net">Email support</a></p>
</main>
<script>
const listEl = document.getElementById('list');
let filter = 'all';
async function load() {
  const res = await fetch('/api/todos?status=' + filter, { headers: { accept: 'application/json' } });
  const data = await res.json();
  listEl.innerHTML = data.items.map((t) => \`
    <div class="todo" data-todo="\${t.id}" data-done="\${t.done}">
      <input type="checkbox" \${t.done ? 'checked' : ''} aria-label="Mark \${t.title} done">
      <span class="title">\${t.title}</span>
      <button class="btn secondary" type="button" data-bump="\${t.id}">Bump</button>
    </div>\`).join('');
}
document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((o) =>
    o.setAttribute('aria-pressed', String(o === b)));
  load();
}));
listEl.addEventListener('click', async (e) => {
  const bump = e.target.closest('[data-bump]');
  if (bump) {
    await fetch('/api/todos/' + bump.dataset.bump, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 1 }),
    });
    load();
    return;
  }
  const box = e.target.closest('input[type=checkbox]');
  if (box) {
    const row = box.closest('[data-todo]');
    await fetch('/api/todos/' + row.dataset.todo, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: box.checked }),
    });
    load();
  }
});
// JS-driven only: no CSS selector mentions .is-open, so the CSSOM pass cannot
// find this and §6's probing must.
document.getElementById('details').addEventListener('click', (e) => {
  const p = document.getElementById('panel');
  p.classList.toggle('is-open');
  e.currentTarget.textContent = p.classList.contains('is-open') ? 'Hide details' : 'Show details';
});
document.getElementById('new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title');
  await fetch('/api/todos', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: title.value, listId: 'lst_1' }),
  });
  title.value = '';
  load();
});
document.getElementById('delete-all').addEventListener('click', async () => {
  await fetch('/api/todos', { method: 'DELETE' });
  load();
});
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
});
// Never fired by capture. The fetch literal is here because binding it to a URL
// is exactly what §7.6 does by reading the source — the endpoint is reachable to
// infer and to a human, and to nothing else.
document.getElementById('delete-account').addEventListener('click', async () => {
  await fetch('/api/account', { method: 'DELETE' });
  location.href = '/login';
});
load();
</script>
</body></html>`;

const LOGIN = (error) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in — Rung Three</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app.css"></head>
<body>
<header><strong>Rung Three</strong></header>
<main>
  <h1>Sign in</h1>
  ${error ? `<p class="error" role="alert">${error}</p>` : ''}
  <form method="post" action="/login">
    <input type="text" name="email" id="email" placeholder="Email" aria-label="Email" autocomplete="username">
    <input type="password" name="password" id="password" placeholder="Password" aria-label="Password" autocomplete="current-password">
    <button class="btn" type="submit">Sign in</button>
  </form>
</main></body></html>`;

/* ------------------------------------------------------------------ server */

const json = (res, status, body) => {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length });
  res.end(buf);
};
const html = (res, status, body, headers = {}) => {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, ...headers });
  res.end(buf);
};
const readBody = (req) => new Promise((resolve) => {
  let d = '';
  req.on('data', (c) => { d += c; });
  req.on('end', () => resolve(d));
});
const sessionOf = (req) => {
  const raw = req.headers.cookie ?? '';
  const m = raw.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return undefined;
  const value = sessions.get(m[1]);
  // The id travels with the session so a handler can end *this* one — which
  // session-destructive probing exercises for real now.
  return value ? { id: m[1], ...value } : undefined;
};

const port = Number(process.argv[2] ?? 8789);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const session = sessionOf(req);

  if (path === '/app.css') {
    const buf = Buffer.from(CSS, 'utf8');
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'content-length': buf.length });
    return res.end(buf);
  }
  if (path === '/__reset' && method === 'POST') { reset(); return json(res, 200, { ok: true }); }

  // --- pages ---
  if (path === '/') {
    if (!session) return res.writeHead(302, { location: '/login' }).end();
    return html(res, 200, APP);
  }
  if (path === '/login' && method === 'GET') return html(res, 200, LOGIN(null));
  if (path === '/login' && method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    if (body.get('email') === USER.email && body.get('password') === USER.password) {
      const id = sid();
      sessions.set(id, { userId: USER.id });
      return res.writeHead(302, { location: '/', 'set-cookie': `sid=${id}; HttpOnly; Path=/; SameSite=Lax` }).end();
    }
    return html(res, 401, LOGIN('Those credentials did not work.'));
  }

  // --- api ---
  if (path === '/api/auth/login' && method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.email === USER.email && body.password === USER.password) {
      const id = sid();
      sessions.set(id, { userId: USER.id });
      res.setHeader('set-cookie', `sid=${id}; HttpOnly; Path=/; SameSite=Lax`);
      return json(res, 200, { userId: USER.id, displayName: USER.displayName });
    }
    return json(res, 401, { error: 'invalid_credentials' });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    // Actually ends the session. It used to return 204 without touching the
    // session map, which made "session-destructive" a hazard the fixture could
    // not actually inflict — and a probe that cannot break anything proves
    // nothing about the mechanism that protects against it.
    if (session) sessions.delete(session.id);
    return json(res, 204, {});
  }
  if (path.startsWith('/api/')) {
    if (!session) return json(res, 401, { error: 'unauthenticated' });
  }
  if (path === '/api/lists' && method === 'GET') return json(res, 200, { items: LISTS });
  if (path === '/api/todos' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'all';
    const items = todos.filter((t) => status === 'all' || (status === 'done' ? t.done : !t.done));
    return json(res, 200, { items, total: items.length, page: 1 });
  }
  if (path === '/api/todos' && method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.title) return json(res, 400, { error: 'title_required', field: 'title' });
    const todo = {
      id: `td_${nextTodo++}`, listId: body.listId ?? 'lst_1', title: body.title,
      status: 'open', done: false, priority: 3, createdAt: '2026-09-08T00:00:00.000Z',
    };
    todos.push(todo);
    return json(res, 201, todo);
  }
  if (path === '/api/todos' && method === 'DELETE') {
    todos = [];
    return json(res, 204, {});
  }
  // Implemented so the app is honest, and never called: capture must not fire
  // the control, so no observation of this can ever exist in a capture artifact.
  if (path === '/api/account' && method === 'DELETE') {
    todos = [];
    sessions.delete(session.id);
    return json(res, 204, {});
  }
  const one = path.match(/^\/api\/todos\/([A-Za-z0-9_]+)$/);
  if (one) {
    const todo = todos.find((t) => t.id === one[1]);
    if (!todo) return json(res, 404, { error: 'not_found' });
    if (method === 'GET') return json(res, 200, todo);
    if (method === 'PATCH') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.done !== undefined) todo.done = Boolean(body.done);
      if (body.priority !== undefined) todo.priority = Number(body.priority);
      if (body.title !== undefined) todo.title = String(body.title);
      return json(res, 200, todo);
    }
    if (method === 'DELETE') {
      todos = todos.filter((t) => t.id !== one[1]);
      return json(res, 204, {});
    }
  }
  return json(res, 404, { error: 'not_found' });
}).listen(port, '127.0.0.1', () => {
  console.log(`rung-3 target on http://127.0.0.1:${port}/`);
  console.log(`  credentials: ${USER.email} / ${USER.password}  (local fixture app)`);
});
