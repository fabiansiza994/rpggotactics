# RPG-GO Tactics API — Cloudflare Worker

Cloud save for RPG-GO Tactics (Phase 2.5: profiles, collection, campaigns and verified Summoner skirmishes).

Production API: https://rpggo-tactics-api.fabiansiza994.workers.dev
Production client: https://rpggo-tactics.pages.dev
Migration 0003 is applied. See `qa/summoner-phase25/PRODUCTION.md` for the deployment checkpoint and remaining Turnstile hostname approval.

## How it fits the existing infrastructure

| Piece | What | Status |
|---|---|---|
| Accounts | RPG-GO auth Worker `dark-recipe-a184` (`/api/register`, `/api/login`, `/api/logout`) — username + password, opaque Bearer sessions, Turnstile on register, rate limits. | **Existing, reused unchanged.** Tactics accounts are RPG-GO accounts. |
| Database | D1 `rpggo-auth` (`1655f189-…`). | **Existing, reused.** This Worker only *reads* `users`/`sessions` and owns the new `tactics_*` tables. |
| Tactics API | This Worker, `rpggo-tactics-api`. | **Deployed** (this folder). |
| Client | `src/presentation/cloud/*`, enabled by `VITE_TACTICS_API_URL`. | Without that variable the game is local-only (guest), as before. |

Identity: the Worker resolves `Authorization: Bearer <token>` → `sessions.username` → `users.id`.
`users.id` (stable integer) owns every Tactics row; nothing is keyed by username, and no endpoint
accepts a user id from the client. RPG-GO's "delete account" (`DELETE FROM users`) cascades to all
`tactics_*` rows through `ON DELETE CASCADE` (D1 enforces foreign keys).

## Endpoints (all require a valid session)

| Method | Path | Does |
|---|---|---|
| GET | `/api/tactics/me` | Who am I (`id`, `username`, `hasProfile`). |
| GET | `/api/tactics/state` | Full player state: profile meta, collection + decks per champion, campaign run. |
| POST | `/api/tactics/profile` | Create a fresh starter profile (only if none exists). |
| POST | `/api/tactics/import` | One-time import of a device's local save (only if none exists); validated and sanitised. |
| PUT | `/api/tactics/champion` | Select champion. |
| PUT | `/api/tactics/decks/:championId/:deckId` | Replace a deck; validated against the **server** collection (ownership, champion, size, copy limits). |
| POST | `/api/tactics/campaign/start` | New campaign run (server-chosen seed). |
| POST | `/api/tactics/campaign/victory` | `{ proof: { encounterId, seed, commands } }` — the server **replays the battle** with the game engine and only records a real win. |
| POST | `/api/tactics/campaign/reward` | Take one of the offers the server generated; card grant + run update in one transaction. |
| POST | `/api/tactics/skirmish/start` | Summoner challenge with a server seed and frozen legal deck. |
| POST | `/api/tactics/skirmish/victory` | Verify commands against the frozen challenge; generate and persist its reward offer. |
| POST | `/api/tactics/skirmish/reward` | Transactional claim with a unique receipt; repeated claims cannot duplicate cards. |
| GET | `/api/tactics/wallet` | Cristales Arcanos balance + the last 20 ledger rows. Read-only. |
| GET | `/api/tactics/store/catalog` | Active offers with the caller's **server quote**. `price`/`contents` are what this player pays and gets: a partly-owned bundle drops the owned lines (`excluded`) and is prorated from `basePrice`. Also returns `availability`, categories, wallet, cosmetics. |
| POST | `/api/tactics/store/purchase` | `{ offerId, idempotencyKey }` only. The price is recomputed server-side. One D1 batch: receipt (snapshot of the final price and contents) + debit + grants + guard. Retries with the same key return the same purchase (`replayed: true`). |
| GET | `/api/tactics/store/purchases` | The caller's purchase history. |
| GET | `/api/tactics/cosmetics` | Owned cosmetics and the equipped one per slot (`PROFILE_FRAME`). |
| PUT | `/api/tactics/cosmetics/equip` | `{ slot, cosmeticId \| null }`. Only an owned cosmetic of that slot can be equipped (also enforced by a composite FK). The equipped frame is the only cosmetic data shown to a PvP opponent. |

### Social (friends, 1:1 chat, PvP invites) — `src/social.ts`

Other players are named by **username** only at this boundary and resolved to `users.id` server-side;
no endpoint takes or returns another player's id. Conversations are addressed by a random id and
every access checks membership. All of these need a session; only invites need a Tactics profile.

| Method | Path | Does |
|---|---|---|
| GET | `/api/tactics/social/overview` | Friends (presence ONLINE / IN_PVP / OFFLINE, unread, conversation id, public frame + champion), requests in/out, blocked, pending invites, badge counts. |
| GET | `/api/tactics/social/search?q=` | Tactics players by exact name (< 3 chars) or prefix (≥ 3), max 10, never self; `relation` from the caller's view only. Rate limited. |
| POST | `/api/tactics/social/requests` · `requests/accept` · `requests/reject` · `requests/cancel` · `friends/remove` · `block` · `unblock` | `{ username }`. Reciprocal requests become a friendship; block removes the friendship, cancels invites, and refuses requests/chat/invites (the blocked side gets a generic refusal). |
| GET | `/api/tactics/social/conversations/:id/messages?before=` | Newest 50 (paged), `canSend`. |
| POST | `/api/tactics/social/conversations/:id/messages` | `{ body }` plain text, 1–500 chars; needs an accepted friendship and no block. Rate limited. |
| POST | `/api/tactics/social/conversations/:id/read` | Marks the other player's messages read. |
| POST | `/api/tactics/social/invites` | `{ username, mode, mapId }` → 3-minute invite. Friends only, no duplicates, nobody busy in a match/full lobby. |
| POST | `/api/tactics/social/invites/:id/accept` · `reject` · `cancel` | Accept opens the ordinary private room through the normal PvP create/join flow and returns its `code`. |
| GET | `/api/tactics/social/match?code=` | The rival as a friend (same conversation) or `null`. |
| POST | `/api/tactics/social/report` | `{ username, reason, messageId? }` (SPAM, HARASSMENT, OFFENSIVE_CONTENT, OTHER). Stored only. |
| POST | `/api/tactics/social/connect` | One-use 30 s ticket for `wss://…/api/tactics/social/socket?hub=<own id>&ticket=` (the caller's own SocialHub Durable Object: pushes + presence heartbeat). |

Retention: newest 200 messages per conversation; social rows cascade on account deletion (reports
keep the reporter's evidence with the reported account set to NULL). Design and QA:
`../qa/social/REPORT.md`.

 cards only enter a collection through the starter set, a
verified campaign reward, the one-time import, or a store purchase paid from the server wallet.

There is no endpoint that grants or sets currency. Test currency for `tactics_qa_*` accounts is
granted by the operator only (needs the Cloudflare login), audited as `QA_GRANT`:

```bash
node scripts/qa-grant.mjs --user tactics_qa_a --amount 1000 --ref <unique-ref> --remote
```

Store economy design: `../qa/store-phase4a/REPORT.md`. Phase 4C (content, prorated bundles, frames,
payments boundary): `../qa/store-phase4c/REPORT.md`, `../qa/store-phase4c/PAYMENTS.md`. There is no
real-money endpoint; `src/payments.ts` is model-only and wired to no route.

## Updating production (requires Cloudflare login)

Audit any new migration before applying it. Apply schema changes before publishing the Worker: Phase 2.5 player-state queries depend on the skirmish tables. Keep the auth Worker unchanged.

```bash
cd server
npm install
npx wrangler login            # same account as dark-recipe-a184
npx wrangler whoami
npm run db:migrate:remote     # applies only pending audited migrations to the EXISTING rpggo-auth DB
npm run deploy                # publishes rpggo-tactics-api.<account>.workers.dev
curl https://rpggo-tactics-api.<account>.workers.dev/api/tactics/health
```

Then build the client with `VITE_TACTICS_API_URL=https://rpggo-tactics-api.<account>.workers.dev`
(and optionally `VITE_AUTH_API_URL` if the auth Worker URL differs from the default).

The repository's `.env.production` already contains the production API URLs and the public Turnstile site key. From the repository root, deploy the **existing Pages project** with:

```bash
npm run build
server/node_modules/.bin/wrangler pages deploy dist --project-name rpggo-tactics --branch main --commit-dirty=true
```

Use `wrangler.pages.toml` for the client and `server/wrangler.toml` for the API; do not accidentally publish the API bundle under the client name. The Pages origin is allowed by Tactics CORS. The shared Turnstile widget still allows only localhost until its hostname update is explicitly approved; existing-account login is functional.

Notes:
- `wrangler d1 migrations apply` also creates its bookkeeping table `d1_migrations` in `rpggo-auth`.
- Authentication keeps its own `TURNSTILE_SECRET` in the separate auth Worker. The Tactics Worker additionally requires the existing ePayco secrets for sandbox checkout, and `PUBLIC_SUPPORT_TURNSTILE_SECRET` for public support. Do not copy or print secret values. Public support remains disabled until that configuration and its operational response channel are verified. See `../docs/legal-commerce/TECHNICAL-CHECKPOINT.md`.
- **Turnstile:** register uses RPG-GO's public site key. Its allowed hostnames must include the
  Tactics origin(s) (e.g. `localhost` for the Capacitor app, and any web domain) — check in the
  Cloudflare dashboard → Turnstile. Login does not need Turnstile.
- **CPU:** a victory replay costs ~2–10 ms of CPU in Node for the current campaign. The Workers
  free plan allows 10 ms per request; the paid plan has ample headroom. Watch for error 1102.

## Local stack (no Cloudflare account needed)

```bash
cd server && npm install
npx wrangler d1 execute rpggo-auth --local --persist-to .wrangler/state --file ../../RPG-GO/worker-auth/schema.sql
npx wrangler d1 migrations apply rpggo-auth --local --persist-to .wrangler/state
npx wrangler dev --port 8788 --persist-to .wrangler/state
# RPG-GO auth Worker on the same local DB, with Cloudflare's always-pass Turnstile TEST secret:
npx wrangler dev -c ../../RPG-GO/worker-auth/wrangler.toml --port 8787 --inspector-port 9231 \
  --persist-to .wrangler/state --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA
```

Client: create `.env.cloudlocal.local` (gitignored) with
`VITE_AUTH_API_URL=http://127.0.0.1:8787`, `VITE_TACTICS_API_URL=http://127.0.0.1:8788`,
`VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (public test key), then
`npx vite --mode cloudlocal`.

Tests: `tests/server.test.ts` runs this Worker's handler against the real migration on
`node:sqlite`; `tests/cloud.test.ts` drives the app store against it end to end.
