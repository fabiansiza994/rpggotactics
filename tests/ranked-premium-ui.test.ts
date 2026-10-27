import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RankedRewardsDialog } from '../src/presentation/ranked/RankedRewardsTrack';
import {
  PremiumPurchasePanel,
  PremiumDetail,
  PremiumRewardArt,
} from '../src/presentation/ranked/RankedPremiumTrack';
import { premiumName, nextPremiumNode } from '../src/presentation/ranked/premiumPresentation';
import { rankedTrackView } from '../src/game/ranked/rewardTrack';
import { RANKED_PREMIUM_TRACK, rankedPremiumView } from '../src/game/ranked/premiumTrack';
const free = rankedTrackView({
  rp: 893,
  peakRp: 905,
  firstValidRanked: true,
  granted: {},
  milestones: [],
});
const input = { rp: 893, peakRp: 905, pass: null, granted: {}, showcase: null };
const noOp = () => {};
describe('Premium Track UI uses authoritative views', () => {
  it('renders eighteen aligned free/premium pairs and preserves the free-only view', () => {
    const premium = rankedPremiumView(input);
    const html = renderToStaticMarkup(
      createElement(RankedRewardsDialog, {
        view: free,
        premium,
        premiumBalance: 1040,
        onClose: noOp,
        onRefresh: noOp,
      }),
    );
    expect(html.match(/class="rpt-node"/g)).toHaveLength(18);
    expect(html.match(/class="rpt-node-pair"/g)).toHaveLength(18);
    expect(html.match(/class="rrt-node"/g)).toHaveLength(18);
    expect(html).toContain('Próxima Premium');
    expect(html).toContain('Próxima recompensa');
    expect(html).toContain('Requiere Premium');
    expect(html).toContain('rpg-scroll-x');
    const base = renderToStaticMarkup(
      createElement(RankedRewardsDialog, { view: free, onClose: noOp, onRefresh: noOp }),
    );
    expect(base).not.toContain('rpt-node');
    expect(base).not.toContain('Desbloquear pista premium');
  });
  it('quotes the view price, disables insufficient funds and shows owned state', () => {
    const premium = rankedPremiumView(input);
    const html = renderToStaticMarkup(
      createElement(PremiumPurchasePanel, {
        view: premium,
        balance: 120,
        onChange: noOp,
        onRefresh: noOp,
      }),
    );
    expect(html).toContain('600');
    expect(html).toContain('Te faltan 480');
    expect(html).toMatch(/disabled=""[^>]*>Desbloquear pista premium/);
    const owned = rankedPremiumView({ ...input, pass: { purchasedAt: 1 } });
    expect(
      renderToStaticMarkup(
        createElement(PremiumPurchasePanel, {
          view: owned,
          balance: 440,
          onChange: noOp,
          onRefresh: noOp,
        }),
      ),
    ).toContain('Pista premium desbloqueada');
  });
  it('uses all premium node status variants and an explicit irreversible Showcase choice', () => {
    const granted = Object.fromEntries(
      RANKED_PREMIUM_TRACK.flatMap((n) =>
        n.items.map((i) => [i.rewardId, { grantedAt: 1, copies: i.quantity }]),
      ),
    );
    const premium = rankedPremiumView({
      rp: 1700,
      peakRp: 1700,
      pass: { purchasedAt: 1 },
      granted,
      showcase: null,
    });
    const next = nextPremiumNode(premium.nodes)!;
    expect(next.nodeId).toBe('DIAMOND_I');
    const html = renderToStaticMarkup(
      createElement(PremiumDetail, { node: next, view: premium, onChange: noOp, onRefresh: noOp }),
    );
    expect(html).toContain('Elige tu Showcase');
    expect(html).toContain('Showcase · cosmético');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(5);
    const chosen = rankedPremiumView({
      rp: 1700,
      peakRp: 1700,
      pass: { purchasedAt: 1 },
      granted,
      showcase: { cardId: 'ash_eclipse', chosenAt: 1 },
    });
    const chosenHtml = renderToStaticMarkup(
      createElement(PremiumDetail, {
        node: chosen.nodes.at(-1)!,
        view: chosen,
        onChange: noOp,
        onRefresh: noOp,
      }),
    );
    expect(chosenHtml).toContain('Elegido:');
    expect(chosenHtml).not.toContain('Elige tu Showcase');
  });
  it('uses verified final avatar art and removes the obsolete pending label', () => {
    const premium = rankedPremiumView(input);
    const avatar = premium.nodes[0]!.items[0]!;
    const art = renderToStaticMarkup(createElement(PremiumRewardArt, { item: avatar }));
    expect(art).not.toContain('ARTE PENDIENTE');
    expect(art).toContain('premium_arcane_emblem.webp');
    expect(art).toContain('loading="lazy"');
    const html = renderToStaticMarkup(
      createElement(PremiumDetail, {
        node: premium.nodes[0]!,
        view: premium,
        onChange: noOp,
        onRefresh: noOp,
      }),
    );
    expect(html).not.toContain('cuando su arte esté disponible');
    expect(premiumName(avatar)).toBe('Emblema Arcano Dorado y Azul');
  });
  it('exposes all five canonical card names and rules without changing their rarity', () => {
    const premium = rankedPremiumView(input);
    const nodes = premium.nodes.filter((n) => n.items.some((i) => i.type === 'CARD'));
    expect(nodes).toHaveLength(5);
    for (const node of nodes) {
      const html = renderToStaticMarkup(
        createElement(PremiumDetail, { node, view: premium, onChange: noOp, onRefresh: noOp }),
      );
      expect(html).toContain('Legendaria');
      expect(html).toContain('Única');
      expect(html).toContain(premiumName(node.items[0]!));
    }
  });
});
