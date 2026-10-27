import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCard,
  ownedFor,
  createProfile,
  DEFAULT_CONTENT,
  grantCard,
  removeCard,
  serializeProfile,
  starterDeck,
} from '../src/game';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { seedForFirstDrop } from './support/drops';

/** Server-chosen run seed in these tests: one whose Encounter I offers cards to a starter profile. */
const SERVER_SEED = seedForFirstDrop(true);

const AUTH = 'https://auth.test';
const API = 'https://api.test';
const mage = DEFAULT_CONTENT.heroes.mage!;
const norm = (d: readonly { cardId: string; count: number }[]) =>
  [...d].sort((a, b) => a.cardId.localeCompare(b.cardId));

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

let db: ReturnType<typeof memoryD1>;
let online = true;
let requests: string[] = [];
let loseVictoryResponse = false;
/** Server-side SUMMONER_CAMPAIGN switch. */
let serverSummoner = false;

/** Network: the auth Worker's /api/login (password = "pw-<username>") and the real Tactics API handler. */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  requests.push(`${init?.method ?? 'GET'} ${url}`);
  if (!online) throw new TypeError('Failed to fetch');
  if (url === `${AUTH}/api/login`) {
    const { username, password } = JSON.parse(String(init!.body)) as {
      username: string;
      password: string;
    };
    const user = db.sql.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user || password !== `pw-${username}`)
      return Response.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
    const token = `login-${username}-${requests.length}`;
    db.sql
      .prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)')
      .run(token, username, 4e12);
    return Response.json({ token, username });
  }
  if (url === `${AUTH}/api/register` || url === `${AUTH}/api/recover`) {
    const { username } = JSON.parse(String(init!.body)) as { username: string };
    if (url.endsWith('/register')) addAccount(db, username);
    const token = `setup-${username}-${requests.length}`;
    db.sql
      .prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)')
      .run(token, username, 4e12);
    return Response.json({
      token,
      username,
      recoveryCode: url.endsWith('/recover')
        ? 'NEW1-NEW2-NEW3-NEW4-NEW5'
        : 'TEST-TEST-TEST-TEST-TEST',
    });
  }
  if (url === `${AUTH}/api/logout`) return Response.json({ ok: true });
  if (url.startsWith(API)) {
    const response = await handle(
      new Request(url, init),
      { DB: db },
      { content: DEFAULT_CONTENT, now: () => 5, seed: () => SERVER_SEED, summonerCampaign: serverSummoner },
    );
    if (loseVictoryResponse && url.endsWith('/campaign/victory') && response.ok) {
      loseVictoryResponse = false;
      throw new TypeError('Response lost after commit');
    }
    return response;
  }
  return new Response('not found', { status: 404 });
}

/** A fresh app start on one device (its own localStorage). */
async function boot(storage: ReturnType<typeof memoryStorage>) {
  vi.resetModules();
  vi.stubGlobal('window', { localStorage: storage });
  const { useBattleStore } = await import('../src/presentation/store/battleStore');
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return useBattleStore;
}
type Store = Awaited<ReturnType<typeof boot>>;
const idle = (store: Store) => vi.waitFor(() => expect(store.getState().cloud.busy).toBeNull());

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  online = true;
  requests = [];
  loseVictoryResponse = false;
  serverSummoner = false;
  addAccount(db, 'ana');
  vi.stubEnv('VITE_AUTH_API_URL', AUTH);
  vi.stubEnv('VITE_TACTICS_API_URL', API);
  vi.stubGlobal('fetch', fakeFetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('account + cloud save through the app store', () => {
  it('without the API URL the build stays local-only (guest, no requests)', async () => {
    vi.stubEnv('VITE_TACTICS_API_URL', '');
    const store = await boot(memoryStorage());
    expect(store.getState().account.status).toBe('DISABLED');
    expect(requests).toEqual([]);
  });

  it('a wrong password is reported and nothing changes', async () => {
    const store = await boot(memoryStorage());
    expect(await store.getState().signIn('ana', 'nope')).toBe('Usuario o contraseña incorrectos.');
    expect(store.getState().account.status).toBe('GUEST');
  });

  it('first sign-in without local progress creates a cloud profile; guest saves are never written by the account', async () => {
    const device = memoryStorage();
    const store = await boot(device);
    expect(await store.getState().signIn('ana', 'pw-ana')).toBeNull();
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    await store.getState().saveDeck('mage', starterDeck(mage)); // no-op save goes to the cloud
    store.getState().selectChampion('summoner');
    await idle(store);
    expect([...device.data.keys()]).toEqual(['rpg-go-tactics:session']);
  });

  it('local progress is offered once, imported and validated; the cloud wins afterwards on every device', async () => {
    const deviceA = memoryStorage();
    // Guest progress on device A: an earned (3rd) Repulse equipped instead of a Blink, Summoner picked.
    const earned = grantCard(createProfile(DEFAULT_CONTENT), 'mage', 'repulse', DEFAULT_CONTENT);
    if (!earned.ok) throw new Error(earned.error);
    const localDeck = addCard(removeCard(starterDeck(mage), 'blink'), 'repulse');
    earned.profile.heroes.mage!.decks[0]!.cards = localDeck;
    deviceA.data.set(
      'rpg-go-tactics:profile',
      serializeProfile({ ...earned.profile, selectedChampionId: 'summoner' }),
    );

    let store = await boot(deviceA);
    await store.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(store.getState().account.status).toBe('NEEDS_IMPORT'));
    const account = store.getState().account;
    expect(account.status === 'NEEDS_IMPORT' && account.local.earnedCards).toBe(1);
    await store.getState().resolveImport('IMPORT');
    expect(store.getState().account.status).toBe('READY');
    expect(norm(store.getState().profile.heroes.mage!.decks[0]!.cards)).toEqual(norm(localDeck));

    // Device A edits the deck in the cloud; its stale guest save is NOT re-imported on reload.
    const cloudDeck = addCard(removeCard(starterDeck(mage), 'barrier'), 'repulse');
    expect(await store.getState().saveDeck('mage', cloudDeck)).toEqual({ ok: true });
    store = await boot(deviceA); // reload with the saved session
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    expect(norm(store.getState().profile.heroes.mage!.decks[0]!.cards)).toEqual(norm(cloudDeck));
    expect(requests.filter((r) => r.includes('/import'))).toHaveLength(1);

    // Device B (empty storage) signs in: same progression, no import prompt.
    const deviceB = memoryStorage();
    const storeB = await boot(deviceB);
    await storeB.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(storeB.getState().account.status).toBe('READY'));
    expect(norm(storeB.getState().profile.heroes.mage!.decks[0]!.cards)).toEqual(norm(cloudDeck));
    expect(storeB.getState().profile.selectedChampionId).toBe('summoner');
    storeB.getState().startScenario('first_blood');
    await vi.waitFor(() => expect(storeB.getState().engine?.scenario.hero.heroId).toBe('summoner'));
    expect(storeB.getState().skirmish?.run.heroId).toBe('summoner');
  });

  it('a failed cloud write is never reported as saved; retry succeeds once the network is back', async () => {
    const store = await boot(memoryStorage());
    await store.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    // Illegal decks are refused locally (same rules) without a request.
    const before = requests.length;
    const illegal = await store
      .getState()
      .saveDeck('mage', addCard(removeCard(starterDeck(mage), 'blink'), 'repulse'));
    expect(illegal.ok).toBe(false);
    expect(requests.length).toBe(before);

    online = false;
    store.getState().selectChampion('summoner');
    await vi.waitFor(() => expect(store.getState().cloud.error).toMatch(/Sin conexión/));
    expect(store.getState().cloud.canRetry).toBe(true);
    expect(store.getState().profile.selectedChampionId).toBe('mage'); // not pretended
    online = true;
    store.getState().retryCloud();
    await vi.waitFor(() => expect(store.getState().profile.selectedChampionId).toBe('summoner'));
    expect(store.getState().cloud.error).toBeNull();
  });

  it('campaign: the server replays the real win, then grants the offered card; a forged win is rejected', async () => {
    const store = await boot(memoryStorage());
    await store.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    expect(await store.getState().startRun()).toBe(true);
    expect(store.getState().run).toMatchObject({ status: 'IN_BATTLE', seed: SERVER_SEED });

    // Forged: delete the enemies from the live state (what the guest-mode tests do). The server's replay disagrees.
    const engine = store.getState().engine!;
    const state = engine.state as { units: { faction: string }[]; pendingWaves: unknown[] };
    state.units = state.units.filter((u) => u.faction !== 'ENEMY');
    state.pendingWaves = [];
    store.getState().endTurn();
    await vi.waitFor(() => expect(store.getState().cloud.error).toMatch(/no pudo verificarse/));
    expect(store.getState().cloud.canRetry).toBe(true);
    expect(store.getState().run!.status).toBe('IN_BATTLE');
    const beforeRetry = requests.length;
    store.getState().retryCloud();
    store.getState().retryCloud();
    await idle(store);
    expect(requests.slice(beforeRetry).filter((r) => r.endsWith('/campaign/victory'))).toHaveLength(1);
    expect(store.getState().run!.completedEncounterIds).toHaveLength(0);
    store.getState().dismissCloudError();
    expect(store.getState().cloud.canRetry).toBe(true);
    store.getState().retryCloud();
    await idle(store);
    expect(store.getState().run!.completedEncounterIds).toHaveLength(0);

    // Real play: restart (fresh seed) until the bot wins; the proof is submitted automatically.
    for (let i = 0; i < 40 && store.getState().run!.status === 'IN_BATTLE'; i++) {
      store.getState().restart();
      playBattle(store.getState().engine!);
      await idle(store);
    }
    expect(store.getState().run!.status).toBe('CHOOSING_REWARD');
    const offer = store.getState().run!.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    if (offer.kind !== 'ADD_CARD') throw new Error('expected a card');
    const owned = ownedFor(store.getState().profile, 'mage', DEFAULT_CONTENT)(offer.cardId);
    store.getState().chooseReward(offer.id);
    await idle(store);
    expect(store.getState().run).toMatchObject({
      status: 'IN_BATTLE',
      currentEncounterId: 'ascent_02_watchtower',
    });
    expect(ownedFor(store.getState().profile, 'mage', DEFAULT_CONTENT)(offer.cardId)).toBe(owned + 1);
    expect(store.getState().screen).toBe('BATTLE');
    store.getState().continueRun();
    expect(store.getState().state?.scenarioId).toBe('ascent_02_watchtower');
    // QA encounter jumps are guest-only.
    expect(await store.getState().startRun(1, 'ascent_10_colossus')).toBe(false);
  }, 60_000);

  it('an expired session falls back to guest; an unreachable server keeps playing local and can reconnect', async () => {
    const expired = memoryStorage();
    expired.data.set('rpg-go-tactics:session', JSON.stringify({ token: 'gone', username: 'ana' }));
    const store = await boot(expired);
    await vi.waitFor(() =>
      expect(store.getState().account).toMatchObject({
        status: 'GUEST',
        message: expect.stringMatching(/venció/),
      }),
    );
    expect(expired.data.has('rpg-go-tactics:session')).toBe(false);

    const device = memoryStorage();
    const first = await boot(device);
    await first.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(first.getState().account.status).toBe('READY'));
    online = false;
    const offline = await boot(device);
    await vi.waitFor(() => expect(offline.getState().account.status).toBe('OFFLINE'));
    expect(device.data.has('rpg-go-tactics:session')).toBe(true);
    online = true;
    offline.getState().retryCloud();
    await vi.waitFor(() => expect(offline.getState().account.status).toBe('READY'));
  });
});

describe('one-time account setup', () => {
  it('registration defers session, cloud profile and guest import until acknowledgement', async () => {
    const device = memoryStorage();
    device.data.set('rpg-go-tactics:profile', serializeProfile(createProfile(DEFAULT_CONTENT)));
    const store = await boot(device);
    const result = await store.getState().register('new_qa', 'test-password', 'test-challenge');
    expect(result).toEqual({ recoveryCode: 'TEST-TEST-TEST-TEST-TEST' });
    expect(store.getState().account.status).toBe('GUEST');
    expect(device.data.has('rpg-go-tactics:session')).toBe(false);
    expect(requests.filter((r) => r.includes(API))).toEqual([]);
    expect(JSON.stringify([...device.data])).not.toContain('TEST-TEST');
    await store.getState().finishAccountSetup();
    expect(store.getState().account.status).toBe('NEEDS_IMPORT');
    await store.getState().resolveImport('IMPORT');
    expect(store.getState().account.status).toBe('READY');
    expect(JSON.stringify(store.getState())).not.toContain('TEST-TEST');
  });
  it('recovery uses the existing contract and requires saving the replacement code before connecting', async () => {
    const device = memoryStorage();
    const store = await boot(device);
    expect(await store.getState().recoverAccount('ana', 'OLD-CODE', 'new-password')).toEqual({
      recoveryCode: 'NEW1-NEW2-NEW3-NEW4-NEW5',
    });
    expect(device.data.size).toBe(0);
    expect(store.getState().account.status).toBe('GUEST');
    await store.getState().finishAccountSetup();
    expect(store.getState().account.status).toBe('READY');
    expect(JSON.stringify([...device.data])).not.toContain('NEW1');
    await store.getState().signOut();
    expect(store.getState()).toMatchObject({
      account: { status: 'GUEST' },
      screen: 'MENU',
      engine: null,
      state: null,
      onlineCommand: null,
    });
    expect(device.data.size).toBe(0);
  });
  it('an in-flight cloud write cannot repopulate private state after logout', async () => {
    const device = memoryStorage();
    const store = await boot(device);
    await store.getState().signIn('ana', 'pw-ana');
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/decks/')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : fakeFetch(input, init),
    );
    const saved = store.getState().saveDeck('mage', starterDeck(mage));
    await store.getState().signOut();
    release(
      Response.json({
        user: { id: 1, username: 'ana' },
        hasProfile: true,
        profile: { ...createProfile(DEFAULT_CONTENT), selectedChampionId: 'summoner' },
        run: null,
      }),
    );
    await saved;
    expect(store.getState().account.status).toBe('GUEST');
    expect(store.getState().profile.selectedChampionId).toBe('mage');
    expect(device.data.has('rpg-go-tactics:session')).toBe(false);
  });
});

describe('expiry boundaries', () => {
  it('clears interrupted cloud PvE presentation and preserves the guest save', async () => {
    const device = memoryStorage();
    const guest = serializeProfile({
      ...createProfile(DEFAULT_CONTENT),
      selectedChampionId: 'summoner',
    });
    device.data.set('rpg-go-tactics:profile', guest);
    const store = await boot(device);
    await store.getState().signIn('ana', 'pw-ana');
    await store.getState().resolveImport('FRESH');
    await store.getState().startScenario('first_blood', 1, 'mage');
    expect(store.getState().state).not.toBeNull();
    store.getState().sessionExpired();
    expect(store.getState()).toMatchObject({
      screen: 'MENU',
      state: null,
      engine: null,
      account: { status: 'GUEST' },
    });
    expect(device.data.get('rpg-go-tactics:profile')).toBe(guest);
    expect(device.data.has('rpg-go-tactics:session')).toBe(false);
  });
  it('keeps an active authoritative PvP presentation when reauthentication is required', async () => {
    const device = memoryStorage();
    const store = await boot(device);
    await store.getState().signIn('ana', 'pw-ana');
    await store.getState().startScenario('first_blood', 1, 'mage');
    const snapshot = store.getState().state;
    const send = vi.fn();
    store.setState({ onlineCommand: send });
    store.getState().sessionExpired();
    expect(store.getState().state).toBe(snapshot);
    expect(store.getState().onlineCommand).toBe(send);
    expect(store.getState().screen).toBe('BATTLE');
    expect(store.getState().account).toMatchObject({
      status: 'GUEST',
      message: expect.stringMatching(/iniciar sesión/),
    });
    expect(device.data.has('rpg-go-tactics:session')).toBe(false);
  });
});

describe('pending campaign victory recovery', () => {
  for (const committed of [false, true]) {
    it(`recovers a lost ${committed ? 'committed response' : 'submission'} on reload without another battle`, async () => {
      const device = memoryStorage();
      let store = await boot(device);
      await store.getState().signIn('ana', 'pw-ana');
      await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
      await store.getState().startRun();
      if (committed) loseVictoryResponse = true;
      else online = false;
      for (let i = 0; i < 40; i++) {
        playBattle(store.getState().engine!);
        await idle(store);
        if (store.getState().state?.outcome?.result === 'WON') break;
        store.getState().restart();
      }
      expect(store.getState().state?.outcome?.result).toBe('WON');
      expect(store.getState().cloud.canRetry).toBe(true);
      expect(store.getState().run!.completedEncounterIds).toHaveLength(0);
      expect(device.data.has('rpg-go-tactics:pending-victory:ana')).toBe(true);
      online = true;
      store = await boot(device);
      await vi.waitFor(() => expect(store.getState().run!.completedEncounterIds).toHaveLength(1));
      await vi.waitFor(() => expect(device.data.has('rpg-go-tactics:pending-victory:ana')).toBe(false));
      expect(db.sql.prepare("SELECT count(*) AS n FROM tactics_reward_log WHERE event IN ('OFFERED','NO_DROP')").get()).toEqual({ n: 1 });
    }, 60000);
  }
});

describe('multi-champion campaign through the cloud', () => {
  it('the Summoner run is played, verified and rewarded on the server without touching the Mage run', async () => {
    serverSummoner = true;
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    const device = memoryStorage();
    let store = await boot(device);
    await store.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    expect(await store.getState().startRun()).toBe(true); // Mage
    store.getState().backToMenu();
    const mageRun = store.getState().runs.mage;

    store.getState().selectCampaignHero('summoner');
    expect(await store.getState().startRun()).toBe(true);
    expect(store.getState().run).toMatchObject({ heroId: 'summoner', seed: SERVER_SEED });
    expect(requests.at(-1)).toContain('/campaign/start');
    for (let i = 0; i < 40 && store.getState().run!.status === 'IN_BATTLE'; i++) {
      store.getState().restart();
      playBattle(store.getState().engine!, 30);
      await idle(store);
    }
    const run = store.getState().run!;
    expect(run).toMatchObject({ heroId: 'summoner', completedEncounterIds: ['ascent_01_outpost'] });
    if (run.status === 'CHOOSING_REWARD') {
      store.getState().chooseReward(run.rewardOptions[0]!.id);
      await idle(store);
    }
    expect(store.getState().run).toMatchObject({ heroId: 'summoner', status: 'IN_BATTLE', currentEncounterId: 'ascent_02_watchtower' });
    expect(store.getState().runs.mage).toEqual(mageRun);
    // Signed in, no guest slot is ever written.
    expect([...device.data.keys()].some((k) => k.startsWith('rpg-go-tactics:campaign:hero:'))).toBe(false);

    store = await boot(device); // reload on the same device
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    expect(store.getState().campaignHeroId).toBe('summoner');
    expect(store.getState().run).toMatchObject({ heroId: 'summoner', currentEncounterId: 'ascent_02_watchtower' });
    expect(store.getState().runs.mage).toEqual(mageRun);
  }, 90_000);

  it('a lost Summoner victory is recovered into the Summoner run on reload', async () => {
    serverSummoner = true;
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    const device = memoryStorage();
    let store = await boot(device);
    await store.getState().signIn('ana', 'pw-ana');
    await vi.waitFor(() => expect(store.getState().account.status).toBe('READY'));
    await store.getState().startRun(); // Mage run exists too
    store.getState().backToMenu();
    store.getState().selectCampaignHero('summoner');
    await store.getState().startRun();
    store.getState().selectCampaignHero('mage'); // ignored mid-battle
    expect(store.getState().campaignHeroId).toBe('summoner');
    loseVictoryResponse = true;
    for (let i = 0; i < 40; i++) {
      playBattle(store.getState().engine!, 30);
      await idle(store);
      if (store.getState().state?.outcome?.result === 'WON') break;
      store.getState().restart();
    }
    expect(store.getState().state?.outcome?.result).toBe('WON');
    expect(JSON.parse(device.data.get('rpg-go-tactics:pending-victory:ana')!)).toMatchObject({ heroId: 'summoner' });
    store = await boot(device);
    await vi.waitFor(() => expect(store.getState().runs.summoner!.completedEncounterIds).toHaveLength(1));
    expect(store.getState().runs.mage!.completedEncounterIds).toHaveLength(0);
  }, 90_000);
});
