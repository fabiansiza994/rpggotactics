import { applyStatus } from '../src/game/domain/statuses/status-rules';
import { CardView } from '../src/presentation/react/components/CardView';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT, GameEngine, type GameState } from '../src/game';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { planCardSelection, pairTargets } from '../src/presentation/input/pairSelection';
import { isActionableTile } from '../src/presentation/input/aim';
import { useBattleStore } from '../src/presentation/store/battleStore';
import { CardBackFace } from '../src/presentation/cosmetics/CardBack';
import {
  cosmeticCard,
  showcaseFor,
  cardBackFor,
} from '../src/presentation/cosmetics/cardCosmetics';
import { CardPremiumFx } from '../src/presentation/react/components/CardPremiumFx';
import { CosmeticPreviewContext } from '../src/presentation/cosmetics/cardCosmetics';
import type { Cosmetics } from '../src/presentation/shop/api';
import { makeEngine, mutable, setHand, p, ctxFor, unit } from './helpers';
function setup() {
  const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
  mutable(e).player.energy = 9;
  const fox = spawnSummon(ctxFor(e), unit(e, e.heroId), 'fox', p(2, 2))!;
  const chicken = spawnSummon(ctxFor(e), unit(e, e.heroId), 'chicken', p(3, 3))!;
  const [uid] = setHand(e, ['double_moon_pact']);
  useBattleStore.setState({
    engine: e,
    state: e.state,
    selectedCardUid: uid!,
    pairSelection: null,
    aim: null,
    handDiscard: null,
    onlineCommand: null,
    playbackBusy: false,
    introLocked: false,
  });
  return { e, uid: uid!, fox, chicken };
}
afterEach(() =>
  useBattleStore.setState({
    engine: null,
    state: null,
    selectedCardUid: null,
    pairSelection: null,
    onlineCommand: null,
  }),
);
describe('Premium battle UI integration', () => {
  it('waits for a partner, highlights valid targets and supports cancel/reselect without resolving', () => {
    const { e, uid } = setup();
    const energy = e.state.player.energy;
    useBattleStore.getState().clickTile(p(2, 2));
    expect(e.history).toHaveLength(0);
    expect(e.state.player.energy).toBe(energy);
    expect(pairTargets(e, uid, useBattleStore.getState().pairSelection)).toEqual([
      p(0, 2),
      p(3, 3),
    ]);
    expect(isActionableTile(e, uid, p(3, 3), useBattleStore.getState().pairSelection)).toBe(true);
    useBattleStore.getState().clickTile(p(5, 4));
    expect(e.history).toHaveLength(0);
    useBattleStore.getState().cancelPairTarget();
    expect(useBattleStore.getState().selectedCardUid).toBe(uid);
    expect(useBattleStore.getState().pairSelection).toBeNull();
    useBattleStore.getState().clickTile(p(2, 2));
    useBattleStore.getState().cancelAim();
    expect(useBattleStore.getState().selectedCardUid).toBeNull();
    expect(e.history).toHaveLength(0);
  });
  it('champion swap retains old command shape and resolves once', () => {
    const { e } = setup();
    useBattleStore.getState().clickTile(p(2, 2));
    useBattleStore.getState().confirmPairWithChampion();
    expect(e.history).toHaveLength(1);
    expect(e.history[0]).not.toHaveProperty('secondary');
    expect(unit(e, e.heroId).pos).toEqual(p(2, 2));
    useBattleStore.getState().confirmPairWithChampion();
    expect(e.history).toHaveLength(1);
  });
  it('summon swap sends one authoritative command, and serialized reconnect/replay yields the same state', () => {
    const { e, uid, fox, chicken } = setup();
    const snapshot = structuredClone(e.state) as GameState;
    useBattleStore.getState().clickTile(fox.pos);
    const pair = useBattleStore.getState().pairSelection;
    const plan = planCardSelection(e, uid, chicken.pos, pair);
    expect(plan.kind).toBe('command');
    if (plan.kind !== 'command') throw Error('command');
    const sent: unknown[] = [];
    useBattleStore.setState({ onlineCommand: (c) => sent.push(c) });
    useBattleStore.getState().clickTile(chicken.pos);
    useBattleStore.getState().clickTile(chicken.pos);
    expect(sent).toEqual([plan.command]);
    const restored = GameEngine.fromSnapshot(
      JSON.parse(JSON.stringify(snapshot)),
      e.content,
      e.scenario,
    );
    expect(e.dispatch(plan.command).ok).toBe(true);
    expect(restored.dispatch(plan.command).ok).toBe(true);
    expect(restored.state).toEqual(e.state);
    expect(new Set(e.state.units.map((u) => `${u.pos.x},${u.pos.y}`)).size).toBe(
      e.state.units.length,
    );
    const reconnect = GameEngine.fromSnapshot(
      JSON.parse(JSON.stringify(e.state)),
      e.content,
      e.scenario,
    );
    expect(reconnect.state).toEqual(e.state);
  });
  it('a rooted champion can still pick the two-summon branch through touch targeting', () => {
    const { e, uid } = setup();
    applyStatus(ctxFor(e), unit(e, e.heroId), 'ROOTED', 1, 'orc-1');
    expect(isActionableTile(e, uid, p(2, 2))).toBe(true);
    useBattleStore.getState().clickTile(p(2, 2));
    expect(pairTargets(e, uid, useBattleStore.getState().pairSelection)).toEqual([p(3, 3)]);
    expect(isActionableTile(e, uid, p(0, 2), useBattleStore.getState().pairSelection)).toBe(false);
  });
  it('Pacto preserves pressure mechanism synchronization and valid nonoverlapping destinations', () => {
    const e = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      mechanisms: {
        objects: [
          { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(2, 2), accepts: ['HERO'] },
          { id: 'gate', kind: 'GATE', pos: p(5, 1) },
        ],
        rules: [
          {
            id: 'open',
            trigger: { type: 'ON_OCCUPIED', sources: ['plate'] },
            actions: [{ type: 'OPEN', targets: ['gate'] }],
          },
        ],
      },
    });
    mutable(e).player.energy = 9;
    spawnSummon(ctxFor(e), unit(e, e.heroId), 'fox', p(2, 2));
    const [uid] = setHand(e, ['double_moon_pact']);
    const first = planCardSelection(e, uid!, p(2, 2), null);
    expect(first.kind).toBe('first');
    if (first.kind !== 'first') throw Error('first');
    const action = planCardSelection(e, uid!, p(0, 2), first.pair);
    if (action.kind !== 'command') throw Error('command');
    expect(e.dispatch(action.command).ok).toBe(true);
    expect(e.getMechanismView()?.objects.find((o) => o.id === 'gate')?.state).toBe('OPEN');
  });
  it('Ascenso discount displays actual cost, survives reconnect, consumes once and does not mutate card definitions', () => {
    const content = withShapeshifterRelease(DEFAULT_CONTENT);
    const e = makeEngine({ hero: { heroId: 'shapeshifter', pos: p(0, 2) } }, content);
    mutable(e).player.energy = 9;
    const [asc] = setHand(e, ['primal_ascent']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: asc!, target: null }).ok).toBe(true);
    const [uid] = setHand(e, ['qa_minotaur_form']);
    const restored = GameEngine.fromSnapshot(
      JSON.parse(JSON.stringify(e.state)),
      content,
      e.scenario,
    );
    expect(restored.getCardCost(uid!)).toEqual({ cost: 0, discount: 1 });
    const face = renderToStaticMarkup(
      createElement(CardView, {
        def: content.cards.qa_minotaur_form!,
        hotkey: 1,
        selected: false,
        playable: true,
        effectiveCost: restored.getCardCost(uid!)!.cost,
        onClick: () => {},
      }),
    );
    expect(face).toContain('coste 0');
    expect(face).toContain('data-discounted="true"');
    expect(content.cards.qa_minotaur_form!.cost).toBe(1);
    const command = restored.selectionCommand(uid!, null);
    expect(restored.dispatch(command).ok).toBe(true);
    expect(e.dispatch(command).ok).toBe(true);
    expect(e.state).toEqual(restored.state);
    expect(unit(restored, restored.heroId).costDiscounts).toBeUndefined();
    expect(restored.dispatch(command).ok).toBe(false);
    const fresh = makeEngine({ hero: { heroId: 'shapeshifter', pos: p(0, 2) } }, content);
    expect(unit(fresh, fresh.heroId).costDiscounts).toBeUndefined();
  });
});
const owned: Cosmetics = {
  owned: [
    { cosmeticId: 'showcase_ash_eclipse', kind: 'CARD_ART', acquiredAt: 1 },
    { cosmeticId: 'cardback_premium_arcane_circle', kind: 'CARD_BACK', acquiredAt: 1 },
  ],
  equipped: { CARD_ART: 'showcase_ash_eclipse', CARD_BACK: 'cardback_premium_arcane_circle' },
};
describe('Premium cosmetic renderers', () => {
  it('same id, stats and rules; foil only for the matching owned equipped card', () => {
    const card = DEFAULT_CONTENT.cards.ash_eclipse!,
      before = JSON.stringify(card),
      visual = cosmeticCard(card, owned);
    expect(visual.id).toBe(card.id);
    expect(visual.effects).toBe(card.effects);
    expect(visual.rulesText).toBe(card.rulesText);
    expect(visual.cost).toBe(card.cost);
    expect(visual.rarity).toBe(card.rarity);
    expect(JSON.stringify(card)).toBe(before);
    expect(showcaseFor(DEFAULT_CONTENT.cards.fireball!, owned)).toBeNull();
    expect(showcaseFor(card, { ...owned, owned: [] })).toBeNull();
    const html = renderToStaticMarkup(
      createElement(
        CosmeticPreviewContext.Provider,
        { value: owned },
        createElement(CardPremiumFx, { def: card }),
      ),
    );
    expect(html).toContain('secret');
    expect(html).toContain('Showcase · Cosmético');
    expect(html).not.toContain('Showcase · Rara');
  });
  it('renders only an owned selected final back and gracefully defaults', () => {
    expect(cardBackFor(owned)).toBe('cardback_premium_arcane_circle');
    expect(cardBackFor({ ...owned, owned: [] })).toBeNull();
    const html = renderToStaticMarkup(createElement(CardBackFace, { cosmetics: owned }));
    expect(html).not.toContain('arte pendiente');
    expect(html).toContain('cardback_premium_arcane_circle.webp');
    expect(html).toContain('data-art-state="final"');
    expect(
      renderToStaticMarkup(createElement(CardBackFace, { cosmetics: { owned: [], equipped: {} } })),
    ).toContain('data-card-back="default"');
  });
});
