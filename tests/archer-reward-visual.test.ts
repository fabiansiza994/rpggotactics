import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { INFERNAL_CAMPAIGN } from '../src/game/data/infernal-encounters';
import { ARCHER_HUNT_CAMPAIGN } from '../src/game/data/archer-hunt-encounters';
import { createRun } from '../src/game/run/run';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';

afterAll(()=>vi.unstubAllEnvs());
describe('Archer completion presentation',()=>{
  it('renders the configured completion card and crystals from the active client catalog',async()=>{
    vi.stubEnv('VITE_ARCHER_ENABLED','1');
    const {WorldRewardReveal}=await import('../src/presentation/react/components/WorldRewardReveal');
    const run=createRun(ARCHER_HUNT_CAMPAIGN,withArcher(DEFAULT_CONTENT),201,'archer');
    const html=renderToStaticMarkup(createElement(WorldRewardReveal,{run}));
    expect(html).toContain('Ojo del Depredador');
    expect(html).toContain('predator_eye.webp');
    expect(html).toContain('250');
    expect(html).toContain('Sendero del Cazador');
  });
  it('shows the infernal completion without inventing an Archer-exclusive card', async()=>{
    vi.stubEnv('VITE_ARCHER_ENABLED','1');
    const {WorldRewardReveal}=await import('../src/presentation/react/components/WorldRewardReveal');
    const run=createRun(INFERNAL_CAMPAIGN,withArcher(DEFAULT_CONTENT),1,'archer');
    const html=renderToStaticMarkup(createElement(WorldRewardReveal,{run}));
    expect(html).toContain('250');expect(html).toContain('sin carta exclusiva');expect(html).not.toContain('Ojo del Depredador');
  });
  it('keeps forest completion foil distinct from the infernal forge',()=>{
    expect(premiumIdentity(withArcher(DEFAULT_CONTENT).cards.predator_eye!).motif).toBe('arcane');
  });
});
