import { describe, expect, it } from 'vitest';
import { marketFixture } from './support/marketReorg';
import { issueQuote } from '../server/src/storeQuote';
import { STORE_QUOTE_TEST_SECRET } from './support/storeQuote';
import { ARCANE_PACK_PRICE } from '../src/game/store/boosters';

describe('standard booster price cut with historical compatibility', () => {
  it('rejects signed old 200 terms without charging, then accepts current 50 terms', async () => {
    const f = await marketFixture();
    try {
      const offer = (await f.catalog()).offers.find((o: { id: string }) => o.id === 'booster_thunder_god_x1');
      expect(ARCANE_PACK_PRICE).toBe(50);
      const old = await issueQuote(STORE_QUOTE_TEST_SECRET, f.account.id, offer, { price: 200, contents: offer.contents }, Date.now());
      const r = await f.call('POST', '/store/purchase', { offerId: offer.id, idempotencyKey: 'old-price-quote', quoteToken: old.token, packRevision: offer.booster.revision, packFormat: 'GENERAL_BATCH_V1', boxFormat:'FINITE_BOX_V1' });
      expect(r.data.error.code).toBe('QUOTE_CHANGED');
      expect((await f.call('GET', '/wallet')).data.wallet.balance).toBe(30000);
      expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_store_purchases').get()?.n).toBe(0);
      const fresh = await f.buy(offer.id, 'new-price-quote');
      expect(fresh.status).toBe(200);
      expect(fresh.data.purchase.price).toBe(50);
      expect(fresh.data.wallet.balance).toBe(29950);
    } finally { f.db.sql.close(); }
  });
  it('recovers an old 200 receipt as stored without repricing or delivering twice', async () => {
    const f = await marketFixture();
    try {
      const offer = (await f.catalog()).offers.find((o: { id: string }) => o.id === 'booster_thunder_god_x1');
      const snapshot = { ...offer, price: 200 };
      const granted = { cards: [], cosmetics: [] };
      f.db.sql.prepare("INSERT INTO tactics_store_purchases VALUES('old-200-receipt',?,'old-200-key',?,'arcane_crystals',200,'COMPLETED',?,?,0,0)").run(f.account.id, offer.id, JSON.stringify(snapshot), JSON.stringify(granted));
      const before = (await f.call('GET', '/state')).data.profile;
      for (let i = 0; i < 2; i++) {
        const r = await f.call('POST', '/store/purchase', { offerId: offer.id, idempotencyKey: 'old-200-key', receiptOnly: true });
        expect(r.status).toBe(200);
        expect(r.data.replayed).toBe(true);
        expect(r.data.purchase.price).toBe(200);
        expect(r.data.purchase.granted).toEqual(granted);
        expect(r.data.wallet.balance).toBe(30000);
      }
      expect((await f.call('GET', '/state')).data.profile).toEqual(before);
      expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_store_purchases').get()?.n).toBe(1);
    } finally { f.db.sql.close(); }
  });
});
