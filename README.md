# AK — Forever Love

A private, two-user romantic memory journal built with React + Vite + Tailwind CSS, Node.js + Express, PostgreSQL, JWT, bcrypt, Multer, and the browser MediaRecorder API.

## Features

- Exactly two seeded users; there is no public registration.
- JWT login with bcrypt password hashing.
- Every memory has a separate bcrypt-hashed note password.
- Password gate before opening or editing a protected memory.
- Rich-text memory editor.
- Multiple photo/video uploads.
- Browser-recorded voice notes and uploaded audio.
- Reactions, comments, search, and grouped gallery.
- Timeline and relationship-day counter.
- Responsive cinematic dark-romantic UI.
- File validation and protected media serving.
- Automatic footer on every memory page: `Only for AK … Forever Love 🖤`

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Setup

### 1. Database

Create a PostgreSQL database:

```sql
CREATE DATABASE ak_forever_love;
```

Then run:

```bash
psql -d ak_forever_love -f server/schema.sql
```

The server creates the two private users with bcrypt on first startup. Change the demo passwords in `server/src/index.js` before production use.

### 2. Server

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:5000`.

### 3. Client

```bash
cd client
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

The Vite development server proxies `/api` and `/uploads` to Express.

## Environment

Server `.env`:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ak_forever_love
JWT_SECRET=replace-with-a-long-random-secret
CLIENT_ORIGIN=http://localhost:5173
UPLOAD_DIR=./uploads
```

Client can optionally use:

```env
VITE_API_URL=
```

Leave it empty in development so Vite's proxy handles API requests.

## Production

Build the client:

```bash
cd client
npm run build
```

Serve the resulting `client/dist` from your preferred static host and point API requests to the Express server. Keep PostgreSQL private, use HTTPS, a strong JWT secret, and a reverse proxy in front of Express.

## Security notes

- Authentication uses short-lived JWT access tokens stored in `localStorage` for this standalone demo architecture. For a hardened deployment, move the access token to an HttpOnly Secure SameSite cookie.
- Passwords and note passwords are bcrypt hashes.
- Memory passwords are never returned by the API.
- Every protected memory operation verifies the memory password.
- Uploads are size-limited and validated by MIME type/extension.
- Authorization middleware requires a valid JWT.
- Only authenticated users can access uploads.
- The app intentionally has no registration endpoint.

## Voice notes

On supported browsers, the memory composer uses `MediaRecorder`. The recording is converted to a Blob and uploaded with the memory form.

## Default seeded accounts

For a local demo, the SQL file seeds:

- `ak`
- `forever`

The sample hashes correspond to passwords documented in the SQL comments. **Change them before any real deployment.**
