import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT, type GameEvent } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { makeEngine, mutable, p, setHand } from './helpers';
const content = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const key = (id: string) => content.cards[id]!.presentation.visualKey;
function stampede() {
  const engine = makeEngine(
    {
      hero: { heroId: 'shapeshifter', pos: p(2, 2) },
      enemies: [{ id: 'victim', enemyId: 'orc_warrior', pos: p(4, 2) }],
    },
    content,
  );
  mutable(engine).player.energy = 30;
  const [uid] = setHand(engine, ['ancestral_stampede']);
  const target = p(4, 2);
  const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
  if (!result.ok) throw Error(result.error);
  return result.events;
}
describe('Phase 8 — causal presentation regressions', () => {
  it.each([false, true])(
    'real chained form transitions have separate readable intervals (reduced=%s)',
    (reduced) => {
      const events = stampede(),
        before = structuredClone(events),
        plan = compileTimeline(events, key, reduced);
      const forms = plan.cues.filter((c) => c.event.type === 'FORM_CHANGED');
      expect(forms).toHaveLength(2);
      expect(forms[1]!.at).toBeGreaterThanOrEqual(forms[0]!.at + forms[0]!.duration);
      const second = forms[1]!.event as Extract<GameEvent, { type: 'FORM_CHANGED' }>;
      expect(second.to).toBe('bear');
      expect(events).toEqual(before);
    },
  );
});

// Technical evidence only: these cases do not assert an artistic score or real GPU output.
import { collect, content as reviewContent } from '../qa/vfx-artistic-8-20261025/collect.ts';
const records = collect();
describe('Phase 8 — full inventory trace and replay checks', () => {
  it('covers exactly the current inventory, including every actor and ritual', () => {
    expect(records).toHaveLength(
      Object.keys(reviewContent.cards).length +
        Object.keys(reviewContent.enemies).length +
        Object.keys(reviewContent.summons ?? {}).length +
        Object.keys(reviewContent.rituals ?? {}).length +
        Object.values(reviewContent.enemies).reduce((n, e) => n + (e.phases?.length ?? 0), 0),
    );
  });
  it.each(records)(
    '$kind / $id: valid fixture, deterministic events and one HP cue per confirmed damage',
    (r) => {
      expect(r.accepted, r.error ?? r.id).toBe(true);
      expect(r.deterministic).toBe(true);
      for (const reduced of [false, true]) {
        const plan = reduced ? r.reducedTimeline : r.timeline;
        for (const event of r.events)
          if (event.type === 'UNIT_DAMAGED') {
            expect(plan.cues.filter((c) => c.kind === 'event' && c.event === event)).toHaveLength(
              1,
            );
            expect(event.hpLost).toBeGreaterThanOrEqual(0);
          }
        for (const attack of plan.cues.filter((c) => c.kind === 'attackImpact')) {
          const source =
            attack.event.type === 'ENEMY_ATTACKED'
              ? attack.event.enemyId
              : 'unitId' in attack.event
                ? attack.event.unitId
                : undefined;
          const index = r.events.indexOf(attack.event);
          const next = r.events
            .slice(index + 1)
            .find((e) => e.type === 'UNIT_DAMAGED' && e.sourceId === source);
          if (next) {
            const damage = plan.cues.find((c) => c.kind === 'event' && c.event === next)!;
            expect(damage.at).toBeGreaterThanOrEqual(attack.at);
          }
        }
      }
    },
  );
});

it('the manual review matrix links every recorded scenario to the existing local laboratory', () => {
  const rows = JSON.parse(
    readFileSync(new URL('../qa/vfx-artistic-8-20261025/matrix.json', import.meta.url), 'utf8'),
  ) as { id: string; kind: string; url: string }[];
  expect(rows).toHaveLength(records.length);
  expect(new Set(rows.map((row) => row.kind + ':' + row.id)).size).toBe(records.length);
  for (const record of records) {
    const row = rows.find((row) => row.kind === record.kind && row.id === record.id);
    expect(row).toBeDefined();
    const url = new URL(row!.url);
    expect(url.origin).toBe('http://127.0.0.1:5295');
    expect(url.pathname).toBe('/card-resolution-qa');
    expect(url.searchParams.get('effect')).toBe(
      record.kind === 'card' ? record.id : 'choice' in record ? record.choice : undefined,
    );
  }
});
