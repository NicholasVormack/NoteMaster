# NoteMaster

**A full-stack note-taking app for timestamped notes on YouTube videos.**

Sign in, paste a video URL, and take rich-text notes against it. Every note keeps
the video's playback position at the moment you saved, so a note remembers *where*
in a two-hour lecture it came from. Notes are searchable, taggable and pinnable.

MERN stack: MongoDB, Express, React, Node.

**[Live demo →](https://notemaster-6b0lj3.freebuff.site)** — create any account and
start writing. The hosted build runs this React client against a Cloudflare
Workers + D1 port of the same API (see [Hosted demo](#hosted-demo)), so it needs
no MongoDB. It is a public sandbox: the database may be reset without warning, so
please do not reuse a real password.

> **Origin.** This started as a follow-along build of the YOUNOTE tutorial, which
> is the honest description of the original codebase. Everything in
> [What I added](#what-i-added) and [Security fixes](#security-fixes) was written
> afterwards to turn a tutorial exercise into something that behaves like a real
> application.

## Features

- **Rich-text notes** — bold, italic, underline, code, quotes, headings and lists
  (Slate).
- **Video-anchored** — each note stores the YouTube link and the playback
  timestamp at save time.
- **Search** — across titles, note text and tags, debounced and server-side.
- **Tags** — normalised on write (lowercase, deduped, capped at 8) and filterable.
- **Pinning** — pinned notes always sort to the top of the list.
- **Sorting** — recently updated, recently created, oldest first, or A-Z.
- **JWT accounts** — bcrypt password hashing, 7-day tokens.

## What I added

| Area | Before | Now |
| --- | --- | --- |
| Tags | none | `tags: [String]` on the model, comma-separated input in the editor, normalised and capped at 8, filter dropdown on the list page |
| Pinning | none | `pinned` flag, `PATCH /api/notes/:id/pin`, star toggle per row, pinned-first sorting |
| Search | none | debounced `?q=` across title, flattened note text and tags |
| Sorting | fixed newest-first | `?sort=recent\|created\|oldest\|title` |
| Filtering | none | `?tag=` exact match against normalised tags |
| Searchable text | none | `plainText` projection computed from the Slate document on every write, so search is a field match instead of a JSON walk |
| List UI | table of #, title, modified | search box, tag filter, sort control, tags as chips, pin column, result count, error state, empty state |
| Delete | silently failed | works, confirms first, refreshes the list in place instead of reloading the page |
| List refresh | `window.location.reload()` after delete | `refetch()` from the fetch hook, so filters and scroll survive |
| Health check | none | `GET /health` outside the auth wall, reporting database state and uptime |
| Errors | mixed 200s and 500s, silent catches | consistent status codes and `{ msg }` bodies; a 404/500 handler on the app |
| Config | credentials in source | `.env` with `.env.example` template; the process refuses to start without a database URI and a JWT secret |

## Security fixes

These are the reason this section exists separately. Each was a real flaw in the
tutorial codebase:

1. **Live database credentials in source.** `server.js` contained a MongoDB Atlas
   connection string with the password in plain text, in a file intended for a
   public repository. It is now read from `MONGODB_URI`. **If you cloned or
   downloaded an earlier version, rotate that database password now** — removing
   it from the code does not remove it from git history or from anyone's copy.
2. **Authentication bypass on login.** The login handler responded with an error
   for a wrong password but did not `return`, so it fell through to `jwt.sign`
   and handed back a valid token anyway. Every failure path now returns
   immediately, and "no such user" and "wrong password" give the same response so
   the endpoint cannot be used to enumerate usernames.
3. **Hardcoded JWT secret.** Tokens were signed with the literal string
   `'secret'`, so anyone reading the repo could mint a token for any username.
   The secret now comes from `JWT_SECRET`, and both the middleware and the routes
   fail closed with a 500 if it is missing.
4. **Missing ownership checks (IDOR).** `PUT` and `DELETE` looked notes up by
   `_id` alone, so any signed-in user could edit or delete another user's note by
   guessing an id. Every query is now scoped to `{ _id, author }`, and ids are
   validated before they reach Mongo.
5. **Deletes never worked.** The row sent `header:` instead of `headers:`, so no
   auth token reached the server, and the success check compared against
   `'success'` while the API returned `'Message Deleted'`.
6. **Unhandled `JSON.parse`.** A non-string body threw and returned a 500. Bodies
   are now parsed defensively and fall back to an empty document.

## Architecture

```
client/                     React 16 + Material-UI 4 + Slate (Create React App)
  src/components/
    auth/                   AuthContext, login and signup form
    homepage/               note list: search, filter, sort, pin, delete
    note_app/               editor, video player, save pipeline
    util/APIFetch.js        fetch hook with url-change refetch, errors, refetch()
server/                     Express + Mongoose
  models/note.js            schema, tags, pinned, plainText, list index
  models/user.js            username + bcrypt hash
  routes/notes.js           list/search/create/read/update/pin/delete
  routes/auth.js            register + login
  middleware/auth.js        JWT verification, public-route allowlist
  server.js                 config, routes, health, error handling, shutdown
worker/                     Cloudflare Workers port of the API (the live demo)
  index.js                  routing, PBKDF2 + JWT auth, D1 queries, static assets
  wrangler.toml             local run: wrangler dev with a local D1 database
deploy/
  deploy.json               entrypoint and assets for the hosted deploy
  stage.sh                  build the client, then stage worker/ + public/
```

### API

All routes except register/login require an `x-auth-token` header.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth` | Register, returns `{ token, user }` |
| `POST` | `/api/auth/login` | Log in, returns `{ token, user }` |
| `GET` | `/api/notes` | List notes. Query: `q`, `tag`, `sort` |
| `GET` | `/api/notes/:id` | Read one note |
| `POST` | `/api/notes` | Create. Body: `title`, `body`, `videoLink`, `videoTimestamp`, `tags` |
| `PUT` | `/api/notes/:id` | Update |
| `PATCH` | `/api/notes/:id/pin` | Toggle pinned |
| `DELETE` | `/api/notes/:id` | Delete |
| `GET` | `/health` | Liveness + database state (no auth) |

`sort` accepts `recent` (default), `created`, `oldest` or `title`.

## Hosted demo

The live demo is the same client, published as static assets behind a Worker that
implements the HTTP contract above on Cloudflare D1. There is no Node process and
no MongoDB in that path.

What differs, and why:

| | `server/` (MongoDB) | `worker/` (D1) |
| --- | --- | --- |
| Storage | Mongo collections | `users` and `notes` tables, one row per note |
| Tags | array field | JSON column, matched with `json_each` |
| Search | `$regex` over three fields | `LIKE ... ESCAPE` over the same three fields |
| Passwords | bcrypt | PBKDF2-SHA256, 100k iterations, per-user salt |
| Signing key | `JWT_SECRET` from env | 32 random bytes generated once into the `settings` table |
| Accounts | unlimited | capped at 500, so a public demo cannot be farmed |

Both implementations scope every note query by the author taken from the verified
token, return the same `{ msg }` error bodies, and validate ownership on read,
update, pin and delete.

Run it locally (this uses a local D1 database, no Cloudflare account needed):

```bash
cd client && NODE_OPTIONS=--openssl-legacy-provider npm run build
cd ../worker && npx wrangler dev      # http://localhost:8787
```

Deploy:

```bash
deploy/stage.sh /tmp/notemaster-stage  # builds and stages worker/, public/, deploy.json
```

Then upload the staged directory with a Workers-compatible deployer that can bind
a D1 database named `DB` to the Worker. The schema is created by the Worker itself
on first request, so there is no migration step.

## Setup

### 1. Database

Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com), add a
database user, and allow your IP under Network Access.

### 2. API

```bash
cd server
npm install
cp .env.example .env      # then fill in MONGODB_URI and JWT_SECRET
npm start                 # http://localhost:8080
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Client

```bash
cd client
npm install --legacy-peer-deps
npm start                 # http://localhost:3000, proxied to :8080
```

`--legacy-peer-deps` is required because this is a React 16 / CRA 3 dependency
tree; it has not been migrated to React 18.

### Building on a modern Node

Create React App 3 predates Node 17's OpenSSL change, so a production build needs:

```bash
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

## Known limitations

- **React 16 / CRA 3 / Material-UI 4.** Kept as-is rather than half-migrated.
  Moving to React 18 + CRA 5 (or Vite) is the obvious next step and would remove
  the `--legacy-peer-deps` and `--openssl-legacy-provider` workarounds.
- **No automated tests.** The `App.test.js` from CRA is the default placeholder.
- **No pagination.** The list caps at 500 notes.
- **Tokens live in `localStorage`.** Simple, and vulnerable to XSS; httpOnly
  cookies are the correct fix.
- **Two API implementations.** `server/` is the reference; `worker/` exists so the
  project can be shown running without provisioning a database. They are kept in
  step by hand, and a shared contract test suite is the obvious missing piece.
- **Workers deploy is verified by request-level checks, not a test suite.** The
  deployed API was exercised end to end — auth, CRUD, search, tag filter, sorting,
  pinning, and cross-account isolation — but those checks are a script, not a
  committed suite.

## License

ISC, as inherited from the original project.
