import { interactionPresentation } from '../src/presentation/mechanisms/interactionPresentation';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import {
  phase2ActionLabel,
  sequencePresentation,
  guardianLabel,
  stagePresentation,
  templeArt,
  platformProgress,
} from '../src/presentation/mechanisms/phase2Presentation';
import { InteractionPanelView } from '../src/presentation/mechanisms/InteractionPanel';
import { mechanismStateLabel } from '../src/presentation/mechanisms/interactionPresentation';
const engine = (id: string) =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, id, 'mage'), DEFAULT_CONTENT);
describe('Act III phase 2 presentation', () => {
  it('keeps the adjacent lever action while inspecting a platform',()=>{
    const e=engine('w3_e04');
    expect(e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:{x:2,y:5}}).ok).toBe(true);
    expect(interactionPresentation(e,'platform-a')?.options.map(o=>o.mechanismId)).toContain('lever-a');
  });
  it('registers six optimized individual WebP resources',()=>{
    for(const id of ['platform','guardian-fortified','guardian-exposed','relic-lost','rune-sun','rune-moon']){
      const file=readFileSync(`public/art/temple/${id}.webp`);expect(file.subarray(8,12).toString()).toBe('WEBP');expect(file.length).toBeLessThan(150000);
    }
  });
  it('renders platform stops from authority and contextual call/reset labels', () => {
    const e = engine('w3_e04'),
      v = e.getMechanismView()!;
    const p = v.objects.find((o) => o.kind === 'PLATFORM')!;
    expect(p.stops).toHaveLength(2);
    expect(templeArt(p)).toBe('platform');
    expect(phase2ActionLabel('ACTIVAR', 'lever-a', v)).toBe('LLAMAR PLATAFORMA');
    expect(phase2ActionLabel('RESTABLECER', 'reset', v)).toBe('REINICIAR CÁMARA');
  });
  it('keeps platform easing bounded and reduced motion at the authoritative destination', () => {
    expect(platformProgress(0, false)).toBe(0);
    expect(platformProgress(350, false)).toBeGreaterThan(0.5);
    expect(platformProgress(700, false)).toBe(1);
    expect(platformProgress(10000, false)).toBe(1);
    expect(platformProgress(0, true)).toBe(1);
  });
  it('distinguishes fortified mitigation from exposed remaining rounds', () => {
    const e = engine('w3_e05');
    expect(guardianLabel(e.state, { unitId: 'guardian', state: 'FORTIFIED' })).toBe(
      'BLINDADO · −2 daño',
    );
    expect(guardianLabel(e.state, { unitId: 'guardian', state: 'EXPOSED', untilRound: 2 })).toBe(
      'NÚCLEO EXPUESTO · 2 TURNOS',
    );
    const html = renderToStaticMarkup(
      createElement(InteractionPanelView, {
        engine: e,
        state: e.state,
        selected: null,
        card: null,
        busy: false,
        feedback: '',
      }),
    );
    expect(html).toContain('BLINDADO');
    expect(html).not.toContain('invulnerable');
  });
  it('renders three objective stages without manufacturing progression', () => {
    const e = engine('w3_e06');
    expect(stagePresentation(e.state)).toMatchObject({
      done: 0,
      total: 3,
      label: 'Llega a la cámara de la reliquia',
    });
    expect(stagePresentation(engine('w3_e01').state)).toBeNull();
  });
  it('distinguishes carry/drop/extraction labels and unique relic art', () => {
    const v = engine('w3_e06').getMechanismView()!;
    expect(templeArt(v.objects.find((o) => o.id === 'relic')!)).toBe('relic-lost');
    for (const [verb, label] of [
      ['RECOGER', 'RECOGER RELIQUIA'],
      ['SOLTAR', 'SOLTAR RELIQUIA'],
      ['ASEGURAR', 'ASEGURAR RELIQUIA'],
    ] as const)
      expect(phase2ActionLabel(verb, 'relic', v)).toBe(label);
    expect(mechanismStateLabel('CARRIED')).toBe('Portada');
    expect(mechanismStateLabel('DROPPED')).toBe('En el suelo');
    expect(mechanismStateLabel('EXTRACTED')).toBe('Asegurada');
  });
  it('retains sequence completion when the engine clears its cursor',()=>{
    const e=engine('w3_e06');const state=JSON.parse(JSON.stringify(e.state)) as typeof e.state;
    state.mechanisms!.sequences={'sun-then-moon':0};state.mechanisms!.fired=['sun-then-moon'];
    expect(sequencePresentation(state)).toEqual({done:2,total:2});
  });
  it('sun and moon use distinct art and extraction follows the engine tiles', () => {
    const v = engine('w3_e06').getMechanismView()!;
    expect(templeArt(v.objects.find((o) => o.id === 'rune-sun')!)).toBe('rune-sun');
    expect(templeArt(v.objects.find((o) => o.id === 'rune-moon')!)).toBe('rune-moon');
    expect(v.objects.find((o) => o.id === 'relic')?.extraction).toHaveLength(3);
  });
});
