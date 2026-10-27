import { DEFAULT_CONTENT } from '../../game';
import { CHARACTER_PAINTINGS } from '../assets/paintedAssets';
import { championPortrait } from '../assets/champions';
import { SpellArt } from '../react/components/SpellArt';
import type { CatalogOffer } from './api';
import { FramedPortrait } from './ProfileFrame';
import { RitualPreviewArt } from './RitualHeroShot';
export function CrystalIcon() {
  return (
    <svg viewBox="0 0 28 32" className="crystal-icon" aria-hidden="true">
      <path d="m14 1 10 9-3 14-7 7-7-7-3-14Z" fill="#a9e7fa" stroke="#dfc58a" />
      <path
        d="m14 1-5 10 5 20 5-20Zm-10 9 10 4 10-4M7 24l7-10 7 10"
        fill="#5f9ad7"
        stroke="#d1eefa"
        strokeWidth=".8"
      />
    </svg>
  );
}
export function StoreArt({ offer, heroId = 'mage' }: { offer: CatalogOffer; heroId?: string }) {
  // Ritual pack: the summoned creature headlines, the seals sit below it.
  if (offer.ritualPreview)
    return <RitualPreviewArt ritualId={offer.ritualPreview} pieces={DEFAULT_CONTENT.rituals?.[offer.ritualPreview]?.pieces ?? []} />;
  if (offer.id === 'pack_warrior_executioner_oath') return (
    <div className="shop-bundle-art shop-oath-art" aria-hidden="true">
      <img className="shop-oath-emblem" src="/art/store-packs/executioner-oath-v1.webp" alt="" />
    </div>
  );
  if (offer.type === 'COSMETIC') {
    const item = offer.contents.find((c) => c.kind === 'COSMETIC');
    return item?.kind === 'COSMETIC' ? (
      <FramedPortrait frameId={item.cosmeticId} heroId={heroId} />
    ) : null;
  }
  if (offer.type === 'CARD') {
    const item = offer.contents.find((c) => c.kind === 'CARD');
    const card = item?.kind === 'CARD' ? DEFAULT_CONTENT.cards[item.cardId] : undefined;
    return (
      <div className="shop-spell-art">
        {card && <SpellArt cardId={card.id} spell={card.presentation.visualKey} />}
      </div>
    );
  }
  const creatures = offer.contents.flatMap((c) =>
    c.kind === 'CARD'
      ? (DEFAULT_CONTENT.cards[c.cardId]?.effects.flatMap((e) =>
          e.type === 'SUMMON' ? [e.summonId] : [],
        ) ?? [])
      : [],
  );
  return (
    <div className="shop-bundle-art" aria-hidden="true">
      <span className="shop-summoning-circle" />
      <img className="shop-hero-art" src={championPortrait(offer.heroId ?? 'mage')} alt="" />
      {creatures.map((id, i) => (
        <img
          className={`shop-creature-art creature-${i}`}
          key={id}
          src={CHARACTER_PAINTINGS[id]}
          alt=""
        />
      ))}
      {offer.contents
        .filter(
          (c) =>
            c.kind === 'CARD' &&
            !DEFAULT_CONTENT.cards[c.cardId]?.effects.some((e) => e.type === 'SUMMON'),
        )
        .map(
          (c, i) =>
            c.kind === 'CARD' && (
              <div className={`shop-bundle-spell spell-${i}`} key={c.cardId}>
                <SpellArt
                  cardId={c.cardId}
                  spell={DEFAULT_CONTENT.cards[c.cardId]!.presentation.visualKey}
                />
              </div>
            ),
        )}
    </div>
  );
}
