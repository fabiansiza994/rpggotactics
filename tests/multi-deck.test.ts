import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  copyLimit,
  copyName,
  createDeck,
  createProfile,
  DECK_RULES,
  deckSummaries,
  DEFAULT_CONTENT,
  DEFAULT_DECK_SLOTS_PER_CHAMPION,
  deleteDeck,
  duplicateDeck,
  heroProfile,
  loadoutDeck,
  loadoutFor,
  normalizeDeckName,
  parseProfileSave,
  renameDeck,
  serializeProfile,
  setDefaultDeck,
  starterDeck,
  STARTER_DECK_NAME,
  updateDeck,
  type DeckEntry,
  type PlayerProfile,
} from '../src/game';
import { validateLoadout } from '../src/game/pvp/duel';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

const C = DEFAULT_CONTENT;
const mage = C.heroes.mage!;
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

/** A legal Mage deck different from the starter: one copy of `out` swapped for one more `extra`. */
function swapDeck(): { cards: DeckEntry[]; extra: string; extraCopies: number } {
  const start = starterDeck(mage);
  const extra = start.find((e) => e.count < copyLimit(C.cards[e.cardId]!, DECK_RULES) && C.cards[e.cardId]!.heroId === 'mage')!;
  const out = start.find((e) => e.cardId !== extra.cardId)!;
  const cards = start
    .map((e) => (e.cardId === out.cardId ? { ...e, count: e.count - 1 } : e.cardId === extra.cardId ? { ...e, count: e.count + 1 } : e))
    .filter((e) => e.count > 0);
  return { cards, extra: extra.cardId, extraCopies: extra.count + 1 };
}

// ── Domain (guest profiles use these directly; the Worker mirrors them in SQL) ─────────────
describe('multi-deck domain rules', () => {
  const fresh = () => createProfile(C);

  it('1. the first deck of a champion with no decks becomes its default', () => {
    const p = fresh();
    const empty: PlayerProfile = { ...p, heroes: { ...p.heroes, mage: { ...p.heroes.mage!, decks: [], activeDeckId: '' } } };
    const r = ok(createDeck(empty, 'mage', { name: 'Bestiario' }, C, DECK_RULES, 100));
    expect(heroProfile(r.profile, 'mage', C).activeDeckId).toBe(r.deckId);
    expect(deckSummaries(r.profile, 'mage', C, DECK_RULES)).toEqual([
      expect.objectContaining({ deckId: r.deckId, name: 'Bestiario', isDefault: true, valid: true, cardCount: 30, maxCards: 30 }),
    ]);
  });

  it('new profile: one starter deck "Mazo inicial", default, valid; other slots stay free', () => {
    const s = deckSummaries(fresh(), 'summoner', C, DECK_RULES);
    expect(s).toEqual([expect.objectContaining({ deckId: 'main', name: STARTER_DECK_NAME, isDefault: true, valid: true, championId: 'summoner' })]);
    expect(STARTER_DECK_NAME).toBe('Mazo inicial');
  });

  it('2–4. second and third deck, fourth refused; slots are configurable', () => {
    let p = fresh();
    p = ok(createDeck(p, 'mage', { name: 'Rituales' }, C, DECK_RULES, 1)).profile;
    p = ok(createDeck(p, 'mage', { name: 'Fusiones' }, C, DECK_RULES, 2)).profile;
    expect(heroProfile(p, 'mage', C).decks).toHaveLength(DEFAULT_DECK_SLOTS_PER_CHAMPION);
    expect(createDeck(p, 'mage', {}, C, DECK_RULES, 3)).toEqual({ ok: false, error: 'DECK_LIMIT' });
    expect(createDeck(p, 'mage', {}, C, DECK_RULES, 3, 5).ok).toBe(true);
    expect(heroProfile(p, 'mage', C).activeDeckId).toBe('main'); // new decks never steal the default
  });

  it('5–8. rename, update, duplicate ("Copia de X", new id), duplicate refused when full', () => {
    let p = fresh();
    p = ok(renameDeck(p, 'mage', 'main', '  Bestiario  ', C, 5)).profile;
    expect(heroProfile(p, 'mage', C).decks[0]!.name).toBe('Bestiario');
    expect(renameDeck(p, 'mage', 'main', '   ', C, 5)).toEqual({ ok: false, error: 'INVALID_NAME' });
    expect(normalizeDeckName('x'.repeat(33))).toBeNull();
    expect(copyName('x'.repeat(32))).toHaveLength(32);

    const dup = ok(duplicateDeck(p, 'mage', 'main', C, 6));
    const copy = heroProfile(dup.profile, 'mage', C).decks.find((d) => d.id === dup.deckId)!;
    expect(copy).toMatchObject({ name: 'Copia de Bestiario', cards: starterDeck(mage) });
    expect(dup.deckId).not.toBe('main');
    p = dup.profile;

    const short = starterDeck(mage).slice(1);
    expect(updateDeck(p, 'mage', dup.deckId, short, C, DECK_RULES, 7)).toMatchObject({ ok: false, error: 'INVALID_DECK' });
    p = ok(duplicateDeck(p, 'mage', 'main', C, 8)).profile;
    expect(duplicateDeck(p, 'mage', 'main', C, 9)).toEqual({ ok: false, error: 'DECK_LIMIT' });
  });

  it('9–12. set default (only one), delete normal, delete default → oldest remaining, last deck kept', () => {
    let p = fresh();
    const b = ok(createDeck(p, 'mage', { name: 'B' }, C, DECK_RULES, 10));
    const c = ok(createDeck(b.profile, 'mage', { name: 'C' }, C, DECK_RULES, 20));
    p = ok(setDefaultDeck(c.profile, 'mage', c.deckId, C)).profile;
    expect(deckSummaries(p, 'mage', C, DECK_RULES).filter((d) => d.isDefault).map((d) => d.deckId)).toEqual([c.deckId]);
    p = ok(deleteDeck(p, 'mage', b.deckId, C)).profile; // normal
    expect(heroProfile(p, 'mage', C).activeDeckId).toBe(c.deckId);
    p = ok(deleteDeck(p, 'mage', c.deckId, C)).profile; // the default
    expect(heroProfile(p, 'mage', C).activeDeckId).toBe('main');
    expect(deleteDeck(p, 'mage', 'main', C)).toEqual({ ok: false, error: 'LAST_DECK' });
  });

  it('guest saves keep every deck with its times; a loadout resolves the chosen deck, never another champion\'s', () => {
    const r = ok(createDeck(fresh(), 'mage', { name: 'Agresivo' }, C, DECK_RULES, 123));
    const loaded = parseProfileSave(serializeProfile(r.profile), C);
    expect(loaded.status).toBe('OK');
    const decks = loaded.status === 'OK' ? heroProfile(loaded.profile, 'mage', C).decks : [];
    expect(decks.map((d) => [d.id, d.name, d.createdAt])).toEqual([['main', 'Mazo inicial', undefined], [r.deckId, 'Agresivo', 123]]);
    expect(loadoutDeck(r.profile, loadoutFor(r.profile, 'mage', C, r.deckId), C, DECK_RULES).source).toBe('SAVED');
    expect(() => loadoutFor(r.profile, 'summoner', C, r.deckId)).toThrow();
    expect(validateLoadout(r.profile, 'mage', C, r.deckId).deckId).toBe(r.deckId);
    expect(() => validateLoadout(r.profile, 'summoner', C, r.deckId)).toThrow('UNKNOWN_DECK');
  });
});

// ── Migration 0028 on existing rows ─────────────────────────────────────────────────────
describe('13. migration 0028 (existing accounts)', () => {
  const migrate = (sql: DatabaseSync, f: string) => sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));

  it('keeps every deck, name and card; one default per champion; additive only', () => {
    const sql = new DatabaseSync(':memory:');
    sql.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id INTEGER PRIMARY KEY);');
    migrate(sql, '0001_tactics_player_data.sql');
    migrate(sql, '0023_tactics_ranked_preseason.sql');
    sql.exec('INSERT INTO users VALUES (1), (2), (3)');
    const deck = (u: number, hero: string, id: string, active: number, at: number) =>
      sql.prepare('INSERT INTO tactics_decks (user_id, hero_id, deck_id, name, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(u, hero, id, 'Mazo principal', active, at);
    deck(1, 'mage', 'main', 1, 500);
    deck(1, 'summoner', 'main', 1, 600);
    deck(2, 'mage', 'main', 1, 700); // unexpected data: two defaults
    deck(2, 'mage', 'zeta', 1, 800);
    deck(3, 'mage', 'main', 0, 900); // unexpected data: no default
    sql.prepare("INSERT INTO tactics_deck_cards VALUES (1, 'mage', 'main', 'magic_missile', 3)").run();
    const cardsBefore = sql.prepare('SELECT * FROM tactics_deck_cards').all();
    sql.exec("INSERT INTO tactics_ranked_queue (user_id, hero_id, joined_at, expires_at) VALUES (1, 'mage', 1, 2)");

    migrate(sql, '0028_tactics_multi_deck.sql');
    expect(sql.prepare('SELECT user_id, hero_id, deck_id, name, is_active, created_at FROM tactics_decks ORDER BY user_id, hero_id, deck_id').all()).toEqual([
      { user_id: 1, hero_id: 'mage', deck_id: 'main', name: 'Mazo principal', is_active: 1, created_at: 500 },
      { user_id: 1, hero_id: 'summoner', deck_id: 'main', name: 'Mazo principal', is_active: 1, created_at: 600 },
      { user_id: 2, hero_id: 'mage', deck_id: 'main', name: 'Mazo principal', is_active: 1, created_at: 700 },
      { user_id: 2, hero_id: 'mage', deck_id: 'zeta', name: 'Mazo principal', is_active: 0, created_at: 800 },
      { user_id: 3, hero_id: 'mage', deck_id: 'main', name: 'Mazo principal', is_active: 1, created_at: 900 },
    ]);
    expect(sql.prepare('SELECT * FROM tactics_deck_cards').all()).toEqual(cardsBefore);
    expect(sql.prepare('SELECT deck_id FROM tactics_ranked_queue').get()).toEqual({ deck_id: null });
    // The database itself now refuses a second default.
    expect(() => sql.prepare("UPDATE tactics_decks SET is_active = 1 WHERE user_id = 2 AND deck_id = 'zeta'").run()).toThrow(/UNIQUE/);
  });
});

// ── Server (Worker over node:sqlite) ──────────────────────────────────────────────────────
class FakeSocket {
  closed = false;
  constructor(public seat: number) {}
  deserializeAttachment() {
    return { seat: this.seat };
  }
  serializeAttachment() {}
  send() {}
  close() {
    this.closed = true;
  }
}
interface FakeRoom {
  data: Map<string, unknown>;
  sockets: FakeSocket[];
  make(): PvPMatchRoom;
  live: PvPMatchRoom;
}
let db: DB;
let env: Env;
let rooms: Map<string, FakeRoom>;
const deps = { content: C, now: () => Date.now(), seed: () => 7 };

function namespace() {
  rooms = new Map();
  return {
    idFromName: (n: string) => n,
    get: (name: unknown) => {
      const key = String(name);
      if (!rooms.has(key)) {
        const data = new Map<string, unknown>(),
          sockets: FakeSocket[] = [];
        let init: Promise<unknown> = Promise.resolve();
        const ctx = {
          storage: {
            get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => ((init = fn()), init as Promise<T>),
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
        };
        const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], env);
        const entry = { data, sockets, make, live: make() } as FakeRoom & { fetch(r: Request): Promise<Response> };
        entry.fetch = async (r: Request) => {
          await init;
          return entry.live.fetch(r);
        };
        rooms.set(key, entry);
      }
      return rooms.get(key) as unknown as { fetch(r: Request): Promise<Response> };
    },
  };
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handle(
    new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    deps,
  );
  return { status: res.status, body: (await res.json()) as Json };
}
async function player(name: string) {
  const a = addAccount(db, name);
  expect((await call(a.token, 'POST', '/profile', {})).status).toBe(200);
  return { ...a, name };
}
type Player = Awaited<ReturnType<typeof player>>;
const list = async (p: Player, hero = 'mage') => (await call(p.token, 'GET', `/decks/${hero}`)).body.decks as Json[];
const create = (p: Player, body: Json = {}, hero = 'mage') => call(p.token, 'POST', `/decks/${hero}`, body);
const rows = (id: number, hero = 'mage') =>
  db.sql.prepare('SELECT deck_id, name, is_active FROM tactics_decks WHERE user_id = ? AND hero_id = ? ORDER BY created_at, rowid').all(id, hero) as Json[];
const cardsOf = (id: number, deckId: string, hero = 'mage') =>
  db.sql.prepare('SELECT card_id AS cardId, count FROM tactics_deck_cards WHERE user_id = ? AND hero_id = ? AND deck_id = ? ORDER BY card_id').all(id, hero, deckId);
const sorted = (cards: DeckEntry[]) => [...cards].sort((a, b) => a.cardId.localeCompare(b.cardId));
const grant = (id: number, cardId: string, copies: number) =>
  db.sql
    .prepare("INSERT INTO tactics_player_cards VALUES (?, 'mage', ?, ?, 1, 'NORMAL_DROP', 0) ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = excluded.copies")
    .run(id, cardId, copies);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  env = { DB: db, PVP_ROOMS: namespace(), RANKED_PRESEASON_ENABLED: '1' };
});
afterEach(() => vi.useRealTimers());

describe('multi-deck API', () => {
  it('14. new account: only the starter "Mazo inicial" per champion, default, valid', async () => {
    const a = await player('nueva');
    for (const hero of ['mage', 'summoner'])
      expect(await list(a, hero)).toEqual([
        { deckId: 'main', name: 'Mazo inicial', championId: hero, cardCount: 30, maxCards: 30, valid: true, isDefault: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
    expect((await call(a.token, 'GET', '/decks/mage')).body.slots).toBe(3);
  });

  it('13. existing account: its stored deck stays "Mazo principal", default, same cards', async () => {
    const a = await player('veterana');
    const { cards } = swapDeck();
    // What the previous Worker left behind: one deck per champion, its own name and cards.
    db.sql.prepare("UPDATE tactics_decks SET name = 'Mazo principal' WHERE user_id = ?").run(a.id);
    grant(a.id, swapDeck().extra, swapDeck().extraCopies);
    expect((await call(a.token, 'PUT', '/decks/mage/main', { cards })).status).toBe(200); // the old route still works
    expect(await list(a)).toEqual([expect.objectContaining({ deckId: 'main', name: 'Mazo principal', isDefault: true, valid: true })]);
    expect(cardsOf(a.id, 'main')).toEqual(sorted(cards));
  });

  it('1–4, 9–12. create ×2, fourth refused, default moves, delete normal + default', async () => {
    const a = await player('ana');
    const second = await create(a, { name: 'Bestiario' });
    expect(second.status).toBe(200);
    expect(second.body.decks).toHaveLength(2);
    expect(second.body.profile.heroes.mage.decks).toHaveLength(2); // the state carries it too
    const third = await create(a, { name: 'Rituales' });
    expect(third.status).toBe(200);
    const fourth = await create(a, { name: 'Fusiones' });
    expect(fourth).toMatchObject({ status: 409, body: { error: { code: 'DECK_LIMIT', slots: 3 } } });
    expect(rows(a.id).map((r) => r.name)).toEqual(['Mazo inicial', 'Bestiario', 'Rituales']);
    expect(rows(a.id).filter((r) => r.is_active).map((r) => r.deck_id)).toEqual(['main']);

    const b = second.body.deckId as string,
      c = third.body.deckId as string;
    const def = await call(a.token, 'PUT', `/decks/mage/${c}/default`);
    expect(def.status).toBe(200);
    expect(def.body.profile.heroes.mage.activeDeckId).toBe(c);
    expect(rows(a.id).filter((r) => r.is_active).map((r) => r.deck_id)).toEqual([c]);

    expect((await call(a.token, 'DELETE', `/decks/mage/${b}`)).body.deckId).toBe(c); // normal delete
    const delDefault = await call(a.token, 'DELETE', `/decks/mage/${c}`);
    expect(delDefault.status).toBe(200);
    expect(delDefault.body.deckId).toBe('main'); // oldest remaining becomes default
    expect(rows(a.id)).toEqual([{ deck_id: 'main', name: 'Mazo inicial', is_active: 1 }]);
    expect(db.sql.prepare('SELECT count(*) AS n FROM tactics_deck_cards WHERE user_id = ? AND deck_id IN (?, ?)').get(a.id, b, c)).toEqual({ n: 0 });
    expect(await call(a.token, 'DELETE', '/decks/mage/main')).toMatchObject({ status: 409, body: { error: { code: 'LAST_DECK' } } });
  });

  it('5–8, 15. rename, update, duplicate, duplicate when full, invalid decks refused', async () => {
    const a = await player('beto');
    const id = (await create(a, { name: 'Bestiario' })).body.deckId as string;
    expect((await call(a.token, 'PATCH', `/decks/mage/${id}`, { name: '  Defensivo ' })).body.decks[1]).toMatchObject({ name: 'Defensivo' });
    expect((await call(a.token, 'PATCH', `/decks/mage/${id}`, { name: '' })).status).toBe(422);

    const { cards, extra, extraCopies } = swapDeck();
    expect((await call(a.token, 'PUT', `/decks/mage/${id}`, { cards })).body.error.code).toBe('INVALID_DECK'); // copy not owned
    grant(a.id, extra, extraCopies);
    expect((await call(a.token, 'PUT', `/decks/mage/${id}`, { cards })).status).toBe(200);
    expect(cardsOf(a.id, id)).toEqual(sorted(cards));
    expect(cardsOf(a.id, 'main')).toEqual(sorted(starterDeck(mage))); // other decks untouched

    const dup = await call(a.token, 'POST', `/decks/mage/${id}/duplicate`, {});
    expect(dup.status).toBe(200);
    expect(dup.body.decks.at(-1)).toMatchObject({ name: 'Copia de Defensivo', isDefault: false, valid: true });
    expect(cardsOf(a.id, dup.body.deckId)).toEqual(sorted(cards));
    expect((await call(a.token, 'POST', `/decks/mage/${id}/duplicate`, {})).body.error.code).toBe('DECK_LIMIT');

    // 15: invalid lists are refused on create and on update (Deck Builder rules, server collection).
    expect((await call(a.token, 'PUT', `/decks/mage/${id}`, { cards: cards.slice(1) })).body.error.code).toBe('INVALID_DECK');
    await call(a.token, 'DELETE', `/decks/mage/${dup.body.deckId}`);
    expect((await create(a, { cards: [{ cardId: 'magic_missile', count: 30 }] })).body.error.code).toBe('INVALID_DECK');
    expect((await create(a, { cards: starterDeck(C.heroes.summoner!) })).body.error.code).toBe('INVALID_DECK'); // other class
    expect((await create(a, { name: 'x'.repeat(40) })).body.error.code).toBe('INVALID_NAME');
    expect(rows(a.id)).toHaveLength(2);
  });

  it('16–17. another account\'s or another champion\'s deck is never usable', async () => {
    const ana = await player('ana');
    const beto = await player('beto');
    const mine = (await create(ana, { name: 'Bestiario' })).body.deckId as string;
    // Cross-user: beto cannot edit, rename, duplicate, default, delete or play ana's deck.
    expect((await call(beto.token, 'PUT', `/decks/mage/${mine}`, { cards: starterDeck(mage) })).status).toBe(404);
    expect((await call(beto.token, 'PATCH', `/decks/mage/${mine}`, { name: 'Robado' })).status).toBe(404);
    expect((await call(beto.token, 'POST', `/decks/mage/${mine}/duplicate`, {})).status).toBe(404);
    expect((await call(beto.token, 'PUT', `/decks/mage/${mine}/default`)).status).toBe(404);
    expect((await call(beto.token, 'DELETE', `/decks/mage/${mine}`)).status).toBe(404);
    expect((await call(beto.token, 'POST', '/pvp/create', { heroId: 'mage', deckId: mine })).body.error.code).toBe('UNKNOWN_DECK');
    expect((await call(beto.token, 'POST', '/ranked/queue', { heroId: 'mage', deckId: mine })).body.error.code).toBe('UNKNOWN_DECK');
    expect(rows(ana.id).map((r) => r.name)).toEqual(['Mazo inicial', 'Bestiario']);
    expect(rows(beto.id)).toHaveLength(1);

    // Cross-champion: a Mage deck id is not a Summoner deck.
    expect((await call(ana.token, 'PUT', `/decks/summoner/${mine}`, { cards: starterDeck(C.heroes.summoner!) })).status).toBe(404);
    expect((await call(ana.token, 'POST', '/pvp/create', { heroId: 'summoner', deckId: mine })).body.error.code).toBe('UNKNOWN_DECK');
    expect((await call(ana.token, 'POST', '/ranked/queue', { heroId: 'summoner', deckId: mine })).body.error.code).toBe('UNKNOWN_DECK');
    expect((await call(ana.token, 'POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'first_blood', deckId: mine })).status).toBe(404);
    expect((await call(ana.token, 'POST', '/pvp/create', { heroId: 'mage', deckId: '../x' })).status).toBe(404);
  });

  it('18. Ranked with an invalid deck is rejected; a valid chosen deck queues with that deck', async () => {
    const a = await player('ana');
    // A stored deck that is no longer legal (old 20-card list): playable nowhere competitive.
    db.sql.prepare("INSERT INTO tactics_decks (user_id, hero_id, deck_id, name, is_active, created_at, updated_at) VALUES (?, 'mage', 'legacy', 'Viejo', 0, 1, 1)").run(a.id);
    let left = 20;
    for (const e of starterDeck(mage)) {
      const n = Math.min(e.count, left);
      if (n > 0) db.sql.prepare("INSERT INTO tactics_deck_cards VALUES (?, 'mage', 'legacy', ?, ?)").run(a.id, e.cardId, n);
      left -= n;
    }
    expect((await list(a)).find((d) => d.deckId === 'legacy')).toMatchObject({ valid: false, cardCount: 20 });
    const bad = await call(a.token, 'POST', '/ranked/queue', { heroId: 'mage', deckId: 'legacy' });
    expect(bad).toMatchObject({ status: 422, body: { error: { code: 'INVALID_DECK', totalCards: 20 } } });
    expect((await call(a.token, 'POST', '/pvp/create', { heroId: 'mage', deckId: 'legacy' })).status).toBe(422);

    const id = (await create(a, { name: 'Ranked' })).body.deckId as string;
    const q = await call(a.token, 'POST', '/ranked/queue', { heroId: 'mage', deckId: id });
    expect(q.body.queue).toMatchObject({ state: 'SEARCHING', heroId: 'mage', deckId: id });
  });

  it('19–20. the match keeps its deck snapshot after edit/delete; history survives', async () => {
    const ana = await player('ana');
    const beto = await player('beto');
    const { cards, extra, extraCopies } = swapDeck();
    grant(ana.id, extra, extraCopies);
    const id = (await create(ana, { name: 'Agresivo', cards })).body.deckId as string;
    const created = await call(ana.token, 'POST', '/pvp/create', { heroId: 'mage', deckId: id });
    expect(created.status).toBe(200);
    expect(created.body.members[created.body.seat].deckId).toBe(id);
    const code = created.body.code as string;
    expect((await call(beto.token, 'POST', '/pvp/join', { code, heroId: 'summoner' })).status).toBe(200);
    const room = rooms.get(code)!;
    (room.data.get('room') as Room).members.forEach((m) => (m.offlineAt = null));
    room.sockets.push(new FakeSocket(0), new FakeSocket(1));
    room.live = room.make();
    expect((await call(ana.token, 'POST', '/pvp/ready', { code, heroId: 'mage', deckId: id })).status).toBe(200);
    expect((await call(beto.token, 'POST', '/pvp/ready', { code, heroId: 'summoner' })).status).toBe(200);
    const started = room.data.get('room') as Room;
    expect(started.game).not.toBeNull();
    expect({ ...started.members[0]!.loadout, cards: sorted(started.members[0]!.loadout.cards) }).toEqual({ heroId: 'mage', deckId: id, cards: sorted(cards) });
    const snapshot = JSON.stringify(started.game);
    const initial = JSON.stringify(room.data.get('initial:' + started.matchId));

    // Edit, then delete, the deck the match was built from.
    expect((await call(ana.token, 'PUT', `/decks/mage/${id}`, { cards: starterDeck(mage) })).status).toBe(200);
    expect((await call(ana.token, 'DELETE', `/decks/mage/${id}`)).status).toBe(200);
    const after = room.data.get('room') as Room;
    expect(JSON.stringify(after.game)).toBe(snapshot);
    expect(sorted(after.members[0]!.loadout.cards)).toEqual(sorted(cards));
    expect(JSON.stringify(room.data.get('initial:' + started.matchId))).toBe(initial); // replay base

    await room.live.webSocketMessage(room.sockets[1] as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0], JSON.stringify({ type: 'surrender' }));
    const history = await call(ana.token, 'GET', '/pvp/history');
    expect(history.status).toBe(200);
    expect(history.body.matches).toEqual([expect.objectContaining({ matchId: started.matchId })]);
    expect((await call(ana.token, 'GET', `/pvp/history/${started.matchId}`)).status).toBe(200);
  });

  it('ranked: the deck is fixed by the ticket (no swap after seeing the rival)', async () => {
    const ana = await player('ana');
    const beto = await player('beto');
    const id = (await create(ana, { name: 'Ranked' })).body.deckId as string;
    expect((await call(ana.token, 'POST', '/ranked/queue', { heroId: 'mage', deckId: id })).body.queue.state).toBe('SEARCHING');
    const paired = await call(beto.token, 'POST', '/ranked/queue', { heroId: 'summoner' });
    const code = paired.body.queue.code as string;
    const room = rooms.get(code)!;
    expect((room.data.get('room') as Room).members.find((m) => m.id === ana.id)!.loadout.deckId).toBe(id);
    expect((await call(ana.token, 'POST', '/pvp/ready', { code, heroId: 'mage', deckId: 'main' })).status).toBe(409);
    expect((await call(ana.token, 'POST', '/pvp/ready', { code, heroId: 'mage', deckId: id })).status).toBe(200);
  });

  it('21 + 9. concurrency: creates never exceed 3, retries are idempotent, one default, never zero decks', async () => {
    const a = await player('ana');
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => create(a, { name: `M${i}` })));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(2);
    expect(burst.filter((r) => r.status === 409).every((r) => r.body.error.code === 'DECK_LIMIT')).toBe(true);
    expect(rows(a.id)).toHaveLength(3);

    // Same requestId twice at once (double click / lost response): one deck.
    await call(a.token, 'DELETE', `/decks/mage/${rows(a.id)[2]!.deck_id}`);
    const [x, y] = await Promise.all([create(a, { name: 'Uno', requestId: 'req-00000001' }), create(a, { name: 'Uno', requestId: 'req-00000001' })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.deckId).toBe(y.body.deckId);
    expect(rows(a.id)).toHaveLength(3);
    expect((await create(a, { requestId: 'req-00000001' })).status).toBe(200); // later retry: still one
    expect(rows(a.id)).toHaveLength(3);
    // Double duplicate with one requestId when one slot is free: one copy.
    await call(a.token, 'DELETE', `/decks/mage/${x.body.deckId}`);
    await Promise.all([1, 2].map(() => call(a.token, 'POST', '/decks/mage/main/duplicate', { requestId: 'dup-00000001' })));
    expect(rows(a.id).filter((r) => r.name === 'Copia de Mazo inicial')).toHaveLength(1);

    // Two Set Default at once: exactly one default.
    const ids = rows(a.id).map((r) => r.deck_id as string);
    await Promise.all([call(a.token, 'PUT', `/decks/mage/${ids[1]}/default`), call(a.token, 'PUT', `/decks/mage/${ids[2]}/default`)]);
    expect(rows(a.id).filter((r) => r.is_active)).toHaveLength(1);
    // Two deletes racing down to one deck: never zero, and a default remains.
    await call(a.token, 'DELETE', `/decks/mage/${ids[2]}`);
    const dels = await Promise.all([call(a.token, 'DELETE', `/decks/mage/${ids[0]}`), call(a.token, 'DELETE', `/decks/mage/${ids[1]}`)]);
    expect(dels.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rows(a.id)).toEqual([expect.objectContaining({ is_active: 1 })]);
  });

  it('a champion with no stored deck: its starter is stored (as default) on the first deck write, even under a race', async () => {
    const a = await player('ana');
    db.sql.prepare("DELETE FROM tactics_decks WHERE user_id = ? AND hero_id = 'summoner'").run(a.id);
    expect(await list(a, 'summoner')).toEqual([expect.objectContaining({ deckId: 'main', isDefault: true })]);
    const both = await Promise.all([create(a, { name: 'A' }, 'summoner'), create(a, { name: 'B' }, 'summoner')]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(rows(a.id, 'summoner').map((r) => [r.deck_id === 'main', r.is_active])).toEqual([[true, 1], [false, 0], [false, 0]]);
    expect(cardsOf(a.id, 'main', 'summoner')).toEqual(sorted(starterDeck(C.heroes.summoner!)));
  });
});

// ── Guest store (what the future "Mis Mazos" UI calls without an account) ─────────────────
describe('guest store deck actions', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const boot = async () => {
    vi.resetModules();
    return (await import('../src/presentation/store/battleStore')).useBattleStore;
  };

  it('create / rename / duplicate / default / delete persist locally; skirmish fights the chosen deck', async () => {
    let store = await boot();
    const made = await store.getState().createDeck('mage', { name: 'Bestiario' });
    if (!made.ok) throw new Error(JSON.stringify(made));
    expect((await store.getState().renameDeck('mage', made.deckId, 'Agresivo')).ok).toBe(true);
    const dup = await store.getState().duplicateDeck('mage', made.deckId);
    expect(dup.ok).toBe(true);
    expect(await store.getState().createDeck('mage')).toMatchObject({ ok: false, error: 'DECK_LIMIT' });
    expect((await store.getState().setDefaultDeck('mage', made.deckId)).ok).toBe(true);

    store = await boot(); // reload from local storage
    const summaries = deckSummaries(store.getState().profile, 'mage', C, DECK_RULES);
    expect(summaries.map((d) => [d.name, d.isDefault])).toEqual([['Mazo inicial', false], ['Agresivo', true], ['Copia de Agresivo', false]]);
    expect(await store.getState().deleteDeck('mage', made.deckId)).toEqual({ ok: true, deckId: 'main' });
    expect(await store.getState().startScenario('first_blood', 1, 'mage', 'nope')).toBe(false);
    expect(await store.getState().startScenario('first_blood', 1, 'mage', summaries[2]!.deckId)).toBe(true);
  });
});
