import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handle } from '../server/src/index';
import { PvPMatchRoom } from '../server/src/pvp';
import { SOCIAL_LIMITS, SocialHub, cleanMessage } from '../server/src/social';
import type { Env } from '../server/src/db';
import { DEFAULT_CONTENT } from '../src/game';
import { addAccount, memoryD1 } from './support/d1';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: ReturnType<typeof memoryD1>;
let clock: number;
let pushes: { user: string; body: Json }[];
let roomFetches: number;
let rooms: Map<string, { fetch(r: Request): Promise<Response> }>;
let env: Env;
const deps = { content: DEFAULT_CONTENT, now: () => clock, seed: () => 7 };

function migrate(file: string) {
  db.sql.exec(readFileSync(new URL(`../server/migrations/${file}`, import.meta.url), 'utf8'));
}

/** The real PvP Durable Object behind a fake namespace (one instance per room code). */
function pvpNamespace() {
  rooms = new Map();
  return {
    idFromName: (name: string) => name,
    get: (name: unknown) => {
      const key = String(name);
      if (!rooms.has(key)) {
        const data = new Map<string, unknown>();
        let init: Promise<unknown> = Promise.resolve();
        const ctx = {
          storage: {
            get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
            const p = fn();
            init = p;
            return p;
          },
          acceptWebSocket: () => {},
          getWebSockets: () => [],
        };
        const room = new PvPMatchRoom(
          ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
          { DB: db },
        );
        rooms.set(key, {
          fetch: async (r: Request) => {
            roomFetches++;
            await init;
            return room.fetch(r);
          },
        });
      }
      return rooms.get(key)!;
    },
  };
}

/** Records every push; answers /ticket like the hub does. */
const hubNamespace = () => ({
  idFromName: (name: string) => name,
  get: (name: unknown) => ({
    fetch: async (r: Request) => {
      if (new URL(r.url).pathname === '/ticket')
        return new Response(JSON.stringify({ ticket: 'ticket-1' }));
      pushes.push({ user: String(name), body: JSON.parse(await r.text()) });
      return new Response('{}');
    },
  }),
});

async function call(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(
    new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    deps,
  );
  return { status: res.status, body: (await res.json()) as Json };
}

/** An account that plays Tactics (has a profile). */
async function player(name: string) {
  const account = addAccount(db, name);
  expect((await call(account.token, 'POST', '/profile', {})).status).toBe(200);
  return { ...account, name };
}

async function befriend(a: { token: string; name: string }, b: { token: string; name: string }) {
  expect((await call(a.token, 'POST', '/social/requests', { username: b.name })).status).toBe(200);
  const accepted = await call(b.token, 'POST', '/social/requests/accept', { username: a.name });
  expect(accepted.status).toBe(200);
  return accepted.body.friends.find((f: Json) => f.username === a.name).conversationId as string;
}

const send = (token: string, conversationId: string, body: unknown) =>
  call(token, 'POST', `/social/conversations/${conversationId}/messages`, { body });
const pushesTo = (id: number) => pushes.filter((p) => p.user === 'user:' + id).map((p) => p.body);

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  for (const f of [
    '0004_pvp.sql',
    '0005_pvp_dominion.sql',
    '0006_pvp_maps.sql',
    '0009_tactics_social.sql',
    '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql',
  ])
    migrate(f);
  clock = Date.now();
  pushes = [];
  roomFetches = 0;
  env = { DB: db, PVP_ROOMS: pvpNamespace(), SOCIAL_HUBS: hubNamespace() };
  SOCIAL_LIMITS.messagesPerConversation = 200;
});

describe('search', () => {
  it('finds Tactics players by exact name or prefix, limited, without ids or private data', async () => {
    const ana = await player('ana');
    await player('bruno');
    await player('bruna');
    addAccount(db, 'brunilda'); // RPG-GO account that never played Tactics: not searchable
    for (let i = 0; i < 14; i++) await player(`bru_${i}`);
    const prefix = await call(ana.token, 'GET', '/social/search?q=BRU');
    expect(prefix.status).toBe(200);
    expect(prefix.body.results).toHaveLength(SOCIAL_LIMITS.searchResults);
    expect(prefix.body.results.map((r: Json) => r.username)).not.toContain('brunilda');
    for (const r of prefix.body.results)
      expect(Object.keys(r).sort()).toEqual(['avatarId', 'frameId', 'heroId', 'relation', 'titleId', 'username']);
    // Short queries are exact only (no 1–2 letter enumeration); self never appears.
    expect((await call(ana.token, 'GET', '/social/search?q=br')).body.results).toEqual([]);
    expect((await call(ana.token, 'GET', '/social/search?q=ana')).body.results).toEqual([]);
    // LIKE wildcards are escaped.
    expect((await call(ana.token, 'GET', '/social/search?q=%25%25%25')).body.results).toEqual([]);
    expect(
      (await call(ana.token, 'GET', '/social/search?q=bru_')).body.results.every((r: Json) =>
        r.username.startsWith('bru_'),
      ),
    ).toBe(true);
    expect((await call(null, 'GET', '/social/search?q=bruno')).status).toBe(401);
  });

  it('is rate limited', async () => {
    const ana = await player('ana');
    for (let i = 0; i < 20; i++)
      expect((await call(ana.token, 'GET', '/social/search?q=zzz')).status).toBe(200);
    expect((await call(ana.token, 'GET', '/social/search?q=zzz')).status).toBe(429);
    clock += 61_000;
    expect((await call(ana.token, 'GET', '/social/search?q=zzz')).status).toBe(200);
  });
});

describe('friend requests', () => {
  it('send → accept creates one friendship and one conversation; both sides notified', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const sent = await call(ana.token, 'POST', '/social/requests', { username: 'Bruno' });
    expect(sent.body.outgoing.map((o: Json) => o.username)).toEqual(['bruno']);
    expect(pushesTo(bruno.id)).toEqual([
      { type: 'social', event: 'FRIEND_REQUEST', username: 'ana' },
    ]);
    const inbox = await call(bruno.token, 'GET', '/social/overview');
    expect(inbox.body.incoming.map((o: Json) => o.username)).toEqual(['ana']);
    expect(inbox.body.counts.requests).toBe(1);
    expect((await call(bruno.token, 'GET', '/social/search?q=ana')).body.results[0].relation).toBe(
      'INCOMING',
    );
    const accepted = await call(bruno.token, 'POST', '/social/requests/accept', {
      username: 'ana',
    });
    expect(accepted.body.friends).toMatchObject([
      { username: 'ana', heroId: 'mage', presence: 'OFFLINE', unread: 0 },
    ]);
    expect(pushesTo(ana.id).at(-1)).toMatchObject({ event: 'FRIEND_ACCEPTED', username: 'bruno' });
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_conversations').get()).toEqual({
      n: 1,
    });
    expect(
      db.sql.prepare('SELECT user_low, user_high, status FROM tactics_social_relationships').all(),
    ).toEqual([{ user_low: ana.id, user_high: bruno.id, status: 'ACCEPTED' }]);
  });

  it('rejects self, duplicates, unknown players and already-friends', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    expect((await call(ana.token, 'POST', '/social/requests', { username: 'ana' })).status).toBe(
      422,
    );
    expect((await call(ana.token, 'POST', '/social/requests', { username: 'nadie' })).status).toBe(
      404,
    );
    expect((await call(ana.token, 'POST', '/social/requests', {})).status).toBe(400);
    await call(ana.token, 'POST', '/social/requests', { username: 'bruno' });
    const dup = await call(ana.token, 'POST', '/social/requests', { username: 'bruno' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_REQUEST']);
    await call(bruno.token, 'POST', '/social/requests/accept', { username: 'ana' });
    expect(
      (await call(ana.token, 'POST', '/social/requests', { username: 'bruno' })).body.error.code,
    ).toBe('ALREADY_FRIENDS');
    expect(
      (await call(ana.token, 'POST', '/social/requests/accept', { username: 'bruno' })).status,
    ).toBe(404);
  });

  it('a reciprocal request resolves into a friendship', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    await call(ana.token, 'POST', '/social/requests', { username: 'bruno' });
    const back = await call(bruno.token, 'POST', '/social/requests', { username: 'ana' });
    expect(back.status).toBe(200);
    expect(back.body.friends.map((f: Json) => f.username)).toEqual(['ana']);
    expect(back.body.incoming).toEqual([]);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_social_relationships').get()).toEqual({
      n: 1,
    });
  });

  it('reject and cancel remove the pending request; only the right side can do each', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    await call(ana.token, 'POST', '/social/requests', { username: 'bruno' });
    expect(
      (await call(ana.token, 'POST', '/social/requests/reject', { username: 'bruno' })).status,
    ).toBe(404);
    expect(
      (await call(bruno.token, 'POST', '/social/requests/cancel', { username: 'ana' })).status,
    ).toBe(404);
    expect(
      (await call(bruno.token, 'POST', '/social/requests/reject', { username: 'ana' })).body
        .incoming,
    ).toEqual([]);
    expect((await call(ana.token, 'GET', '/social/overview')).body.outgoing).toEqual([]);
    await call(ana.token, 'POST', '/social/requests', { username: 'bruno' });
    expect(
      (await call(ana.token, 'POST', '/social/requests/cancel', { username: 'bruno' })).body
        .outgoing,
    ).toEqual([]);
    expect((await call(bruno.token, 'GET', '/social/overview')).body.incoming).toEqual([]);
  });

  it('remove ends the friendship but keeps history; re-friending reuses the same conversation', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    await send(ana.token, conv, 'hola');
    const removed = await call(bruno.token, 'POST', '/social/friends/remove', { username: 'ana' });
    expect(removed.body.friends).toEqual([]);
    expect((await send(ana.token, conv, 'sigues ahí?')).status).toBe(403);
    const history = await call(ana.token, 'GET', `/social/conversations/${conv}/messages`);
    expect(history.body.canSend).toBe(false);
    expect(history.body.messages.map((m: Json) => m.body)).toEqual(['hola']);
    expect(await befriend(ana, bruno)).toBe(conv);
    expect((await send(ana.token, conv, 'de vuelta')).status).toBe(200);
  });

  it('is rate limited', async () => {
    const ana = await player('ana');
    for (let i = 0; i < 20; i++) await player(`p${i}x`);
    for (let i = 0; i < 20; i++)
      expect(
        (await call(ana.token, 'POST', '/social/requests', { username: `p${i}x` })).status,
      ).toBe(200);
    await player('extra');
    expect((await call(ana.token, 'POST', '/social/requests', { username: 'extra' })).status).toBe(
      429,
    );
  });
});

describe('blocking', () => {
  it('removes the friendship and blocks requests, chat and invites; the blocked side gets no reason', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    await call(ana.token, 'POST', '/social/invites', {
      username: 'bruno',
      mode: 'DUEL',
      mapId: 'classic',
    });
    const blocked = await call(ana.token, 'POST', '/social/block', { username: 'bruno' });
    expect(blocked.body.friends).toEqual([]);
    expect(blocked.body.blocked).toEqual(['bruno']);
    expect(blocked.body.invites.outgoing).toEqual([]);
    expect(pushesTo(bruno.id).at(-1)).toEqual({ type: 'social', event: 'FRIENDS_CHANGED' });
    // Bruno (blocked): generic refusals only.
    const req = await call(bruno.token, 'POST', '/social/requests', { username: 'ana' });
    expect([req.status, req.body.error.code]).toEqual([403, 'NOT_ALLOWED']);
    expect(JSON.stringify(req.body)).not.toMatch(/bloque/i);
    expect((await send(bruno.token, conv, 'hey')).status).toBe(403);
    expect((await call(bruno.token, 'POST', '/social/invites', { username: 'ana' })).status).toBe(
      403,
    );
    expect((await call(bruno.token, 'GET', '/social/search?q=ana')).body.results[0].relation).toBe(
      'NONE',
    );
    // Ana (blocker) is told why, and must unblock first.
    expect(
      (await call(ana.token, 'POST', '/social/requests', { username: 'bruno' })).body.error.code,
    ).toBe('YOU_BLOCKED');
    expect((await call(ana.token, 'GET', '/social/search?q=bruno')).body.results[0].relation).toBe(
      'BLOCKED',
    );
    // Unblock does not restore the friendship.
    const unblocked = await call(ana.token, 'POST', '/social/unblock', { username: 'bruno' });
    expect(unblocked.body.blocked).toEqual([]);
    expect(unblocked.body.friends).toEqual([]);
    expect((await send(ana.token, conv, 'hola')).status).toBe(403);
  });

  it('a block by the other side also stops chat (friendship row forged back is not enough)', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    db.sql.prepare('INSERT INTO tactics_social_blocks VALUES (?, ?, 0)').run(bruno.id, ana.id);
    expect((await send(ana.token, conv, 'hola')).status).toBe(403);
  });
});

describe('chat', () => {
  it('friends exchange messages that persist, count as unread and are marked read on open', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    const sent = await send(ana.token, conv, '  hola <b>bruno</b>  ');
    expect(sent.status).toBe(200);
    expect(sent.body.message).toMatchObject({
      body: 'hola <b>bruno</b>',
      mine: true,
      readAt: null,
    });
    // Delivered in real time to Bruno's hub (and Ana's other tabs).
    expect(pushesTo(bruno.id).at(-1)).toMatchObject({
      event: 'MESSAGE',
      conversationId: conv,
      from: 'ana',
      message: { mine: false },
    });
    expect(pushesTo(ana.id).at(-1)).toMatchObject({ event: 'MESSAGE', message: { mine: true } });
    await send(ana.token, conv, 'segunda');
    const overview = await call(bruno.token, 'GET', '/social/overview');
    expect(overview.body.counts.unread).toBe(2);
    expect(overview.body.friends[0].unread).toBe(2);
    // Offline delivery: a new session (logout/login, reload) sees the same history.
    db.sql
      .prepare("INSERT INTO sessions VALUES ('token-bruno-2', 'bruno', 0, 4000000000000)")
      .run();
    const later = await call('token-bruno-2', 'GET', `/social/conversations/${conv}/messages`);
    expect(later.body.messages.map((m: Json) => [m.body, m.mine])).toEqual([
      ['hola <b>bruno</b>', false],
      ['segunda', false],
    ]);
    expect(later.body.with).toBe('ana');
    expect(later.body.canSend).toBe(true);
    await call('token-bruno-2', 'POST', `/social/conversations/${conv}/read`, {});
    expect((await call(bruno.token, 'GET', '/social/overview')).body.counts.unread).toBe(0);
    // Ana's own messages never count as her unread.
    expect((await call(ana.token, 'GET', '/social/overview')).body.counts.unread).toBe(0);
    const anaView = await call(ana.token, 'GET', `/social/conversations/${conv}/messages`);
    expect(anaView.body.messages.every((m: Json) => m.mine && m.readAt === clock)).toBe(true);
  });

  it('validates length and content; plain text is stored as typed (escaped on render)', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    expect((await send(ana.token, conv, '   ')).status).toBe(422);
    expect((await send(ana.token, conv, 'x'.repeat(501))).status).toBe(422);
    expect((await send(ana.token, conv, 42)).status).toBe(422);
    expect((await send(ana.token, conv, 'x'.repeat(500))).status).toBe(200);
    expect(
      cleanMessage('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0x202e) + '\n\n\n\nc'),
    ).toBe('ab\n\nc');
    // Oversized payloads are refused before parsing.
    expect(
      (
        await call(ana.token, 'POST', `/social/conversations/${conv}/messages`, {
          body: 'x'.repeat(5000),
        })
      ).status,
    ).toBe(400);
  });

  it('non-friends cannot message; forged sender ids are ignored', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const carla = await player('carla');
    const conv = await befriend(ana, bruno);
    expect((await send(carla.token, conv, 'hola')).status).toBe(404);
    const forged = await call(bruno.token, 'POST', `/social/conversations/${conv}/messages`, {
      body: 'soy ana',
      senderUserId: ana.id,
      sender_user_id: ana.id,
    });
    expect(forged.status).toBe(200);
    expect(db.sql.prepare('SELECT sender_user_id FROM tactics_messages').all()).toEqual([
      { sender_user_id: bruno.id },
    ]);
  });

  it("cannot read or enumerate another pair's conversation", async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const carla = await player('carla');
    const conv = await befriend(ana, bruno);
    await send(ana.token, conv, 'secreto');
    expect((await call(carla.token, 'GET', `/social/conversations/${conv}/messages`)).status).toBe(
      404,
    );
    expect((await call(carla.token, 'POST', `/social/conversations/${conv}/read`, {})).status).toBe(
      404,
    );
    expect(
      (await call(carla.token, 'GET', `/social/conversations/${crypto.randomUUID()}/messages`))
        .status,
    ).toBe(404);
    expect((await call(carla.token, 'GET', '/social/conversations/1/messages')).status).toBe(404);
    expect((await call(carla.token, 'GET', '/social/conversations')).status).toBe(404);
    expect(JSON.stringify((await call(carla.token, 'GET', '/social/overview')).body)).not.toContain(
      conv,
    );
  });

  it('is rate limited (burst and per minute)', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    for (let i = 0; i < 5; i++) expect((await send(ana.token, conv, `m${i}`)).status).toBe(200);
    expect((await send(ana.token, conv, 'spam')).status).toBe(429);
    clock += 5_001;
    expect((await send(ana.token, conv, 'ok')).status).toBe(200);
  });

  it('keeps only the newest N messages per conversation (retention)', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    SOCIAL_LIMITS.messagesPerConversation = 3;
    for (let i = 1; i <= 5; i++) {
      clock += 2_000;
      await send(i % 2 ? ana.token : bruno.token, conv, `m${i}`);
    }
    const page = await call(ana.token, 'GET', `/social/conversations/${conv}/messages`);
    expect(page.body.messages.map((m: Json) => m.body)).toEqual(['m3', 'm4', 'm5']);
  });
});

describe('PvP invites', () => {
  async function friends() {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    return { ana, bruno, conv };
  }
  const invite = (token: string, username: string, extra: Json = {}) =>
    call(token, 'POST', '/social/invites', {
      username,
      mode: 'DOMINION',
      mapId: 'classic',
      ...extra,
    });

  it('invite → accept opens one private room with both players through the normal PvP flow', async () => {
    const { ana, bruno, conv } = await friends();
    const sent = await invite(ana.token, 'bruno');
    expect(sent.status).toBe(200);
    expect(sent.body.invite).toMatchObject({
      from: 'ana',
      to: 'bruno',
      mode: 'DOMINION',
      mapId: 'classic',
      status: 'PENDING',
    });
    expect(sent.body.invite.expiresAt - clock).toBe(SOCIAL_LIMITS.inviteTtlMs);
    expect(pushesTo(bruno.id).at(-1)).toMatchObject({ event: 'INVITE', invite: { from: 'ana' } });
    const inbox = await call(bruno.token, 'GET', '/social/overview');
    expect(inbox.body.counts.invites).toBe(1);
    const accepted = await call(
      bruno.token,
      'POST',
      `/social/invites/${sent.body.invite.inviteId}/accept`,
      {},
    );
    expect(accepted.status).toBe(200);
    const code = accepted.body.code as string;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(pushesTo(ana.id).at(-1)).toMatchObject({
      event: 'INVITE_UPDATE',
      invite: { status: 'ACCEPTED', code },
    });
    expect(
      db.sql.prepare('SELECT player_a, player_b FROM tactics_pvp_rooms WHERE code = ?').get(code),
    ).toEqual({ player_a: ana.id, player_b: bruno.id });
    for (const p of [ana, bruno])
      expect((await call(p.token, 'GET', '/pvp/active')).body.code).toBe(code);
    // The room carries the invite's mode/map and each player's server-owned champion.
    const view = await call(ana.token, 'POST', '/pvp/connect', { code });
    expect(view.status).toBe(200);
    const roomState = await call(bruno.token, 'POST', '/pvp/loadout', { code, heroId: 'summoner' });
    expect(roomState.body).toMatchObject({
      mode: 'DOMINION',
      mapId: 'classic',
      members: [
        { name: 'ana', heroId: 'mage' },
        { name: 'bruno', heroId: 'summoner' },
      ],
    });
    // A retried accept returns the same room (no second room).
    expect(
      (await call(bruno.token, 'POST', `/social/invites/${sent.body.invite.inviteId}/accept`, {}))
        .body.code,
    ).toBe(code);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_pvp_rooms').get()).toEqual({ n: 1 });
    // In-match chat resolves to the SAME friend conversation.
    const match = await call(ana.token, 'GET', `/social/match?code=${code}`);
    expect(match.body.friend).toMatchObject({ username: 'bruno', conversationId: conv });
  });

  it('reject: the inviter is told cleanly; the invite cannot be accepted afterwards', async () => {
    const { ana, bruno } = await friends();
    const { inviteId } = (await invite(ana.token, 'bruno')).body.invite;
    const rejected = await call(bruno.token, 'POST', `/social/invites/${inviteId}/reject`, {});
    expect(rejected.body.invite.status).toBe('REJECTED');
    expect(pushesTo(ana.id).at(-1)).toMatchObject({
      event: 'INVITE_UPDATE',
      invite: { status: 'REJECTED' },
    });
    expect((await call(bruno.token, 'POST', `/social/invites/${inviteId}/accept`, {})).status).toBe(
      409,
    );
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_pvp_rooms').get()).toEqual({ n: 0 });
  });

  it('expires after the TTL; an expired invite cannot be accepted', async () => {
    const { ana, bruno } = await friends();
    const { inviteId } = (await invite(ana.token, 'bruno')).body.invite;
    clock += SOCIAL_LIMITS.inviteTtlMs + 1;
    const late = await call(bruno.token, 'POST', `/social/invites/${inviteId}/accept`, {});
    expect([late.status, late.body.error.code]).toEqual([410, 'INVITE_EXPIRED']);
    expect((await call(bruno.token, 'GET', '/social/overview')).body.invites.incoming).toEqual([]);
    expect(db.sql.prepare('SELECT status FROM tactics_pvp_invites').get()).toEqual({
      status: 'EXPIRED',
    });
    // A new invite is allowed once the old one expired.
    expect((await invite(ana.token, 'bruno')).status).toBe(200);
  });

  it('refuses duplicates, reciprocal pending, non-friends, blocked players and bad modes', async () => {
    const { ana, bruno } = await friends();
    const carla = await player('carla');
    expect((await invite(ana.token, 'bruno')).status).toBe(200);
    expect((await invite(ana.token, 'bruno')).body.error.code).toBe('DUPLICATE_INVITE');
    expect((await invite(bruno.token, 'ana')).body.error.code).toBe('INVITE_FROM_TARGET');
    expect((await invite(carla.token, 'ana')).status).toBe(403);
    expect((await invite(ana.token, 'carla')).status).toBe(403);
    expect((await invite(ana.token, 'ana')).status).toBe(403);
    expect((await invite(ana.token, 'bruno', { mode: 'RANKED' })).status).toBe(400);
    expect((await invite(ana.token, 'bruno', { mapId: 'nowhere' })).status).toBe(400);
    await call(bruno.token, 'POST', '/social/block', { username: 'ana' });
    expect((await invite(ana.token, 'bruno')).status).toBe(403);
  });

  it('forged invites: only the addressee accepts/rejects, only the sender cancels', async () => {
    const { ana, bruno } = await friends();
    const carla = await player('carla');
    const { inviteId } = (await invite(ana.token, 'bruno')).body.invite;
    expect((await call(carla.token, 'POST', `/social/invites/${inviteId}/accept`, {})).status).toBe(
      404,
    );
    expect((await call(ana.token, 'POST', `/social/invites/${inviteId}/accept`, {})).status).toBe(
      404,
    );
    expect((await call(bruno.token, 'POST', `/social/invites/${inviteId}/cancel`, {})).status).toBe(
      404,
    );
    expect(
      (await call(bruno.token, 'POST', `/social/invites/${crypto.randomUUID()}/accept`, {})).status,
    ).toBe(404);
    expect(
      (await call(ana.token, 'POST', `/social/invites/${inviteId}/cancel`, {})).body.invite.status,
    ).toBe('CANCELLED');
    expect(pushesTo(bruno.id).at(-1)).toMatchObject({
      event: 'INVITE_UPDATE',
      invite: { status: 'CANCELLED' },
    });
    expect((await call(bruno.token, 'POST', `/social/invites/${inviteId}/accept`, {})).status).toBe(
      409,
    );
  });

  it('busy players: no invite or accept that would overlap an active match or full lobby', async () => {
    const { ana, bruno } = await friends();
    const carla = await player('carla');
    await befriend(ana, carla);
    const first = (await invite(ana.token, 'bruno')).body.invite;
    const pendingToCarla = (await invite(carla.token, 'ana')).body.invite;
    const { code } = (
      await call(bruno.token, 'POST', `/social/invites/${first.inviteId}/accept`, {})
    ).body;
    // Ana and Bruno now share a lobby: Carla cannot pull Ana in, and Ana cannot accept Carla's.
    expect((await invite(carla.token, 'ana')).body.error.code).toBe('DUPLICATE_INVITE');
    expect(
      (await call(ana.token, 'POST', `/social/invites/${pendingToCarla.inviteId}/accept`, {})).body
        .error.code,
    ).toBe('YOU_ARE_BUSY');
    db.sql
      .prepare("UPDATE tactics_pvp_invites SET status = 'CANCELLED' WHERE invite_id = ?")
      .run(pendingToCarla.inviteId);
    expect((await invite(carla.token, 'ana')).body.error.code).toBe('TARGET_BUSY');
    expect((await invite(ana.token, 'carla')).body.error.code).toBe('YOU_ARE_BUSY');
    // A started match shows as IN_PVP to friends.
    db.sql.prepare('UPDATE tactics_pvp_rooms SET started_at = ? WHERE code = ?').run(clock, code);
    expect(
      (await call(carla.token, 'GET', '/social/overview')).body.friends.find(
        (f: Json) => f.username === 'ana',
      ).presence,
    ).toBe('IN_PVP');
    // Once it finishes, Ana is free again.
    db.sql.prepare('UPDATE tactics_pvp_rooms SET finished_at = ? WHERE code = ?').run(clock, code);
    expect((await invite(carla.token, 'ana')).status).toBe(200);
  });

  it('is rate limited', async () => {
    const { ana } = await friends();
    for (let i = 0; i < 6; i++) {
      const res = await invite(ana.token, 'bruno');
      expect(res.status).toBe(200);
      await call(ana.token, 'POST', `/social/invites/${res.body.invite.inviteId}/cancel`, {});
    }
    expect((await invite(ana.token, 'bruno')).status).toBe(429);
  });
});

describe('in-match chat isolation', () => {
  it('match chat only for friend rivals; sending never touches the PvP room', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const carla = await player('carla');
    const conv = await befriend(ana, bruno);
    const { inviteId } = (await call(ana.token, 'POST', '/social/invites', { username: 'bruno' }))
      .body.invite;
    const { code } = (await call(bruno.token, 'POST', `/social/invites/${inviteId}/accept`, {}))
      .body;
    expect((await call(carla.token, 'GET', `/social/match?code=${code}`)).status).toBe(404);
    const before = await call(ana.token, 'POST', '/pvp/loadout', { code, heroId: 'mage' });
    const fetches = roomFetches;
    expect((await send(bruno.token, conv, 'gg')).status).toBe(200);
    expect(
      (await call(ana.token, 'GET', `/social/match?code=${code}`)).body.friend.conversationId,
    ).toBe(conv);
    expect(roomFetches).toBe(fetches); // chat and match lookups never reach the room
    const after = await call(ana.token, 'POST', '/pvp/loadout', { code, heroId: 'mage' });
    expect(after.body.version).toBe(before.body.version + 1); // only the loadout call itself
    // Unfriending mid-match disables chat; the room is untouched.
    await call(ana.token, 'POST', '/social/friends/remove', { username: 'bruno' });
    expect((await call(ana.token, 'GET', `/social/match?code=${code}`)).body.friend).toBeNull();
    expect((await send(bruno.token, conv, 'hey')).status).toBe(403);
    expect((await call(ana.token, 'GET', '/pvp/active')).body.code).toBe(code);
  });

  it('a private room with a non-friend has no friend chat', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const created = await call(ana.token, 'POST', '/pvp/create', { heroId: 'mage' });
    await call(bruno.token, 'POST', '/pvp/join', { code: created.body.code, heroId: 'mage' });
    expect((await call(ana.token, 'GET', `/social/match?code=${created.body.code}`)).body).toEqual({
      friend: null,
    });
  });
});

describe('reports', () => {
  it('stores reporter, target, optional message snapshot and reason; nothing automatic', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    const msg = (await send(bruno.token, conv, 'mensaje feo')).body.message;
    expect(
      (
        await call(ana.token, 'POST', '/social/report', {
          username: 'bruno',
          reason: 'HARASSMENT',
          messageId: msg.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(ana.token, 'POST', '/social/report', { username: 'bruno', reason: 'SPAM' }))
        .status,
    ).toBe(200);
    expect(
      (await call(ana.token, 'POST', '/social/report', { username: 'bruno', reason: 'BAN_HIM' }))
        .status,
    ).toBe(400);
    // Only the target's message in the caller's own conversation.
    const own = (await send(ana.token, conv, 'mío')).body.message;
    expect(
      (
        await call(ana.token, 'POST', '/social/report', {
          username: 'bruno',
          reason: 'SPAM',
          messageId: own.id,
        })
      ).status,
    ).toBe(404);
    expect(
      db.sql
        .prepare(
          'SELECT reporter_id, target_user_id, message_body, reason FROM tactics_social_reports ORDER BY created_at, reason',
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        {
          reporter_id: ana.id,
          target_user_id: bruno.id,
          message_body: 'mensaje feo',
          reason: 'HARASSMENT',
        },
        { reporter_id: ana.id, target_user_id: bruno.id, message_body: null, reason: 'SPAM' },
      ]),
    );
    // Friendship untouched (no automatic action).
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends).toHaveLength(1);
  });
});

describe('account deletion', () => {
  it('cascades social rows; reports keep the reporter evidence with the target cleared', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    const conv = await befriend(ana, bruno);
    await send(ana.token, conv, 'hola');
    await call(ana.token, 'POST', '/social/invites', { username: 'bruno' });
    await call(ana.token, 'POST', '/social/report', { username: 'bruno', reason: 'OTHER' });
    await call(bruno.token, 'POST', '/social/block', { username: 'ana' });
    db.sql.prepare('DELETE FROM users WHERE id = ?').run(bruno.id);
    for (const t of [
      'tactics_social_relationships',
      'tactics_social_blocks',
      'tactics_conversations',
      'tactics_messages',
      'tactics_pvp_invites',
    ])
      expect(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    expect(db.sql.prepare('SELECT target_user_id FROM tactics_social_reports').all()).toEqual([
      { target_user_id: null },
    ]);
    expect(db.sql.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends).toEqual([]);
  });
});

describe('SocialHub (per-user real-time + presence)', () => {
  function hubHarness() {
    const data = new Map<string, unknown>();
    const sockets: {
      sent: string[];
      closed: boolean;
      send(m: string): void;
      close(): void;
      serializeAttachment(): void;
      deserializeAttachment(): { userId: number };
    }[] = [];
    const ctx = {
      storage: {
        get: async <T>(k: string) => data.get(k) as T | undefined,
        put: async (k: string, v: unknown) => void data.set(k, v),
      },
      acceptWebSocket: () => {},
      getWebSockets: () => sockets.filter((s) => !s.closed),
    };
    const hub = new SocialHub(ctx as unknown as ConstructorParameters<typeof SocialHub>[0], {
      DB: db,
    });
    const socket = (userId: number) => {
      const s = {
        sent: [] as string[],
        closed: false,
        send(m: string) {
          this.sent.push(m);
        },
        close() {
          this.closed = true;
        },
        serializeAttachment() {},
        deserializeAttachment: () => ({ userId }),
      };
      sockets.push(s);
      return s;
    };
    return { hub, socket };
  }

  it('fans pushes out to the user sockets, issues one-use tickets, and keeps approximate presence', async () => {
    const ana = await player('ana');
    const bruno = await player('bruno');
    await befriend(ana, bruno);
    const { hub, socket } = hubHarness();
    const ticket = await (
      await hub.fetch(
        new Request('https://hub/ticket', {
          method: 'POST',
          headers: { 'X-Social-User': String(bruno.id) },
        }),
      )
    ).json();
    expect(ticket.ticket).toMatch(/^[0-9a-f-]{36}$/);
    // Without the ticket (or without an upgrade) the socket is refused.
    expect(
      (
        await hub.fetch(
          new Request('https://hub/socket?ticket=nope', { headers: { Upgrade: 'websocket' } }),
        )
      ).status,
    ).toBe(401);
    expect((await hub.fetch(new Request('https://hub/ticket', { method: 'POST' }))).status).toBe(
      401,
    );
    const tab1 = socket(bruno.id);
    const tab2 = socket(bruno.id);
    await hub.fetch(
      new Request('https://hub/push', {
        method: 'POST',
        body: JSON.stringify({ type: 'social', event: 'FRIENDS_CHANGED' }),
      }),
    );
    expect(tab1.sent).toEqual(['{"type":"social","event":"FRIENDS_CHANGED"}']);
    expect(tab2.sent).toHaveLength(1);
    // Heartbeat → ONLINE for friends; last socket closed → OFFLINE.
    await hub.webSocketMessage(tab1 as never, 'ping');
    expect(JSON.parse(tab1.sent.at(-1)!)).toEqual({ type: 'pong' });
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends[0].presence).toBe(
      'ONLINE',
    );
    tab2.closed = true;
    await hub.webSocketClose(tab2 as never);
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends[0].presence).toBe(
      'ONLINE',
    );
    tab1.closed = true;
    await hub.webSocketClose(tab1 as never);
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends[0].presence).toBe(
      'OFFLINE',
    );
    // A stale heartbeat degrades to OFFLINE even if no close arrived.
    db.sql
      .prepare('UPDATE tactics_social_presence SET online = 1, last_seen = ?')
      .run(clock - SOCIAL_LIMITS.presenceStaleMs - 1);
    expect((await call(ana.token, 'GET', '/social/overview')).body.friends[0].presence).toBe(
      'OFFLINE',
    );
    // Presence never exposes connection details.
    expect(
      Object.keys((await call(ana.token, 'GET', '/social/overview')).body.friends[0]).sort(),
    ).toEqual([
      'avatarId',
      'conversationId',
      'crestId',
      'frameId',
      'heroId',
      'lastMessageAt',
      'presence',
      'since',
      'titleId',
      'unread',
      'username',
    ]);
  });

  it('the connect route returns a ticket for the caller own hub only', async () => {
    const ana = await player('ana');
    const res = await call(ana.token, 'POST', '/social/connect', {});
    expect(res.body).toEqual({ ticket: 'ticket-1', hub: String(ana.id) });
    expect((await call(null, 'POST', '/social/connect', {})).status).toBe(401);
  });
});

describe('selected friend profile facts',()=>{
 it('only exposes persisted friend facts, not a stranger or blocked account',async()=>{
  const a=await player('profile_a'),b=await player('profile_b');
  expect((await call(null,'GET','/social/profile/profile_b')).status).toBe(401);
  expect((await call(a.token,'GET','/social/profile/profile_b')).status).toBe(403);
  await befriend(a,b);
  const empty=await call(a.token,'GET','/social/profile/profile_b');
  expect(empty.body).toMatchObject({lastSeen:null,inMatch:false,ranked:null,mostUsed:null,mastery:null,lastMatch:null});
  db.sql.prepare('INSERT INTO tactics_social_presence (user_id,online,last_seen) VALUES (?,0,?)').run(b.id,clock-480000);
  db.sql.prepare('INSERT INTO tactics_ranked_players (user_id,season_id,rp,updated_at) VALUES (?,\'preseason_0\',1240,?)').run(b.id,clock);
  db.sql.prepare('INSERT INTO tactics_champion_mastery (user_id,hero_id,xp,updated_at) VALUES (?,\'summoner\',2075,?)').run(b.id,clock);
  db.sql.prepare("INSERT INTO tactics_pvp_match_players (match_id,user_id,opponent_id,seat,champion,opponent_champion,mode,result,reason,rounds,duration_seconds,started_at,finished_at) VALUES ('profile-facts',?,?,0,'mage','warrior','DUEL','WIN','SURRENDER',4,120,?,?)").run(b.id,a.id,clock-120000,clock);
  const data=(await call(a.token,'GET','/social/profile/profile_b')).body;
  expect(data).toMatchObject({lastSeen:clock-480000,ranked:{rp:1240},mastery:{champion:'summoner',xp:2075},mostUsed:{champion:'mage',matches:1},lastMatch:{champion:'mage',mode:'DUEL',result:'WIN',playedAt:clock}});
  expect(data).not.toHaveProperty('userId');
  await call(b.token,'POST','/social/block',{username:a.name});
  expect((await call(a.token,'GET','/social/profile/profile_b')).status).toBe(403);
 });
});
