# frontend

New frontend for `server`, built with Vite + React 19 + Tailwind 4.

## Goals

- Use web session `username + password + JWT`
- Call the entire new backend API except the rotate/generate API key routes
- Provide a shared admin and operations shell for:
  - overview + account
  - emails + inbox + batch fetch
  - groups
  - domains + nested permissions
  - users
  - global permissions
  - admins
  - maintenance

## Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`

From the repo root:

- `npm run frontend:dev`
- `npm run frontend:build`
- `npm run frontend:lint`

## Env

- `VITE_API_BASE_URL`

If `VITE_API_BASE_URL` is not set, the frontend calls the relative paths `/health` and `/v1/*`.
In dev mode, `vite.config.js` already proxies them to `http://127.0.0.1:3001`.

## Notes

- This frontend does not use cookie auth.
- The session token is kept in `localStorage`.
- `sessionExpiresAt` is decoded directly from the JWT so it is not lost on reload.
- Group fetch handles the case where the backend returns `409` when auto-pruning a denied/missing email ID.
