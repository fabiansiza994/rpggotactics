import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfile, type GameEvent, type GameState } from '../src/game';
import {
  QA_CONTENT,
  restoreQa,
  serializeQa,
  startQaBattle,
  openingSeed,
} from '../src/presentation/qa/shapeshifter/session';
import { SHAPESHIFTER_QA_DECKS } from '../src/game/data/shapeshifter-qa';
import {
  EMPTY_VISUAL_BATCH,
  FORM_REVEAL_MS,
  QA_FORM_VISUALS,
  QA_TRANSFORM_ART,
  eventVisuals,
  facingFor,
  formVisual,
} from '../src/presentation/qa/shapeshifter/visuals';
import { FormBoard } from '../src/presentation/qa/shapeshifter/FormBoard';
const fixture = () =>
  startQaBattle(
    createProfile(QA_CONTENT),
    SHAPESHIFTER_QA_DECKS.balanced,
    openingSeed(SHAPESHIFTER_QA_DECKS.balanced),
    'normal',
  );
const hero = (s: Readonly<GameState>) => s.units.find((u) => u.id === s.player.heroId)!;
function cast(e: ReturnType<typeof fixture>, id: string) {
  const card = e.state.player.hand.find((c) => c.cardId === id)!;
  const before = e.state;
  const result = e.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null });
  if (!result.ok) throw Error(result.message);
  return { before, result };
}
function html(state: Readonly<GameState>, batch = EMPTY_VISUAL_BATCH) {
  return renderToStaticMarkup(
    createElement(FormBoard, {
      state,
      batch,
      targets: [],
      moves: [],
      selected: true,
      onTile: () => {},
    }),
  );
}

describe('Cambiaformas visual registry and event presentation', () => {
  it('has distinct raster silhouettes and four authored poses per form', () => {
    const paths = [];
    for (const v of Object.values(QA_FORM_VISUALS)) {
      expect(Object.keys(v.poses)).toEqual(['idle', 'attack', 'hurt', 'death']);
      for (const path of Object.values(v.poses)) {
        expect(existsSync(join('public', path))).toBe(true);
        expect(readFileSync(join('public', path)).subarray(0, 4).toString()).toBe('RIFF');
        paths.push(path);
      }
      expect(existsSync(join('public', v.icon))).toBe(true);
    }
    expect(new Set(paths).size).toBe(12);
    expect(FORM_REVEAL_MS).toBe(600);
  });
  it('renders humanoid, then Oso and Minotauro from activeForm without changing position or authority', () => {
    const e = fixture(),
      position = structuredClone(hero(e.state).pos);
    expect(html(e.state)).toContain('data-form="humanoid"');
    for (const [id, form] of [
      ['qa_bear_form', 'bear'],
      ['qa_minotaur_form', 'minotaur'],
    ]) {
      const { before, result } = cast(e, id!);
      const snapshot = JSON.stringify(e.state);
      const batch = eventVisuals(before, e.state, result.events, e.content, 1);
      const markup = html(e.state, batch);
      expect(markup).toContain(`data-form="${form}"`);
      expect(markup).toContain(`${form}-idle.webp`);
      expect(markup).toContain('data-motion="transform"');
      expect(hero(e.state).pos).toEqual(position);
      expect(JSON.stringify(e.state)).toBe(snapshot);
    }
  });
  it('records the previous silhouette and never trusts event.to over actual activeForm', () => {
    const e = fixture();
    cast(e, 'qa_bear_form');
    const { before, result } = cast(e, 'qa_minotaur_form');
    const batch = eventVisuals(before, e.state, result.events, e.content, 7);
    expect(batch.cues[e.heroId]).toEqual({ motion: 'transform', previousForm: 'bear' });
    expect(html(e.state, batch)).toContain('bear-idle.webp');
    expect(html(e.state, batch)).toContain('minotaur-idle.webp');
    expect(
      html(e.state, {
        ...batch,
        cues: { [e.heroId]: { motion: 'transform', previousForm: null } },
      }),
    ).toContain('data-form="minotaur"');
  });
  it('consumes attack, hurt and death events; preserves a defeated unit silhouette for presentation', () => {
    const e = fixture();
    cast(e, 'qa_bear_form');
    const before = structuredClone(e.state),
      unit = hero(before);
    const played: GameEvent = {
      type: 'CARD_PLAYED',
      cardUid: 'visual',
      cardId: 'qa_bear_claw',
      casterId: unit.id,
      target: null,
      impact: unit.pos,
      affectedTiles: [],
      direction: null,
    };
    expect(eventVisuals(before, before, [played], e.content, 1).cues[unit.id]?.motion).toBe(
      'attack',
    );
    const hurt: GameEvent = {
      type: 'UNIT_DAMAGED',
      unitId: unit.id,
      sourceId: 'qa-orc',
      damageType: 'PHYSICAL',
      pos: unit.pos,
      rawAmount: 3,
      armorMitigated: 2,
      shieldAbsorbed: 0,
      hpLost: 1,
      hpAfter: 23,
    };
    expect(eventVisuals(before, before, [hurt], e.content, 2).cues[unit.id]?.motion).toBe('hurt');
    const after = structuredClone(before) as GameState;
    after.units = after.units.filter((u) => u.id !== unit.id);
    const defeated: GameEvent = {
      type: 'UNIT_DEFEATED',
      unitId: unit.id,
      faction: unit.faction,
      kind: unit.kind,
      pos: unit.pos,
    };
    const batch = eventVisuals(before, after, [hurt, defeated], e.content, 3);
    expect(batch.ghosts).toHaveLength(1);
    expect(html(after, batch)).toContain('bear-death.webp');
    expect(before.units.some((u) => u.id === unit.id)).toBe(true);
    expect(after.units.some((u) => u.id === unit.id)).toBe(false);
  });
  it('restores the correct form from a replay without replaying old visual transitions', () => {
    const profile = createProfile(QA_CONTENT),
      e = fixture();
    cast(e, 'qa_minotaur_form');
    const restored = restoreQa(serializeQa(profile, e)).engine!;
    expect(html(restored.state)).toContain('data-form="minotaur"');
    expect(html(restored.state)).toContain('data-motion="idle"');
  });
  it('supports a third visual registration with no renderer branches and mirrors toward enemies', () => {
    const extra = {
      ...QA_FORM_VISUALS,
      test_future: { ...QA_FORM_VISUALS.bear!, id: 'test_future', label: 'QA future' },
    };
    expect(formVisual('test_future', extra).id).toBe('test_future');
    const e = fixture(),
      unit = hero(e.state);
    expect(facingFor(unit, e.state.units)).toBe(1);
    const units = structuredClone(e.state.units);
    units
      .filter((u) => u.faction !== unit.faction)
      .forEach((u) => {
        u.pos = { ...u.pos, x: 0 };
      });
    expect(facingFor(unit, units)).toBe(-1);
  });
  it('uses transformation-specific card art without modifying definitions or their effects', () => {
    expect(Object.keys(QA_TRANSFORM_ART).sort()).toEqual(['qa_bear_form', 'qa_minotaur_form']);
    for (const [id, v] of Object.entries(QA_TRANSFORM_ART)) {
      expect(existsSync(join('public', v.art))).toBe(true);
      expect(QA_CONTENT.cards[id]!.cost).toBe(1);
      expect(QA_CONTENT.cards[id]!.effects).toEqual([{ type: 'TRANSFORM', formId: v.visualId }]);
    }
  });
});
