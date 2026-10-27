import { describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import type { Env } from '../server/src/db';
import { memoryD1, addAccount } from './support/d1';
import { DEFAULT_CONTENT } from '../src/game';
describe('Premium cosmetic equip uses existing authoritative ownership', () => {
  it('refuses unowned/wrong slot, persists owned Showcase and back, and supports unequip', async () => {
    const db = memoryD1({ legacyProfiles: true });
    const a = addAccount(db, 'premium_cosmetic_qa');
    const env = { DB: db } as Env;
    const call = async (method: string, path: string, body?: unknown) =>
      handle(
        new Request(`https://api.test/api/tactics${path}`, {
          method,
          headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        { content: DEFAULT_CONTENT, now: () => 1800000000000, seed: () => 7 },
      );
    try {
      expect((await call('POST', '/profile', {})).status).toBe(200);
      const equip = (slot: string, cosmeticId: string | null) =>
        call('PUT', '/cosmetics/equip', { slot, cosmeticId });
      expect((await equip('CARD_BACK', 'cardback_premium_arcane_circle')).status).toBe(403);
      for (const [id, kind] of [
        ['cardback_premium_arcane_circle', 'CARD_BACK'],
        ['showcase_ash_eclipse', 'CARD_ART'],
      ] as const)
        db.sql
          .prepare(
            'INSERT INTO tactics_player_cosmetics (user_id,cosmetic_id,kind,source,acquired_at) VALUES (?,?,?,?,?)',
          )
          .run(a.id, id, kind, 'TEST', 1);
      expect((await equip('CARD_BACK', 'showcase_ash_eclipse')).status).toBe(400);
      expect((await equip('CARD_BACK', 'cardback_premium_arcane_circle')).status).toBe(200);
      expect((await equip('CARD_ART', 'showcase_ash_eclipse')).status).toBe(200);
      const result = (await (await call('GET', '/cosmetics')).json()) as {
        owned: { cosmeticId: string }[];
        equipped: Record<string, string | null>;
      };
      expect(result.equipped.CARD_BACK).toBe('cardback_premium_arcane_circle');
      expect(result.equipped.CARD_ART).toBe('showcase_ash_eclipse');
      expect(result.owned.some((o) => o.cosmeticId === 'showcase_ash_eclipse')).toBe(true);
      expect((await equip('CARD_ART', null)).status).toBe(200);
      expect(
        db.sql
          .prepare('SELECT cosmetic_id FROM tactics_equipped_cosmetics WHERE user_id=? AND slot=?')
          .get(a.id, 'CARD_ART'),
      ).toBeUndefined();
    } finally {
      db.sql.close();
    }
  });
});
