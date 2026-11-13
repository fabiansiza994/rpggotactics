import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  COSMETICS,
  DEFAULT_CONTENT,
  GIFT_LIMITS,
  planGift,
  STORE_CATALOG,
  DECK_RULES,
  type PlayerProfile,
  type StoreOffer,
} from '../src/game';
import { handle } from '../server/src/index';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const NOW = 1_800_000_000_000;
let now = NOW;
let ids = 0;
let db: ReturnType<typeof memoryD1>;
let pushes: { user: string; body: Json }[];

/** Test-only offers next to the real catalog (the real ones are what QA uses). */
const EXTRA: StoreOffer[] = [
  {
    ...STORE_CATALOG.find((o) => o.id === 'card_frost_nova')!,
    id: 'test_not_giftable',
    giftable: undefined,
  },
  {
    ...STORE_CATALOG.find((o) => o.id === 'card_frost_nova')!,
    id: 'test_expired',
    startAt: 1,
    endAt: NOW - 1,
  },
  {
    ...STORE_CATALOG.find((o) => o.id === 'card_summon_wolf')!,
    id: 'test_war_drake',
    title: 'Invocar Dragón de Guerra',
    contents: [{ kind: 'CARD', cardId: 'summon_war_drake', copies: 1 }],
  },
];
const CATALOG = [...STORE_CATALOG, ...EXTRA];

const hubs = () => ({
  idFromName: (name: string) => name,
  get: (name: unknown) => ({
    fetch: async (r: Request) => {
      pushes.push({ user: String(name), body: JSON.parse(await r.text()) });
      return new Response('{}');
    },
  }),
});
/** Production release state (Warrior + rituals public) with a live social hub. */
const RELEASED = (): Partial<Env> => ({
  WARRIOR_ENABLED: '1',
  SUMMONER_RITUALS_ENABLED: '1',
  SOCIAL_HUBS: hubs() as never,
});
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  store: {
    catalog: CATALOG,
    cosmetics: COSMETICS,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  },
});

async function call(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  env: Partial<Env> = RELEASED(),
) {
  // Modern test client: explicitly obtains the quote before confirming a new gift.
  // A quoteToken property (even undefined) opts out for old-client/rejection scenarios.
  if (method === 'POST' && path === '/store/gifts' && body && typeof body === 'object' && !('quoteToken' in body)) {
    const input = body as {productId:string;recipientUsername:string};
    const quote = await call(token,'POST','/store/gifts/quote',{productId:input.productId,recipientUsername:input.recipientUsername},env);
    body = {...body,...(quote.status===200 ? {quoteToken:quote.body.purchaseQuote.token} : {})};
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.test/api/tactics${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handle(req, { DB: db, STORE_QUOTE_SECRET:'disposable-gift-quote-fixture-not-a-production-secret', ...env } as Env, deps());
  return { status: res.status, body: (await res.json()) as Json, cacheControl:res.headers.get('Cache-Control') };
}

interface Player {
  id: number;
  token: string;
  name: string;
}
async function player(name: string, crystals = 0): Promise<Player> {
  const account = addAccount(db, name);
  expect((await call(account.token, 'POST', '/profile', {})).status).toBe(200);
  if (crystals) grant(account.id, crystals);
  return { ...account, name };
}
function grant(userId: number, amount: number) {
  db.sql
    .prepare(
      `INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at)
       SELECT ?, ?, 'arcane_crystals', ?, b, b + ?, 'QA_GRANT', ?, 0 FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'), 0) AS b)`,
    )
    .run(`qa-${++ids}`, userId, amount, amount, `qa-${ids}`, userId);
}
async function befriend(a: Player, b: Player) {
  expect((await call(a.token, 'POST', '/social/requests', { username: b.name })).status).toBe(200);
  expect(
    (await call(b.token, 'POST', '/social/requests/accept', { username: a.name })).status,
  ).toBe(200);
}
const balance = async (p: Player) =>
  (await call(p.token, 'GET', '/wallet')).body.wallet.balance as number;
const profileOf = async (p: Player) =>
  (await call(p.token, 'GET', '/state')).body.profile as PlayerProfile;
const copies = (profile: PlayerProfile, heroId: string, cardId: string) =>
  profile.heroes[heroId]!.collection[cardId]?.copies ?? 0;
function own(userId: number, heroId: string, cardId: string, n: number) {
  db.sql
    .prepare(
      `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, 99, 'QA_BALANCE', 0)
       ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = excluded.copies`,
    )
    .run(userId, heroId, cardId, n);
}
const ledger = (userId: number) =>
  db.sql
    .prepare(
      'SELECT reason, amount_delta, reference_id, note FROM tactics_wallet_ledger WHERE user_id = ? AND reason <> ? ORDER BY id',
    )
    .all(userId, 'QA_GRANT') as Json[];
const giftRows = () =>
  db.sql.prepare('SELECT * FROM tactics_gifts ORDER BY created_at, gift_id').all() as Json[];

let keyN = 0;
const key = () => `gift-key-${String(++keyN).padStart(4, '0')}`;
const send = (
  from: Player,
  productId: string,
  recipientUsername: unknown,
  extra: Record<string, unknown> = {},
  env?: Partial<Env>,
) =>
  call(
    from.token,
    'POST',
    '/store/gifts',
    { productId, recipientUsername, idempotencyKey: key(), ...extra },
    env,
  );
const claim = (p: Player, giftId: string, env?: Partial<Env>) =>
  call(p.token, 'POST', `/store/gifts/${giftId}/claim`, {}, env);

let ana: Player;
let bruno: Player;

beforeEach(async () => {
  db = memoryD1({ legacyProfiles: true });
  for (const f of [
    '0004_pvp.sql',
    '0005_pvp_dominion.sql',
    '0006_pvp_maps.sql',
    '0009_tactics_social.sql',
    '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql',
    '0015_tactics_store_gifts.sql',
  ])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  now = NOW;
  pushes = [];
  ana = await player('ana', 2000);
  bruno = await player('bruno');
  await befriend(ana, bruno);
  pushes = [];
});

describe('gift quote safety',()=>{
  it('does not cache a personalized gift quote',async()=>{expect((await call(ana.token,'POST','/store/gifts/quote',{productId:'card_glacial_shell',recipientUsername:'bruno'})).cacheControl).toBe('private, no-store');});
  it('old tabs cannot send a new gift without a signed quote',async()=>{
    const before=await balance(ana);const r=await send(ana,'card_glacial_shell','bruno',{quoteToken:undefined});
    expect(r.status).toBe(426);expect(r.body.error.code).toBe('QUOTE_REQUIRED');expect(await balance(ana)).toBe(before);expect(giftRows()).toEqual([]);
  });
  it('expired and manipulated gift quotes never debit or deliver',async()=>{
    const q=await call(ana.token,'POST','/store/gifts/quote',{productId:'card_glacial_shell',recipientUsername:'bruno'});
    const token=q.body.purchaseQuote.token;const before=await balance(ana);
    expect((await send(ana,'card_glacial_shell','bruno',{quoteToken:token+'x'})).body.error.code).toBe('QUOTE_INVALID');
    now=q.body.purchaseQuote.expiresAt;
    expect((await send(ana,'card_glacial_shell','bruno',{quoteToken:token})).body.error.code).toBe('QUOTE_EXPIRED');
    expect(await balance(ana)).toBe(before);expect(giftRows()).toEqual([]);expect(copies(await profileOf(bruno),'mage','glacial_shell')).toBe(0);
  });
  it('binds confirmation to its recipient and separates self-purchase from gift quotes',async()=>{
    const q=await call(ana.token,'POST','/store/gifts/quote',{productId:'card_glacial_shell',recipientUsername:'bruno'});
    const carla=await player('carla');await befriend(ana,carla);
    expect((await send(ana,'card_glacial_shell','carla',{quoteToken:q.body.purchaseQuote.token})).body.error.code).toBe('QUOTE_INVALID');
    const cat=await call(ana.token,'GET','/store/catalog');const self=cat.body.offers.find((o:Json)=>o.id==='card_glacial_shell');
    expect((await send(ana,'card_glacial_shell','bruno',{quoteToken:self.purchaseQuote.token})).body.error.code).toBe('QUOTE_INVALID');
    expect(giftRows()).toEqual([]);expect(await balance(ana)).toBe(2000);
  });
  it('a changed gift price requires a fresh explicit confirmation at the same receipt key',async()=>{
    const q=await call(ana.token,'POST','/store/gifts/quote',{productId:'card_glacial_shell',recipientUsername:'bruno'});
    const o=CATALOG.find(o=>o.id==='card_glacial_shell')!,original=o.price;
    try{
      o.price=original+10;
      const rejected=await send(ana,o.id,'bruno',{quoteToken:q.body.purchaseQuote.token,idempotencyKey:'gift-requote-01'});
      expect(rejected.body.error.code).toBe('QUOTE_CHANGED');expect(await balance(ana)).toBe(2000);expect(giftRows()).toEqual([]);
      const fresh=await call(ana.token,'POST','/store/gifts/quote',{productId:o.id,recipientUsername:'bruno'});
      const accepted=await send(ana,o.id,'bruno',{quoteToken:fresh.body.purchaseQuote.token,idempotencyKey:'gift-requote-01'});
      expect(accepted.status).toBe(200);expect(accepted.body.gift.price).toBe(original+10);
    }finally{o.price=original;}
  });
  it('confirmed gifts recover before missing or expired quote validation',async()=>{
    const first=await send(ana,'card_glacial_shell','bruno',{idempotencyKey:'gift-recovery-01'});expect(first.status).toBe(200);
    now+=600_000;const before=await balance(ana);
    const retry=await send(ana,'card_glacial_shell','bruno',{idempotencyKey:'gift-recovery-01',quoteToken:undefined});
    expect(retry.status).toBe(200);expect(retry.body.replayed).toBe(true);expect(retry.body.gift.giftId).toBe(first.body.gift.giftId);expect(await balance(ana)).toBe(before);expect(giftRows()).toHaveLength(1);
  });
});

describe('buying a gift', () => {
  it.each(
    STORE_CATALOG.filter((o) => o.type === 'CHAMPION_PACK' && o.tags.includes('premium')).map(
      (o) => o.id,
    ),
  )('released premium pack %s quotes, notifies and claims once', async (productId) => {
    const env = {
      ...RELEASED(),
      ARSENAL_CARDS_ENABLED: '1',
      TACTICAL_CARDS_ENABLED: '1',
      STORE_SHOWCASE_ENABLED: '1',
      WORLD_2_ENABLED: '1',
    };
    const quote = await call(
      ana.token,
      'POST',
      '/store/gifts/quote',
      { productId, recipientUsername: 'bruno' },
      env,
    );
    expect(quote.status).toBe(200);
    const sent = await call(
      ana.token,
      'POST',
      '/store/gifts',
      { productId, recipientUsername: 'bruno', idempotencyKey: 'premium-gift-qa' },
      env,
    );
    expect(sent.status).toBe(200);
    expect(sent.body.gift.price).toBe(quote.body.price);
    expect(pushes.some((p) => p.body.event === 'GIFT_RECEIVED')).toBe(true);
    const giftId = sent.body.gift.giftId;
    expect((await claim(bruno, giftId, env)).status).toBe(200);
    expect((await claim(bruno, giftId, env)).status).toBe(200);
    const offer = STORE_CATALOG.find((o) => o.id === productId)!;
    expect(copies(await profileOf(bruno), offer.heroId!, offer.featuredCardId!)).toBe(1);
    expect(ledger(ana.id)).toHaveLength(1);
  });
  it('charges the sender once, creates a PENDING gift and notifies the recipient', async () => {
    const res = await send(ana, 'card_glacial_shell', 'bruno');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      replayed: false,
      wallet: { balance: 1750 },
      gift: {
        status: 'PENDING',
        productId: 'card_glacial_shell',
        productName: 'Glacial Shell',
        recipientUsername: 'bruno',
        price: 250,
        rarity: 'RARE',
      },
    });
    const giftId = res.body.gift.giftId as string;
    expect(ledger(ana.id)).toEqual([
      {
        reason: 'STORE_GIFT_PURCHASE',
        amount_delta: -250,
        reference_id: giftId,
        note: 'card_glacial_shell',
      },
    ]);
    expect(giftRows()).toMatchObject([
      {
        gift_id: giftId,
        sender_user_id: ana.id,
        recipient_user_id: bruno.id,
        status: 'PENDING',
        price_snapshot: 250,
        claimed_at: null,
      },
    ]);
    // Not granted yet: the recipient opens it first.
    expect(copies(await profileOf(bruno), 'mage', 'glacial_shell')).toBe(0);
    expect(await balance(bruno)).toBe(0);
    // Notification: who + what to show, no ids, prices or reward internals.
    expect(pushes).toEqual([
      {
        user: `user:${bruno.id}`,
        body: {
          type: 'social',
          event: 'GIFT_RECEIVED',
          gift: {
            giftId,
            senderUsername: 'ana',
            productName: 'Glacial Shell',
            artId: 'card_glacial_shell',
            createdAt: NOW,
          },
        },
      },
    ]);
    expect((await call(bruno.token, 'GET', '/social/overview')).body.counts.gifts).toBe(1);
    expect((await call(ana.token, 'GET', '/social/overview')).body.counts.gifts).toBe(0);
  });

  it('a double click / retry with the same key returns the same gift and charges once', async () => {
    const body = {
      productId: 'card_frost_nova',
      recipientUsername: 'bruno',
      idempotencyKey: 'same-key-123',
    };
    const [a, b] = await Promise.all([
      call(ana.token, 'POST', '/store/gifts', body),
      call(ana.token, 'POST', '/store/gifts', body),
    ]);
    const again = await call(ana.token, 'POST', '/store/gifts', body);
    expect([a.status, b.status, again.status]).toEqual([200, 200, 200]);
    expect(new Set([a.body.gift.giftId, b.body.gift.giftId, again.body.gift.giftId]).size).toBe(1);
    expect(again.body.replayed).toBe(true);
    expect(giftRows()).toHaveLength(1);
    expect(ledger(ana.id)).toHaveLength(1);
    expect(await balance(ana)).toBe(1850);
    // The same key for a different product or recipient is refused, not silently reused.
    expect(
      (await call(ana.token, 'POST', '/store/gifts', { ...body, productId: 'card_glacial_shell' }))
        .body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    // Keys are per sender: another sender may use the same text.
    const carla = await player('carla', 500);
    await befriend(carla, bruno);
    expect((await call(carla.token, 'POST', '/store/gifts', body)).status).toBe(200);
  });

  it('ignores forged price, reward, sender and recipient ids', async () => {
    const carla = await player('carla');
    const res = await send(ana, 'card_glacial_shell', 'bruno', {
      price: 1,
      amount: 1,
      contents: [{ kind: 'CARD', cardId: 'execution', copies: 9 }],
      cardId: 'execution',
      cosmeticId: 'frame_arcane_gilt',
      recipientId: carla.id,
      senderId: bruno.id,
      userId: bruno.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.gift).toMatchObject({
      price: 250,
      recipientUsername: 'bruno',
      rewardSummary: [{ kind: 'CARD', id: 'glacial_shell', amount: 1 }],
    });
    expect(await balance(ana)).toBe(1750);
    expect(giftRows()[0]).toMatchObject({ sender_user_id: ana.id, recipient_user_id: bruno.id });
  });

  it('refuses self, unknown, non-friends and blocked users without charging', async () => {
    const carla = await player('carla');
    expect((await send(ana, 'card_frost_nova', 'ANA ')).body.error.code).toBe('CANNOT_GIFT_SELF');
    expect((await send(ana, 'card_frost_nova', 'nobody')).body.error.code).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    addAccount(db, 'noprofile');
    expect((await send(ana, 'card_frost_nova', 'noprofile')).body.error.code).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    expect((await send(ana, 'card_frost_nova', 'carla')).body.error.code).toBe('NOT_FRIENDS');
    // Pending friend request is not a friendship.
    await call(ana.token, 'POST', '/social/requests', { username: 'carla' });
    expect((await send(ana, 'card_frost_nova', 'carla')).body.error.code).toBe('NOT_FRIENDS');
    // Blocked by the recipient: reads as NOT_FRIENDS (the block itself is never revealed).
    await call(bruno.token, 'POST', '/social/block', { username: 'ana' });
    expect((await send(ana, 'card_frost_nova', 'bruno')).body.error.code).toBe('NOT_FRIENDS');
    // Blocked by the sender: named.
    now += 61_000; // past the per-minute send window
    expect(
      (await call(carla.token, 'POST', '/social/requests/accept', { username: 'ana' })).status,
    ).toBe(200);
    await call(ana.token, 'POST', '/social/block', { username: 'carla' });
    expect((await send(ana, 'card_frost_nova', 'carla')).body.error.code).toBe('USER_BLOCKED');
    expect(await balance(ana)).toBe(2000);
    expect(giftRows()).toEqual([]);
    expect(pushes.filter((p) => p.body.event === 'GIFT_RECEIVED')).toEqual([]);
  });

  it('refuses unknown, non-giftable and inactive products, and insufficient funds', async () => {
    expect((await send(ana, 'card_nope', 'bruno')).body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await send(ana, 'test_not_giftable', 'bruno')).body.error.code).toBe('NOT_GIFTABLE');
    expect((await send(ana, 'test_expired', 'bruno')).body.error.code).toBe('PRODUCT_INACTIVE');
    const poor = await player('poor', 100);
    await befriend(poor, bruno);
    const res = await send(poor, 'card_glacial_shell', 'bruno');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', balance: 100, price: 250 });
    expect(await balance(poor)).toBe(100);
    expect(giftRows()).toEqual([]);
  });

  it('allows owned and pending card copies while preserving gift limits and charges', async () => {
    own(bruno.id, 'mage', 'frost_nova', 2);
    expect((await send(ana,'card_frost_nova','bruno')).status).toBe(200);
    expect((await send(ana,'card_glacial_shell','bruno')).status).toBe(200);
    expect((await send(ana,'card_glacial_shell','bruno')).status).toBe(200);
    const carla = await player('carla',500); await befriend(carla,bruno);
    expect((await send(carla,'card_glacial_shell','bruno')).status).toBe(200);
    expect(await balance(ana)).toBe(1350);
    expect(await balance(carla)).toBe(250);
  });

  it('two independently purchased card gifts both survive concurrent acquisition', async () => {
    const carla = await player('carla',500); await befriend(carla,bruno);
    const results = await Promise.all([send(ana,'card_glacial_shell','bruno'),send(carla,'card_glacial_shell','bruno')]);
    expect(results.map(r=>r.status)).toEqual([200,200]);
    expect(giftRows()).toHaveLength(2);
    expect((await balance(ana))+(await balance(carla))).toBe(2000);
  });

  it('refuses a cosmetic the recipient owns or is already being gifted', async () => {
    db.sql
      .prepare(
        "INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, acquired_at) VALUES (?, 'frame_arcane_gilt', 'PROFILE_FRAME', 'STORE_PURCHASE', 0)",
      )
      .run(bruno.id);
    expect((await send(ana, 'cosmetic_frame_arcane_gilt', 'bruno')).body.error.code).toBe(
      'RECIPIENT_ALREADY_OWNS',
    );
    expect((await send(ana, 'cosmetic_frame_pact_grove', 'bruno')).status).toBe(200);
    // purchaseLimit 1 + the pending gift → the pack/frame is refused (not double-sold).
    expect((await send(ana, 'cosmetic_frame_pact_grove', 'bruno')).body.error.code).toMatch(
      /RECIPIENT_(ALREADY_OWNS|LIMIT_REACHED)/,
    );
    expect(await balance(ana)).toBe(1700);
  });

  it('card ownership does not prorate a gift or its catalog price', async () => {
    own(bruno.id,'mage','frost_nova',2);
    const own_ = (await call(bruno.token,'GET','/store/catalog')).body.offers.find((o:Json)=>o.id==='pack_mage_glacial_control');
    expect(own_.price).toBe(own_.basePrice);
    expect((await send(ana,'pack_mage_glacial_control','bruno')).status).toBe(200);
    expect(await balance(ana)).toBe(2000-own_.price);
  });

  it('respects champion and content release gates of the recipient', async () => {
    // Warrior QA-only: the QA sender sees the pack, the recipient may not receive it.
    const qa = await player('tactics_qa_a', 2000);
    await befriend(qa, bruno);
    const env = { WARRIOR_QA: '1', SUMMONER_RITUALS_ENABLED: '1', SOCIAL_HUBS: hubs() as never };
    expect(
      (await send(qa, 'pack_warrior_executioner_oath', 'bruno', {}, env)).body.error.code,
    ).toBe('RECIPIENT_CANNOT_RECEIVE');
    // A non-QA sender does not even see the offer.
    expect(
      (await send(bruno, 'pack_warrior_executioner_oath', 'tactics_qa_a', {}, env)).body.error.code,
    ).toBe('PRODUCT_NOT_FOUND');
    // Ritual set unreleased: the store does not even list an offer holding its cards (never sold early).
    expect(
      (await send(ana, 'test_war_drake', 'bruno', {}, { SOCIAL_HUBS: hubs() as never })).body.error
        .code,
    ).toBe('PRODUCT_NOT_FOUND');
    expect((await send(ana, 'test_war_drake', 'bruno')).status).toBe(200);
  });

  it('sanitises the optional note and refuses an oversized one', async () => {
    const zw = String.fromCharCode(0x200b);
    const ok = await send(ana, 'card_frost_nova', 'bruno', {
      message: `  Para que pruebes${zw}\n el Dragón 😎  `,
    });
    expect(ok.body.gift.message).toBe('Para que pruebes el Dragón 😎');
    expect(
      (await send(ana, 'card_frost_nova', 'bruno', { message: 'x'.repeat(121) })).body.error.code,
    ).toBe('BAD_MESSAGE');
    expect(
      (await send(ana, 'card_frost_nova', 'bruno', { message: { html: '<b>' } })).body.error.code,
    ).toBe('BAD_MESSAGE');
    expect((await send(ana, 'card_frost_nova', 'bruno', { message: '   ' })).status).toBe(200);
  });

  it('limits pending gifts per friend, daily sends and request bursts', async () => {
    // Pending per pair (seeded rows stand in for earlier gifts).
    for (let i = 0; i < GIFT_LIMITS.pendingPerPair; i++)
      db.sql
        .prepare(
          `INSERT INTO tactics_gifts (gift_id, sender_user_id, recipient_user_id, idempotency_key, product_id, status, currency_id, price_snapshot, reward_snapshot, transaction_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'card_entangle', 'PENDING', 'arcane_crystals', 100, '{}', ?, ?, ?)`,
        )
        .run(
          `gft_seed_${i}`,
          ana.id,
          bruno.id,
          `seed-key-${i}`,
          `txn-seed-${i}`,
          NOW - 2 * 86_400_000,
          NOW,
        );
    expect((await send(ana, 'card_frost_nova', 'bruno')).body.error.code).toBe(
      'GIFT_LIMIT_REACHED',
    );
    // Burst: the 7th send in a minute is rate limited, whatever its outcome.
    now += 120_000;
    const codes: string[] = [];
    for (let i = 0; i < 7; i++)
      codes.push((await send(ana, 'card_frost_nova', 'bruno')).body.error?.code);
    expect(codes.at(-1)).toBe('RATE_LIMITED');
    expect(await balance(ana)).toBe(2000);
  });

  it('quote validates without charging', async () => {
    const q = await call(ana.token, 'POST', '/store/gifts/quote', {
      productId: 'pack_warrior_executioner_oath',
      recipientUsername: 'bruno',
    });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({
      productName: 'Juramento del Verdugo',
      recipientUsername: 'bruno',
      price: 680,
      balance: 2000,
    });
    expect(q.body.rewardSummary.map((l: Json) => l.id)).toEqual([
      'execution',
      'ram',
      'grapple',
      'frame_executioner_oath',
    ]);
    expect(
      (
        await call(ana.token, 'POST', '/store/gifts/quote', {
          productId: 'card_frost_nova',
          recipientUsername: 'ana',
        })
      ).body.error.code,
    ).toBe('CANNOT_GIFT_SELF');
    expect(giftRows()).toEqual([]);
    expect(await balance(ana)).toBe(2000);
  });
});

describe('claiming a gift', () => {
  async function gifted(productId = 'card_glacial_shell') {
    const res = await send(ana, productId, 'bruno');
    expect(res.status).toBe(200);
    return res.body.gift.giftId as string;
  }

  it('the recipient sees who sent it, claims it once, and it lands in the collection', async () => {
    const giftId = await gifted();
    const inbox = await call(bruno.token, 'GET', '/store/gifts/received');
    expect(inbox.body.pending).toBe(1);
    expect(inbox.body.gifts[0]).toMatchObject({
      giftId,
      senderUsername: 'ana',
      productName: 'Glacial Shell',
      status: 'PENDING',
      claimable: true,
      artId: 'card_glacial_shell',
    });
    // The recipient does not see the price; no user ids anywhere.
    expect(inbox.body.gifts[0]).not.toHaveProperty('price');
    expect(JSON.stringify(inbox.body)).not.toMatch(/"(sender|recipient)(_user)?_?[iI]d"/);
    // Opening (GET) does not claim.
    expect((await call(bruno.token, 'GET', `/store/gifts/${giftId}`)).body.gift.status).toBe(
      'PENDING',
    );

    const first = await claim(bruno, giftId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      replayed: false,
      gift: { status: 'CLAIMED', claimedAt: NOW },
    });
    expect(copies(first.body.profile, 'mage', 'glacial_shell')).toBe(1);
    const second = await claim(bruno, giftId);
    expect(second.body).toMatchObject({ replayed: true, gift: { status: 'CLAIMED' } });
    expect(copies(await profileOf(bruno), 'mage', 'glacial_shell')).toBe(1);
    expect(
      db.sql
        .prepare('SELECT source FROM tactics_player_cards WHERE user_id = ? AND card_id = ?')
        .get(bruno.id, 'glacial_shell'),
    ).toEqual({ source: 'STORE_GIFT' });
    expect((await call(bruno.token, 'GET', '/social/overview')).body.counts.gifts).toBe(0);
    // Gifts never touch the recipient's wallet or ledger.
    expect(ledger(bruno.id)).toEqual([]);
  });

  it('concurrent claims grant once', async () => {
    const giftId = await gifted('card_frost_nova');
    const results = await Promise.all([
      claim(bruno, giftId),
      claim(bruno, giftId),
      claim(bruno, giftId),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
    expect(copies(await profileOf(bruno), 'mage', 'frost_nova')).toBe(1);
  });

  it('only the recipient can open or claim; others get GIFT_NOT_FOUND', async () => {
    const giftId = await gifted();
    const carla = await player('carla');
    expect((await claim(ana, giftId)).body.error.code).toBe('GIFT_NOT_FOUND');
    expect((await claim(carla, giftId)).body.error.code).toBe('GIFT_NOT_FOUND');
    expect((await call(carla.token, 'GET', `/store/gifts/${giftId}`)).body.error.code).toBe(
      'GIFT_NOT_FOUND',
    );
    // The sender may view their own sent gift (with price), never claim it.
    expect((await call(ana.token, 'GET', `/store/gifts/${giftId}`)).body.gift).toMatchObject({
      recipientUsername: 'bruno',
      price: 250,
    });
    expect((await call(carla.token, 'GET', '/store/gifts/received')).body.gifts).toEqual([]);
    expect((await call(null, 'GET', '/store/gifts/received')).status).toBe(401);
    expect((await call('forged-token', 'POST', `/store/gifts/${giftId}/claim`)).status).toBe(401);
    expect(copies(await profileOf(bruno), 'mage', 'glacial_shell')).toBe(0);
  });

  it('a card acquired while its gift waits does not prevent the legitimate gift claim', async () => {
    const giftId = await gifted();
    own(bruno.id,'mage','glacial_shell',1);
    expect((await claim(bruno,giftId)).status).toBe(200);
    expect(giftRows()[0]!.status).toBe('CLAIMED');
    expect(copies(await profileOf(bruno),'mage','glacial_shell')).toBe(2);
    await claim(bruno,giftId);
    expect(copies(await profileOf(bruno),'mage','glacial_shell')).toBe(2);
    expect(await balance(bruno)).toBe(0);
  });

  it('a bundle is granted whole or not at all (cards + cosmetic)', async () => {
    const giftId = await gifted('pack_warrior_executioner_oath');
    expect(await balance(ana)).toBe(1320);
    // One line becomes impossible → nothing of the bundle is granted.
    db.sql
      .prepare(
        "INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, acquired_at) VALUES (?, 'frame_executioner_oath', 'PROFILE_FRAME', 'STORE_PURCHASE', 0)",
      )
      .run(bruno.id);
    expect((await claim(bruno, giftId)).body.error.reason).toBe('RECIPIENT_ALREADY_OWNS');
    const before = await profileOf(bruno);
    expect(['execution', 'ram', 'grapple'].map((c) => copies(before, 'warrior', c))).toEqual([
      0, 0, 0,
    ]);
    // Room again (support removed the duplicate frame) → everything lands together.
    db.sql.prepare('DELETE FROM tactics_player_cosmetics WHERE user_id = ?').run(bruno.id);
    const ok = await claim(bruno, giftId);
    expect(ok.status).toBe(200);
    expect(
      ['execution', 'ram', 'grapple'].map((c) => copies(ok.body.profile, 'warrior', c)),
    ).toEqual([1, 1, 1]);
    expect(
      db.sql
        .prepare(
          'SELECT cosmetic_id, source, reference_id FROM tactics_player_cosmetics WHERE user_id = ?',
        )
        .all(bruno.id),
    ).toEqual([
      { cosmetic_id: 'frame_executioner_oath', source: 'STORE_GIFT', reference_id: giftId },
    ]);
  });

  it('an offline recipient finds it after logging in again; it persists across reloads', async () => {
    const giftId = (await send(ana, 'card_frost_nova', 'bruno', {}, { WARRIOR_ENABLED: '1' })).body
      .gift.giftId; // no hub: nobody online
    db.sql.prepare('DELETE FROM sessions WHERE username = ?').run('bruno');
    db.sql
      .prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, 0, ?)')
      .run('token-bruno-2', 'bruno', 4_000_000_000_000);
    const relogged = { ...bruno, token: 'token-bruno-2' };
    expect((await call(relogged.token, 'GET', '/social/overview')).body.counts.gifts).toBe(1);
    expect((await claim(relogged, giftId)).status).toBe(200);
    expect(copies(await profileOf(relogged), 'mage', 'frost_nova')).toBe(1);
    expect(
      (await call(relogged.token, 'GET', '/store/gifts/received')).body.gifts[0],
    ).toMatchObject({ status: 'CLAIMED' });
  });

  it('history: sent and received, each with only the other side’s username', async () => {
    await gifted();
    now += 1000;
    await gifted('card_frost_nova');
    const sent = await call(ana.token, 'GET', '/store/gifts/sent');
    expect(
      sent.body.gifts.map((g: Json) => [g.productId, g.recipientUsername, g.status, g.price]),
    ).toEqual([
      ['card_frost_nova', 'bruno', 'PENDING', 150],
      ['card_glacial_shell', 'bruno', 'PENDING', 250],
    ]);
    expect((await call(bruno.token, 'GET', '/store/gifts/sent')).body.gifts).toEqual([]);
    expect(
      (await call(bruno.token, 'GET', '/store/gifts/received')).body.gifts.map(
        (g: Json) => g.senderUsername,
      ),
    ).toEqual(['ana', 'ana']);
  });

  it('keeps the bought snapshot when the catalog changes, and survives the sender deleting the account', async () => {
    const giftId = await gifted();
    expect(() =>
      db.sql.prepare('UPDATE tactics_gifts SET price_snapshot = 1 WHERE gift_id = ?').run(giftId),
    ).toThrow(/immutable/);
    db.sql.prepare('DELETE FROM users WHERE id = ?').run(ana.id);
    const inbox = await call(bruno.token, 'GET', '/store/gifts/received');
    expect(inbox.body.gifts[0]).toMatchObject({
      senderUsername: 'Un jugador',
      productName: 'Glacial Shell',
      claimable: true,
    });
    expect((await claim(bruno, giftId)).status).toBe(200);
    // CLAIMED is final.
    expect(() =>
      db.sql.prepare("UPDATE tactics_gifts SET status = 'PENDING' WHERE gift_id = ?").run(giftId),
    ).toThrow(/immutable/);
  });
});

describe('input hardening', () => {
  it('SQL-like / oversized usernames, malformed ids and bodies never reach the database unchecked', async () => {
    expect((await send(ana, 'card_frost_nova', "bruno' OR '1'='1")).body.error.code).toBe(
      'RECIPIENT_NOT_FOUND',
    );
    expect((await send(ana, 'card_frost_nova', 'b'.repeat(33))).status).toBe(400);
    expect((await send(ana, 'card_frost_nova', 42)).status).toBe(400);
    expect((await send(ana, "card'; DROP TABLE tactics_gifts;--", 'bruno')).status).toBe(400);
    expect((await send(ana, 'card_frost_nova', 'bruno', { idempotencyKey: 'short' })).status).toBe(
      400,
    );
    expect((await call(ana.token, 'POST', '/store/gifts', '{not json')).status).toBe(400);
    expect(
      (await call(ana.token, 'POST', '/store/gifts', JSON.stringify({ pad: 'x'.repeat(300_000) })))
        .status,
    ).toBe(400);
    expect((await call(bruno.token, 'POST', "/store/gifts/gft_'x'/claim")).body.error.code).toBe(
      'GIFT_NOT_FOUND',
    );
    expect((await call(bruno.token, 'POST', '/store/gifts/../wallet/claim')).status).toBe(404);
    expect(giftRows()).toEqual([]);
    expect(await balance(ana)).toBe(2000);
  });
});

describe('planGift (pure)', () => {
  const ctx = { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS };
  const none = { copies: () => 0, hasCosmetic: () => false, purchases: () => 0 };
  it('prices at the catalog price and only for giftable offers', () => {
    const pack = STORE_CATALOG.find((o) => o.id === 'pack_warrior_executioner_oath')!;
    expect(planGift(pack, none, ctx, NOW)).toMatchObject({ ok: true, price: 680 });
    expect(planGift({ ...pack, giftable: false }, none, ctx, NOW)).toEqual({
      ok: false,
      reason: 'NOT_GIFTABLE',
    });
    expect(
      planGift({ ...pack, giftLimitPerRecipient: 1 }, { ...none, purchases: () => 1 }, ctx, NOW),
    ).toEqual({ ok: false, reason: 'RECIPIENT_LIMIT_REACHED' });
  });
  it('every real store offer is giftable and none contains an exclusive (world/promo) card', () => {
    for (const o of STORE_CATALOG) {
      expect(o.giftable, o.id).toBe(true);
      for (const c of o.contents)
        if (c.kind === 'CARD')
          expect(DEFAULT_CONTENT.cards[c.cardId]!.acquisition, o.id).toBeUndefined();
    }
  });
});
