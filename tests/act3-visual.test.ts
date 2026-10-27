import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { GameEngine, DEFAULT_CONTENT, encounterFor, SCENARIOS_BY_ID } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import {
  interactionPresentation,
  interactionLabel,
  mechanismStateLabel,
} from '../src/presentation/mechanisms/interactionPresentation';
import { InteractionPanelView } from '../src/presentation/mechanisms/InteractionPanel';
import { useBattleStore } from '../src/presentation/store/battleStore';
const engine = () =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e01', 'mage'), DEFAULT_CONTENT);
const show = (e: GameEngine, card: string | null = null) => {
  useBattleStore.setState({
    engine: e,
    state: e.state,
    selectedMechanismId: null,
    selectedCardUid: card,
    playbackBusy: false,
    introLocked: false,
    handDiscard: null,
  });
  return renderToStaticMarkup(
    createElement(InteractionPanelView, {
      engine: e,
      state: e.state,
      selected: null,
      card,
      busy: false,
      feedback: '',
    }),
  );
};
describe('Act III interaction presentation', () => {
  it('assigns seven real WebP props', () => {
    for (const id of ['switch', 'plate', 'gate', 'bridge', 'statue', 'relic', 'trap']) {
      const bytes = readFileSync(`public/art/temple/${id}.webp`);
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
      expect(bytes.length).toBeLessThan(150000);
    }
  });
  it('presents readable state labels without changing state values', () => {
    expect(mechanismStateLabel('OPEN')).toBe('Abierta');
    expect(mechanismStateLabel('IDLE')).toBe('En reposo');
    expect(mechanismStateLabel('DISABLED')).toBe('Desactivada');
  });
  it('does not add UI to static battles', () => {
    const e = new GameEngine(SCENARIOS_BY_ID.first_blood!, DEFAULT_CONTENT);
    expect(interactionPresentation(e, null)).toBeNull();
    expect(show(e)).toBe('');
  });
  it('hides action before adjacency', () => {
    expect(interactionPresentation(engine(), null)?.options).toEqual([]);
    expect(show(engine())).not.toContain('class="mechanism-action"');
  });
  it('uses the engine label and highlights the connected chain', () => {
    const e = engine();
    expect(e.dispatch({ type: 'MOVE_UNIT', unitId: e.heroId, to: { x: 3, y: 2 } }).ok).toBe(true);
    expect(interactionPresentation(e, null)?.options[0]).toMatchObject({
      verb: 'ACTIVAR',
      allowed: true,
      energyCost: 0,
    });
    expect(show(e)).toContain('ACTIVAR');
    expect(e.getMechanismView()?.objects.find((o) => o.id === 'lever')?.connected).toContain(
      'gate',
    );
  });
  it('shows used state and does not change the economy', () => {
    const e = engine();
    e.dispatch({ type: 'MOVE_UNIT', unitId: e.heroId, to: { x: 3, y: 2 } });
    const { energy, movePoints } = e.state.player;
    e.dispatch({ type: 'INTERACT', mechanismId: 'lever' });
    expect(show(e)).toContain('INTERACCIÓN USADA');
    expect(e.state.player).toMatchObject({ energy, movePoints });
    expect(e.getMechanismView()?.objects.find((o) => o.id === 'gate')).toMatchObject({
      state: 'OPEN',
      visualState: 'active',
    });
  });
  it('does not expose an interaction button during card selection', () => {
    const e = engine();
    e.dispatch({ type: 'MOVE_UNIT', unitId: e.heroId, to: { x: 3, y: 2 } });
    expect(show(e, 'selected-card')).not.toContain('class="mechanism-action"');
  });
  it('derives reset copy from the verb without scenario ids', () => {
    expect(interactionLabel('RESTABLECER')).toBe('REINICIAR MECANISMO');
    expect(interactionLabel('EMPUJAR')).toBe('EMPUJAR');
  });
  it('keeps local entry DEV and loopback only', () => {
    const s = readFileSync('src/main.tsx', 'utf8');
    expect(s).toMatch(/Act3Qa = import.meta.env.DEV.*localhost.*location.pathname === '\/act3-qa'/);
  });
  it('keeps touch controls and reduced-motion fallback', () => {
    const css = readFileSync('src/styles/mechanisms.css', 'utf8');
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain('prefers-reduced-motion');
  });
});
