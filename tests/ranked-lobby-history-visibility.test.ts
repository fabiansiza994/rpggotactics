import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RankedPanel } from '../src/presentation/ranked/RankedViews';
import type { RankedProfile } from '../src/presentation/ranked/rankedApi';
import { botIdentity } from '../src/game/ai/ranked-bot-policy';

const profile: Extract<RankedProfile, { enabled: true }> = {
  enabled: true, rp: 46, wins: 14, losses: 10, draws: 0, milestones: [],
  queue: { state: 'IDLE' },
  botHistory: [{ matchId: 'qa-history', bot: botIdentity('history', 46, 321), outcome: 'WIN', rpDelta: 10, xp: 25, finishedAt: 100 }],
};
describe('Ranked lobby without the dedicated AI-history section', () => {
  it.each([false, true])('preserves queue, RP and rewards; omits history (mobile=%s)', (mobile) => {
    const before = structuredClone(profile);
    const html = renderToStaticMarkup(createElement(RankedPanel, {
      mobile, profile, queue: profile.queue, busy: false, error: '', blocked: null,
      championName: 'Mago', onSearch: () => {}, onCancel: () => {},
    }));
    expect(html).not.toContain('Últimas partidas contra IA');
    expect(html).not.toContain('ranked-bot-history');
    expect(html).not.toContain(profile.botHistory![0]!.bot.name);
    expect(html).toContain('Buscar partida');
    expect(html).toContain('46 RP');
    expect(html).toContain('Progreso de división');
    expect(html).toContain('Recompensas');
    expect(profile).toEqual(before);
  });
});
