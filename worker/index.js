/**
 * NoteMaster API on Cloudflare Workers + D1.
 *
 * The Express/MongoDB server in `server/` is the reference implementation and
 * stays the way to run the project locally with a real database. This Worker is
 * the same HTTP contract backed by D1, so the React client can be published as
 * a live demo without a Node process or a managed MongoDB cluster.
 *
 * Contract is deliberately identical to `server/routes/*.js`:
 *
 *   POST   /api/auth                { username, password } -> 201 { token, user }
 *   POST   /api/auth/login          { username, password } -> 200 { token, user }
 *   GET    /api/notes?q=&tag=&sort=                        -> [ note ]
 *   POST   /api/notes                                      -> 201 note
 *   GET    /api/notes/:id                                  -> note
 *   PUT    /api/notes/:id                                  -> note
 *   PATCH  /api/notes/:id/pin                              -> note
 *   DELETE /api/notes/:id                                  -> { msg, deleted }
 *   GET    /health                                         -> { status, database }
 *
 * Everything else is served from the built React app.
 *
 * Security notes:
 *   - passwords are PBKDF2-SHA256 with a per-user salt (bcrypt cannot be used
 *     here without pulling a native-free implementation into the bundle);
 *   - the JWT signing key is 32 random bytes generated once per environment and
 *     kept in D1, so it is never in the repository;
 *   - every note query is scoped by the author taken from the verified token,
 *     never from the request body.
 */

const MAX_BODY_BYTES = 1_000_000;
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;
const MAX_TITLE_LENGTH = 200;
const MAX_USERS = 500;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();

const ORDERS = {
  recent: 'pinned DESC, updated_at DESC',
  created: 'pinned DESC, created_at DESC',
  oldest: 'pinned DESC, updated_at ASC',
  title: 'pinned DESC, title COLLATE NOCASE ASC',
};

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const fail = (status, msg) => json({ msg }, status);

/* -------------------------------------------------------------------------- */
/* Encoding helpers                                                           */
/* -------------------------------------------------------------------------- */

const b64url = {
  encode(bytes) {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const normalised = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
  encodeText(text) {
    return b64url.encode(encoder.encode(text));
  },
};

/** Compare two strings without short-circuiting on the first difference. */
const equalTimingSafe = (a, b) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

const safeJson = (text, fallback) => {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch (error) {
    return fallback;
  }
};

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

const derive = async (password, salt, iterations) => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
};

const hashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url.encode(salt)}$${b64url.encode(hash)}`;
};

const verifyPassword = async (password, stored) => {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;

  const expected = b64url.decode(hash);
  const actual = await derive(password, b64url.decode(salt), Number(iterations) || PBKDF2_ITERATIONS);

  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ actual[i];
  return difference === 0;
};

/* -------------------------------------------------------------------------- */
/* Tokens (HS256)                                                             */
/* -------------------------------------------------------------------------- */

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

const signToken = async (username, secret) => {
  const header = b64url.encodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url.encodeText(
    JSON.stringify({ username, iat: now, exp: now + TOKEN_TTL_SECONDS })
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(signingInput));
  return `${signingInput}.${b64url.encode(signature)}`;
};

/** Returns the token payload, or null for anything that is not valid. */
const verifyToken = async (token, secret) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${header}.${payload}`)
  );

  if (!equalTimingSafe(b64url.encode(expected), signature)) return null;

  const claims = safeJson(new TextDecoder().decode(b64url.decode(payload)), null);
  if (!claims || typeof claims.username !== 'string') return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;

  return claims;
};

/**
 * The client stores the token with JSON.stringify, so the header value arrives
 * quoted. Accept a raw token as well.
 */
const readToken = (request) => {
  const raw = request.headers.get('x-auth-token');
  if (!raw) return '';
  const parsed = safeJson(raw, null);
  return typeof parsed === 'string' ? parsed : raw;
};

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT COLLATE NOCASE NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS notes (
     id TEXT PRIMARY KEY,
     author TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '[]',
     plain_text TEXT NOT NULL DEFAULT '',
     video_link TEXT NOT NULL DEFAULT '',
     video_timestamp REAL NOT NULL DEFAULT 0,
     tags TEXT NOT NULL DEFAULT '[]',
     pinned INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS notes_author_list ON notes (author, pinned DESC, updated_at DESC)`,
];

let bootstrap = null;

/**
 * Create the schema and the signing key once per isolate. Every statement is
 * idempotent, so a cold start that races another cold start is harmless.
 */
const ensureSchema = (db) => {
  if (!bootstrap) {
    bootstrap = (async () => {
      await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
      await db
        .prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .bind('jwt_secret', b64url.encode(crypto.getRandomValues(new Uint8Array(32))))
        .run();
    })().catch((error) => {
      bootstrap = null;
      throw error;
    });
  }
  return bootstrap;
};

let signingKey = null;

const jwtSecret = async (db) => {
  if (signingKey) return signingKey;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('jwt_secret').first();
  if (!row) throw new Error('signing key missing');
  signingKey = row.value;
  return signingKey;
};

/* -------------------------------------------------------------------------- */
/* Note helpers                                                               */
/* -------------------------------------------------------------------------- */

const normaliseTags = (input) => {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const seen = new Set();

  for (const entry of raw) {
    const clean = String(entry).trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (clean) seen.add(clean);
    if (seen.size >= MAX_TAGS) break;
  }

  return [...seen];
};

/** Slate sends the document as a JSON string; accept a string, array or object. */
const parseBody = (body) => {
  if (Array.isArray(body)) return body;
  if (typeof body === 'string') {
    const parsed = safeJson(body, []);
    return Array.isArray(parsed) ? parsed : [];
  }
  if (body && typeof body === 'object') return [body];
  return [];
};

const extractText = (nodes) => {
  const parts = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.text === 'string') parts.push(node.text);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(nodes);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
};

const toNote = (row) => {
  const created = new Date(row.created_at).toISOString();
  return {
    _id: row.id,
    title: row.title,
    body: safeJson(row.body, []),
    plainText: row.plain_text,
    author: row.author,
    videoLink: row.video_link,
    videoTimestamp: row.video_timestamp,
    tags: safeJson(row.tags, []),
    pinned: Boolean(row.pinned),
    date: created,
    createdAt: created,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
};

const isId = (value) => /^[A-Za-z0-9-]{6,64}$/.test(value);

const escapeLike = (value) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/* -------------------------------------------------------------------------- */
/* Handlers                                                                   */
/* -------------------------------------------------------------------------- */

const register = async (request, env) => {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (username.length < 3) return fail(400, 'Usernames must be at least 3 characters.');
  if (username.length > 32) return fail(400, 'Usernames are limited to 32 characters.');
  if (password.length < 6) return fail(400, 'Password length must be at least 6 characters.');

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  if (count >= MAX_USERS) {
    return fail(429, 'This demo has reached its account limit. Run it locally with your own database.');
  }

  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), username, await hashPassword(password), Date.now())
      .run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error && error.message))) {
      return fail(409, `User ${username} already exists. Try logging in.`);
    }
    throw error;
  }

  const token = await signToken(username, await jwtSecret(env.DB));
  return json({ token, user: { username } }, 201);
};

const login = async (request, env) => {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) return fail(400, 'Username and password are required.');

  const user = await env.DB.prepare('SELECT username, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first();

  // One response for "no such user" and "wrong password": telling them apart
  // would let anyone enumerate accounts.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return fail(401, 'Invalid username or password.');
  }

  const token = await signToken(user.username, await jwtSecret(env.DB));
  return json({ token, user: { username: user.username } });
};

const listNotes = async (request, env, author) => {
  const params = new URL(request.url).searchParams;
  const where = ['author = ?'];
  const binds = [author];

  const tag = (params.get('tag') || '').trim().toLowerCase();
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(notes.tags) WHERE json_each.value = ?)');
    binds.push(tag);
  }

  const term = (params.get('q') || '').trim().slice(0, 200);
  if (term) {
    const pattern = `%${escapeLike(term)}%`;
    where.push(
      `(title LIKE ? ESCAPE '\\' OR plain_text LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`
    );
    binds.push(pattern, pattern, pattern);
  }

  const order = ORDERS[params.get('sort')] || ORDERS.recent;
  const { results } = await env.DB.prepare(
    `SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`
  )
    .bind(...binds)
    .all();

  return json((results || []).map(toNote));
};

const createNote = async (request, env, author) => {
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) return fail(400, 'A note needs a title.');
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(400, `Titles are limited to ${MAX_TITLE_LENGTH} characters.`);
  }

  const document = parseBody(body.body);
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    author,
    title,
    body: JSON.stringify(document),
    plain_text: extractText(document),
    video_link: typeof body.videoLink === 'string' ? body.videoLink : '',
    video_timestamp: Number(body.videoTimestamp) || 0,
    tags: JSON.stringify(normaliseTags(body.tags)),
    pinned: 0,
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    `INSERT INTO notes (id, author, title, body, plain_text, video_link, video_timestamp, tags, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.author,
      row.title,
      row.body,
      row.plain_text,
      row.video_link,
      row.video_timestamp,
      row.tags,
      row.pinned,
      row.created_at,
      row.updated_at
    )
    .run();

  return json(toNote(row), 201);
};

const readNote = async (env, author, id) => {
  if (!isId(id)) return fail(400, 'Invalid note id.');
  const row = await env.DB.prepare('SELECT * FROM notes WHERE id = ? AND author = ?')
    .bind(id, author)
    .first();
  if (!row) return fail(404, 'No note found with that id.');
  return json(toNote(row));
};

const updateNote = async (request, env, author, id) => {
  if (!isId(id)) return fail(400, 'Invalid note id.');

  const existing = await env.DB.prepare('SELECT * FROM notes WHERE id = ? AND author = ?')
    .bind(id, author)
    .first();
  if (!existing) return fail(404, 'No note found with that id.');

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return fail(400, 'A note needs a title.');
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(400, `Titles are limited to ${MAX_TITLE_LENGTH} characters.`);
  }

  const document = parseBody(body.body);
  const tags =
    body.tags === undefined ? safeJson(existing.tags, []) : normaliseTags(body.tags);
  const videoLink =
    typeof body.videoLink === 'string' ? body.videoLink : existing.video_link;
  const videoTimestamp =
    body.videoTimestamp === undefined
      ? existing.video_timestamp
      : Number(body.videoTimestamp) || 0;
  const updatedAt = Date.now();

  await env.DB.prepare(
    `UPDATE notes
        SET title = ?, body = ?, plain_text = ?, video_link = ?, video_timestamp = ?, tags = ?, updated_at = ?
      WHERE id = ? AND author = ?`
  )
    .bind(
      title,
      JSON.stringify(document),
      extractText(document),
      videoLink,
      videoTimestamp,
      JSON.stringify(tags),
      updatedAt,
      id,
      author
    )
    .run();

  return readNote(env, author, id);
};

const togglePin = async (env, author, id) => {
  if (!isId(id)) return fail(400, 'Invalid note id.');

  const result = await env.DB.prepare(
    `UPDATE notes SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END, updated_at = updated_at
      WHERE id = ? AND author = ?`
  )
    .bind(id, author)
    .run();

  if (!result.meta || result.meta.changes === 0) return fail(404, 'No note found with that id.');
  return readNote(env, author, id);
};

const deleteNote = async (env, author, id) => {
  if (!isId(id)) return fail(400, 'Invalid note id.');

  const result = await env.DB.prepare('DELETE FROM notes WHERE id = ? AND author = ?')
    .bind(id, author)
    .run();

  if (!result.meta || result.meta.changes === 0) return fail(404, 'No note found with that id.');
  return json({ msg: 'success', deleted: id });
};

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

const route = async (request, env) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (path === '/health' || path === '/api/health') {
    return json({ status: 'ok', database: 'connected', runtime: 'cloudflare-workers' });
  }

  if (path === '/api/auth' && method === 'POST') return register(request, env);
  if (path === '/api/auth/login' && method === 'POST') return login(request, env);

  if (path === '/api/notes') {
    if (method !== 'GET' && method !== 'POST') return fail(405, 'Method not allowed.');
  }

  if (path.startsWith('/api/')) {
    await ensureSchema(env.DB);

    const token = readToken(request);
    if (!token) return fail(401, 'Invalid token. Access denied.');

    const claims = await verifyToken(token, await jwtSecret(env.DB));
    if (!claims) return fail(401, 'Token is not valid.');

    const author = claims.username;

    if (path === '/api/notes') {
      if (method === 'GET') return listNotes(request, env, author);
      return createNote(request, env, author);
    }

    const match = /^\/api\/notes\/([^/]+)(\/pin)?$/.exec(path);
    if (match) {
      const [, id, pin] = match;

      if (pin) {
        if (method !== 'PATCH') return fail(405, 'Method not allowed.');
        return togglePin(env, author, id);
      }

      if (method === 'GET') return readNote(env, author, id);
      if (method === 'PUT') return updateNote(request, env, author, id);
      if (method === 'DELETE') return deleteNote(env, author, id);
      return fail(405, 'Method not allowed.');
    }

    return fail(404, `No route for ${method} ${path}`);
  }

  return env.ASSETS.fetch(request);
};

export default {
  async fetch(request, env) {
    if (!env.DB) return fail(500, 'Database binding DB is missing.');

    // A 1 MB cap, matching the Express json body limit.
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return fail(413, 'That request is too large.');

    try {
      return await route(request, env);
    } catch (error) {
      console.error('[api]', error && error.stack ? error.stack : error);
      return fail(500, 'Something went wrong.');
    }
  },
};
