import type { CSSProperties } from 'react';
import { COSMETICS, contentValue, DECK_RULES, DEFAULT_CONTENT, ritualCreature } from '../../game';
import { CHARACTER_PAINTINGS } from '../assets/paintedAssets';
import { SpellArt } from '../react/components/SpellArt';
import type { CatalogOffer } from './api';
import '../../styles/shop-ritual.css';

/**
 * Ritual pack merchandising (`StoreOffer.ritualPreview`): the creature the ritual summons is the
 * aspirational hero shot; the offer itself only sells the listed pieces. Pure presentation.
 *
 * Art uses the ritual creature’s own registered painting. No substituted creature art.
 */
export function ritualArt(ritualId: string): { src: string | undefined; placeholder: boolean; summonId: string | null } {
  const ritual = DEFAULT_CONTENT.rituals?.[ritualId];
  const creature = ritual ? ritualCreature(DEFAULT_CONTENT, ritual) : null;
  const own = creature ? CHARACTER_PAINTINGS[creature.summonId] : undefined;
  return { src: own, placeholder: !own, summonId: creature?.summonId ?? null };
}

/** Runic band on the outer sigil (decorative glyphs, not text the player reads). */
const RUNES = 'ᚠᚢᚦᚨᚱᚲ ᛉ ᚷᚹᚺᚾᛁᛃ ᛟ ᛇᛈᛋᛏᛒᛖ ᛉ ᛗᛚᛜᛞᛟ ᚠᚢᚦ ᛉ ᚨᚱᚲᚷᚹ ᛟ ᚺᚾᛁᛃᛇ';
/** Ember particles: horizontal position, delay and drift (deterministic, CSS-driven). */
const EMBERS = [
  [12, 0, -6], [24, 1.6, 8], [33, 3.1, -4], [41, 0.8, 10], [52, 2.4, -8],
  [61, 4.2, 6], [69, 1.1, -10], [78, 3.6, 4], [86, 2.0, -5], [47, 5.0, 3],
] as const;

function Sigil({ id }: { id: string }) {
  return (
    <svg className="ritual-sigil" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <path id={`ritual-band-${id}`} d="M100 100 m-84 0 a84 84 0 1 1 168 0 a84 84 0 1 1 -168 0" />
        <linearGradient id={`ritual-gold-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dc98" />
          <stop offset="0.5" stopColor="#b8873e" />
          <stop offset="1" stopColor="#f0cf83" />
        </linearGradient>
      </defs>
      <g className="ritual-sigil-outer" stroke={`url(#ritual-gold-${id})`} fill="none">
        <circle cx="100" cy="100" r="95" strokeWidth="0.8" opacity="0.7" />
        <circle cx="100" cy="100" r="76" strokeWidth="0.6" opacity="0.5" />
        <text fontSize="9" letterSpacing="3" fill="#e9c98055" stroke="none">
          <textPath href={`#ritual-band-${id}`}>{RUNES}</textPath>
        </text>
      </g>
      <g className="ritual-sigil-inner" stroke={`url(#ritual-gold-${id})`} fill="none" opacity="0.55">
        {/* Four seal points: one per ritual piece. */}
        <polygon points="100,30 170,100 100,170 30,100" strokeWidth="0.8" />
        <polygon points="100,44 156,100 100,156 44,100" strokeWidth="0.5" />
        {[[100, 30], [170, 100], [100, 170], [30, 100]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" strokeWidth="1" fill="#2a0c1e" />
        ))}
      </g>
    </svg>
  );
}

/** The cinematic stage: backdrop rays + haze + sigil + rim-lit creature + embers. */
function DragonStage({ ritualId, compact = false }: { ritualId: string; compact?: boolean }) {
  const art = ritualArt(ritualId);
  return (
    <div className="ritual-stage" data-compact={compact || undefined} data-placeholder={art.placeholder || undefined}>
      <span className="ritual-rays" />
      <span className="ritual-haze" />
      <Sigil id={compact ? 'c' : 'h'} />
      <span className="ritual-core" />
      {art.src && <img className="ritual-creature" src={art.src} alt="" />}
      <span className="ritual-ground" />
      <span className="ritual-embers">
        {EMBERS.slice(0, compact ? 6 : EMBERS.length).map(([x, delay, drift], i) => (
          <i key={i} style={{ '--x': `${x}%`, '--d': `${delay}s`, '--drift': `${drift}px` } as CSSProperties} />
        ))}
      </span>
    </div>
  );
}

/** Compact version for the offer tile and the Destacado banner. */
export function RitualPreviewArt({ ritualId, pieces }: { ritualId: string; pieces: readonly string[] }) {
  return (
    <div className="shop-bundle-art shop-ritual-art" aria-hidden="true">
      <DragonStage ritualId={ritualId} compact />
      <div className="ritual-seal-row">
        {pieces.map((id) => (
          <span className="ritual-seal-chip" key={id}>
            <SpellArt cardId={id} spell={DEFAULT_CONTENT.cards[id]?.presentation.visualKey ?? id} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Store modal hero shot: the summoned creature, its numbers and what it is. */
export function RitualHeroShot({ offer }: { offer: CatalogOffer }) {
  const ritual = offer.ritualPreview ? DEFAULT_CONTENT.rituals?.[offer.ritualPreview] : undefined;
  if (!ritual) return null;
  const creature = ritualCreature(DEFAULT_CONTENT, ritual);
  const breath = creature ? DEFAULT_CONTENT.summons?.[creature.summonId]?.breath : undefined;
  return (
    <figure className="ritual-hero-shot" data-ritual={ritual.id}>
      <div className="shop-hero-badges">
        <span className="shop-hero-badge is-star">Recompensa del ritual</span>
        <span className="shop-hero-badge is-premium">✦ Invocación mítica</span>
      </div>
      <DragonStage ritualId={ritual.id} />
      <figcaption>
        <span className="ritual-eyebrow">Criatura legendaria</span>
        <strong>{creature?.name ?? ritual.name}</strong>
        {creature && (
          <span className="ritual-stats">
            <b>{creature.maxHp}</b> PV<i>·</i>Armadura <b>{creature.armor}</b><i>·</i>Mordisco <b>{creature.damage}</b>
            {breath && (
              <>
                <i>·</i>
                {breath.name} <b>{breath.damage}</b>
              </>
            )}
          </span>
        )}
        <span className="ritual-note">Una invocación legendaria reservada para quienes completan el ritual.</span>
      </figcaption>
    </figure>
  );
}

/**
 * The recipe as a sequence: the four sealed pieces converge on the creature. Shows what this pack
 * gives (or what the player already owns, when the server left it out of a prorated pack), the
 * activation cost and the value of the pieces bought one by one.
 */
export function RitualRecipe({ offer }: { offer: CatalogOffer }) {
  const ritual = offer.ritualPreview ? DEFAULT_CONTENT.rituals?.[offer.ritualPreview] : undefined;
  if (!ritual) return null;
  const creature = ritualCreature(DEFAULT_CONTENT, ritual);
  const parts = offer.contents.reduce(
    (n, c) => n + contentValue(c, { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS }),
    0,
  );
  return (
    <section className="ritual-recipe" aria-label="Secuencia del ritual">
      <p className="ritual-explainer">
        Este pack contiene las cartas clave del ritual. <strong>Domina la secuencia y desata al Dragón Primordial.</strong>
      </p>
      <ol className="ritual-sequence">
        {ritual.pieces.map((id, i) => {
          const card = DEFAULT_CONTENT.cards[id];
          const included = offer.contents.some((c) => c.kind === 'CARD' && c.cardId === id);
          const owned = offer.excluded.some((e) => e.kind === 'CARD' && e.cardId === id);
          return (
            <li key={id} data-state={included ? 'included' : owned ? 'owned' : 'missing'}>
              <span className="ritual-socket">
                <SpellArt cardId={id} spell={card?.presentation.visualKey ?? id} />
                <em>{i + 1}</em>
              </span>
              <span className="ritual-piece-name">{card?.name.replace(/^Sello (de la|del) /, '') ?? id}</span>
              <small>{included ? 'Incluida' : owned ? 'Ya la tienes' : 'No incluida'}</small>
            </li>
          );
        })}
        <li data-state="result">
          <span className="ritual-socket is-result" aria-hidden="true">
            ✦
          </span>
          <span className="ritual-piece-name">{creature?.name ?? ritual.name}</span>
          <small>Invocación ritual</small>
        </li>
      </ol>
      <p className="ritual-howto">
        Sella las {ritual.pieces.length} piezas en tu altar y actívalo por {ritual.energyCost} de energía.{' '}
        <strong>Completa el ritual para invocar al Dragón Primordial.</strong>
        {parts > offer.price && (
          <span className="ritual-value">
            {' '}
            Por separado: <s>{parts}</s> · En el pack: <b>{offer.price}</b> Cristales
          </span>
        )}
      </p>
    </section>
  );
}
