import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASCENT_CAMPAIGN, createRun, DEFAULT_CONTENT, encounterOrder, needsStartingChampion, serializeRun } from '../src/game';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';

/**
 * Custom domain regression (2026-10-13): signing in on https://rpg-go-tactics.com showed the
 * first-time "Elige tu campeón" to an existing account. Root cause: the Tactics API's CORS
 * allowlist did not include the new origin, so every API call failed in the browser (the auth
 * Worker allows any origin, so the login itself worked); the client went OFFLINE and showed the
 * new origin's empty GUEST profile — which looks like a brand-new player.
 *
 * The fake network below behaves like a browser: an API response without a matching
 * Access-Control-Allow-Origin for the page's origin is a network error.
 */
const AUTH = 'https://auth.test';
const API = 'https://api.test';
const PAGES = 'https://rpggo-tactics.pages.dev';
const CUSTOM = 'https://rpg-go-tactics.com';
const WRANGLER_ORIGINS = /ALLOWED_ORIGINS = "([^"]+)"/.exec(readFileSync(new URL('../server/wrangler.toml', import.meta.url), 'utf8'))![1]!;
/** The allowlist deployed before the fix (no custom domain). */
const OLD_ORIGINS = 'https://summoner-qa.rpggo-tactics.pages.dev,https://rpggo-tactics.pages.dev,https://localhost,capacitor://localhost';

let db: ReturnType<typeof memoryD1>;
let pageOrigin = PAGES;
let allowed = WRANGLER_ORIGINS;
let hold: Promise<void> | null = null;

async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === `${AUTH}/api/login`) {
    const { username, password } = JSON.parse(String(init!.body)) as { username: string; password: string };
    if (!db.sql.prepare('SELECT id FROM users WHERE username = ?').get(username) || password !== `pw-${username}`)
      return Response.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    const token = `t-${username}-${Math.random()}`;
    db.sql.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)').run(token, username, 4e12);
    return Response.json({ token, username }); // auth Worker: Access-Control-Allow-Origin: *
  }
  if (url === `${AUTH}/api/logout`) return Response.json({ ok: true });
  if (url.startsWith(API)) {
    if (hold) await hold;
    const headers = new Headers(init?.headers);
    headers.set('Origin', pageOrigin);
    const res = await handle(new Request(url, { ...init, headers }), { DB: db, ALLOWED_ORIGINS: allowed }, { content: DEFAULT_CONTENT, now: () => 9, seed: () => 3, summonerCampaign: true });
    // What a browser does with a CORS-refused response (preflight or actual): a network error.
    if (res.headers.get('Access-Control-Allow-Origin') !== pageOrigin) throw new TypeError('Failed to fetch');
    return res;
  }
  return new Response('not found', { status: 404 });
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
async function boot(storage: ReturnType<typeof memoryStorage>) {
  vi.resetModules();
  vi.stubGlobal('window', { localStorage: storage });
  return import('../src/presentation/store/battleStore');
}

/** The account's server-side data, row by row (to prove nothing was written). */
const snapshot = (userId: number) =>
  JSON.stringify(
    ['tactics_profiles', 'tactics_hero_campaign_runs', 'tactics_player_cards', 'tactics_decks', 'tactics_deck_cards', 'tactics_champion_unlocks', 'tactics_hero_progress', 'tactics_wallets'].map((t) =>
      db.sql.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY 1, 2, 3`).all(userId),
    ),
  );

const order = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);

/** An established account made on pages.dev: Summoner 10/10, Warrior 2/10 (like the reporter's). */
async function establishedAccount(name = 'veteran') {
  const { id } = addAccount(db, name);
  pageOrigin = PAGES;
  const device = memoryStorage();
  const { useBattleStore } = await boot(device);
  await useBattleStore.getState().signIn(name, `pw-${name}`);
  await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('READY'));
  const put = (run: ReturnType<typeof createRun>) =>
    db.sql.prepare(`INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, 'ascent', ?, ?, 1, 1)
      ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json`).run(id, run.heroId, serializeRun(run));
  put({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 4, 'summoner'), status: 'COMPLETED', currentEncounterId: order[9]!, completedEncounterIds: [...order] });
  put({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 5, 'warrior'), currentEncounterId: order[2]!, completedEncounterIds: order.slice(0, 2) });
  db.sql.prepare('UPDATE tactics_profiles SET campaign_best = 10, selected_champion_id = ? WHERE user_id = ?').run('summoner', id);
  return { id, name };
}

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  pageOrigin = PAGES;
  allowed = WRANGLER_ORIGINS;
  hold = null;
  vi.stubEnv('VITE_AUTH_API_URL', AUTH);
  vi.stubEnv('VITE_TACTICS_API_URL', API);
  vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
  vi.stubEnv('VITE_WARRIOR_ENABLED', '1');
  // Production behaviour: no dev bypass (a device with no saves boots a brand-new guest).
  vi.stubEnv('VITE_OPEN_PROGRESSION', '0');
  vi.stubGlobal('fetch', browserFetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('custom domain: an existing account hydrates from the cloud', () => {
  it('the production allowlist accepts both custom-domain origins and keeps refusing unknown ones', async () => {
    for (const origin of [CUSTOM, 'https://www.rpg-go-tactics.com', PAGES]) expect(WRANGLER_ORIGINS.split(',')).toContain(origin);
    const res = await handle(new Request(`${API}/api/tactics/health`, { headers: { Origin: 'https://evil.example' } }), { DB: db, ALLOWED_ORIGINS: WRANGLER_ORIGINS });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('A/B/C: pages.dev account → custom domain with empty localStorage: same account, same progress, no onboarding', async () => {
    const { id, name } = await establishedAccount();
    const before = snapshot(id);
    pageOrigin = CUSTOM;
    const fresh = memoryStorage(); // a new origin: nothing stored
    const { useBattleStore, championPromptsAllowed } = await boot(fresh);
    expect(useBattleStore.getState().account.status).toBe('GUEST');
    await useBattleStore.getState().signIn(name, `pw-${name}`);
    await vi.waitFor(() => expect(useBattleStore.getState().account).toMatchObject({ status: 'READY', userId: id }));
    const s = useBattleStore.getState();
    expect(championPromptsAllowed(s)).toBe(true);
    expect(needsStartingChampion(s.profile)).toBe(false); // → no "Elige tu campeón"
    expect(s.profile.champions).toMatchObject({ mode: 'LEGACY', campaignBest: 10 });
    expect(s.runs.summoner).toMatchObject({ status: 'COMPLETED' });
    expect(s.runs.warrior!.completedEncounterIds).toHaveLength(2);
    expect(s.profile.selectedChampionId).toBe('summoner');
    expect(snapshot(id)).toBe(before);
  });

  it('reproduction: with the OLD allowlist the API is refused → OFFLINE, and the empty guest profile never drives onboarding', async () => {
    const { id, name } = await establishedAccount();
    const before = snapshot(id);
    allowed = OLD_ORIGINS;
    pageOrigin = CUSTOM;
    const { useBattleStore, championPromptsAllowed } = await boot(memoryStorage());
    await useBattleStore.getState().signIn(name, `pw-${name}`);
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('OFFLINE'));
    const s = useBattleStore.getState();
    // The store holds this origin's brand-new guest profile (what the old client showed)…
    expect(needsStartingChampion(s.profile)).toBe(true);
    // …but onboarding is no longer allowed from it.
    expect(championPromptsAllowed(s)).toBe(false);
    // A guest-side "choice" in this state never reaches the account (nothing can be written).
    await s.chooseStartingChampion('mage');
    expect(snapshot(id)).toBe(before);
    // Once the origin is allowed, a retry restores the real account.
    allowed = WRANGLER_ORIGINS;
    useBattleStore.getState().retryCloud();
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('READY'));
    expect(needsStartingChampion(useBattleStore.getState().profile)).toBe(false);
    expect(useBattleStore.getState().runs.summoner).toMatchObject({ status: 'COMPLETED' });
    expect(snapshot(id)).toBe(before);
  });

  it('D: while the cloud state is still loading, onboarding waits', async () => {
    const { name } = await establishedAccount();
    pageOrigin = CUSTOM;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const { useBattleStore, championPromptsAllowed } = await boot(memoryStorage());
    const signing = useBattleStore.getState().signIn(name, `pw-${name}`);
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('CONNECTING'));
    expect(championPromptsAllowed(useBattleStore.getState())).toBe(false);
    release();
    hold = null;
    await signing;
    expect(useBattleStore.getState().account.status).toBe('READY');
    expect(needsStartingChampion(useBattleStore.getState().profile)).toBe(false);
  });

  it('E: a brand-new account on the custom domain DOES get the first-time choice (server-confirmed)', async () => {
    db = memoryD1(); // new profiles start in PROGRESSION mode
    addAccount(db, 'newbie');
    pageOrigin = CUSTOM;
    const { useBattleStore, championPromptsAllowed } = await boot(memoryStorage());
    await useBattleStore.getState().signIn('newbie', 'pw-newbie');
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('READY'));
    const s = useBattleStore.getState();
    expect(championPromptsAllowed(s)).toBe(true);
    expect(needsStartingChampion(s.profile)).toBe(true);
  });

  it('F/H: empty local state never overwrites the account; logout + login on the custom domain keeps everything', async () => {
    const { id, name } = await establishedAccount();
    const before = snapshot(id);
    pageOrigin = CUSTOM;
    const device = memoryStorage();
    let { useBattleStore } = await boot(device);
    await useBattleStore.getState().signIn(name, `pw-${name}`);
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('READY'));
    await useBattleStore.getState().signOut();
    expect(useBattleStore.getState().account.status).toBe('GUEST');
    ({ useBattleStore } = await boot(device));
    await useBattleStore.getState().signIn(name, `pw-${name}`);
    await vi.waitFor(() => expect(useBattleStore.getState().account.status).toBe('READY'));
    expect(useBattleStore.getState().runs.summoner).toMatchObject({ status: 'COMPLETED' });
    expect(snapshot(id)).toBe(before);
    // The account never wrote guest saves on this origin either.
    expect([...device.data.keys()].some((k) => k.startsWith('rpg-go-tactics:campaign') || k === 'rpg-go-tactics:profile')).toBe(false);
  });
});

describe('G: forged/replayed first-time requests cannot reset an established account', () => {
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`${API}/api/tactics${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: CUSTOM }, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: db, ALLOWED_ORIGINS: WRANGLER_ORIGINS }, { content: DEFAULT_CONTENT, now: () => 9, seed: () => 3, summonerCampaign: true });
    return { status: res.status, body: (await res.json()) as { error?: { code: string } } };
  };
  const token = (name: string) => {
    const t = `g-${name}`;
    db.sql.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)').run(t, name, 4e12);
    return t;
  };

  it('LEGACY account with progress: champion start, profile creation and import are refused; nothing changes', async () => {
    const { id, name } = await establishedAccount();
    const before = snapshot(id);
    const t = token(name);
    for (const heroId of ['mage', 'summoner', 'warrior']) expect((await call(t, 'POST', '/champions/start', { heroId })).status).toBeGreaterThanOrEqual(400);
    expect((await call(t, 'POST', '/profile', {})).status).toBe(409);
    expect((await call(t, 'POST', '/import', { profile: null, campaign: null })).status).toBe(409);
    expect(snapshot(id)).toBe(before);
  });

  it('PROGRESSION account that already chose: a replayed or different first choice never resets it', async () => {
    db = memoryD1();
    const { id } = addAccount(db, 'chooser');
    const t = token('chooser');
    await call(t, 'POST', '/profile', {});
    expect((await call(t, 'POST', '/champions/start', { heroId: 'mage' })).status).toBe(200);
    const before = snapshot(id);
    await call(t, 'POST', '/champions/start', { heroId: 'mage' }); // replay
    expect((await call(t, 'POST', '/champions/start', { heroId: 'summoner' })).status).toBeGreaterThanOrEqual(400);
    expect(snapshot(id)).toBe(before);
  });
});
