import '../../../styles/champions.css';
import { championGuideHref } from '../../site/championGuideLinks';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { useShallow } from 'zustand/react/shallow';
import { useState, type CSSProperties } from 'react';
import { MasteryPanel } from '../../mastery/MasteryViews';
import {
  activeDeck,
  ASCENT_CAMPAIGN,
  defaultCampaignHero,
  battleDeck,
  DECK_RULES,
  deckSize,
  heroProfile,
  unlockRequirement,
} from '../../../game';
import {
  championPortrait,
  championCardStatus,
  championsIn,
  RATING_LABEL,
  RATING_ORDER,
  type ChampionPresentation,
} from '../../assets/champions';
import { campaignHeroes, championReleased } from '../../campaignRelease';
import { archerCampaignReleasedIn, availableChampionsIn, championUsableIn, useBattleStore, warriorReleasedIn } from '../../store/battleStore';
import { requirementText } from '../components/ChampionOnboarding';
import { GameIcon } from '../components/GameIcon';

const MAX_RATING = 5;

function Portrait({ heroId, className }: { heroId: string; className: string }) {
  const src = championPortrait(heroId);
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <GameIcon name="arcane" />}
    </span>
  );
}

function Rating({ label, value }: { label: string; value: number }) {
  return (
    <li className="ch-rating">
      <span className="ch-rating-label">{label}</span>
      <span className="ch-rating-pips" role="img" aria-label={`${label}: ${value} de ${MAX_RATING}`}>
        {Array.from({ length: MAX_RATING }, (_, i) => (
          <span key={i} className={`ch-pip${i < value ? ' is-on' : ''}`} />
        ))}
      </span>
    </li>
  );
}

export function ChampionSelect() {
  const profile = useBattleStore((s) => s.profile);
  const selectChampion = useBattleStore((s) => s.selectChampion);
  const openDeckBuilder = useBattleStore((s) => s.openDeckBuilder);
  const closeChampions = useBattleStore((s) => s.closeChampions);
  const warriorReleased = useBattleStore(warriorReleasedIn);
  const qaSummonerCampaign = useBattleStore((s) => s.qaSummonerCampaign);
  const archerCampaign = useBattleStore(archerCampaignReleasedIn);
  // Every released champion is listed; locked ones show how to unlock them (ownership is per account).
  const champions = championsIn(DEFAULT_CONTENT, (id) => championReleased(id, warriorReleased));
  const usable = useBattleStore((s) => champions.filter((c) => championUsableIn(s, c.heroId)).map((c) => c.heroId).join(','));
  const available = useBattleStore(useShallow(availableChampionsIn));
  const isLocked = (heroId: string) => !usable.split(',').includes(heroId);
  const selectedId = profile.selectedChampionId;
  // Which champion the detail shows (browsing) — the authoritative choice is `selectedId`.
  const [viewId, setViewId] = useState(selectedId);
  const view: ChampionPresentation = champions.find((c) => c.heroId === viewId) ?? champions[0]!;
  const hero = DEFAULT_CONTENT.heroes[view.heroId]!;
  const deck = activeDeck(heroProfile(profile, hero.id, DEFAULT_CONTENT));
  const deckSource = battleDeck(profile, hero.id, DEFAULT_CONTENT, DECK_RULES).source;
  const legal = deckSource === 'SAVED';
  const isSelected = view.heroId === selectedId;
  const locked = view.availability === 'LOCKED' || isLocked(view.heroId);
  const requirement = locked ? requirementText(unlockRequirement(profile, view.heroId, available)) : null;
  const portrait = championPortrait(view.heroId);
  const campaignHero = DEFAULT_CONTENT.heroes[defaultCampaignHero(ASCENT_CAMPAIGN)]?.name;
  const stats = [
    { label: 'Vida', value: hero.maxHp, icon: 'hp' as const },
    { label: 'Energía', value: hero.maxEnergy, icon: 'energy' as const },
    { label: 'Movimiento', value: hero.movePoints, icon: 'move' as const },
    { label: 'Mano', value: `${hero.startingHandSize}/${hero.maxHandSize}`, icon: 'deck' as const },
    ...(hero.summonCapacity ? [{ label: 'Invocación', value: hero.summonCapacity, icon: 'arcane' as const }] : []),
  ];

  return (
    <div className="champions" style={{ '--ch-art': portrait ? `url(${portrait})` : 'none' } as CSSProperties}>
      <header className="ch-header">
        <button type="button" className="db-back" onClick={closeChampions}>
          <span aria-hidden="true">‹</span> Menú
        </button>
        <div className="ch-title">
          <span className="menu-eyebrow">Elige quién juega</span>
          <h1>Campeones</h1>
        </div>
        <p className="ch-scope">
          {campaignHeroes(qaSummonerCampaign, warriorReleased).length > 1
            ? `Se usa en Escaramuza. En la campaña «${ASCENT_CAMPAIGN.name}» eliges campeón en su tarjeta: cada uno avanza por separado.`
            : `Se usa en Escaramuza. La campaña «${ASCENT_CAMPAIGN.name}» se juega siempre con el ${campaignHero}.`}
        </p>
      </header>

      <div className="ch-body">
        <nav className="ch-list" aria-label="Campeones">
          <ul>
            {champions.map((c) => {
              const name = DEFAULT_CONTENT.heroes[c.heroId]!.name;
              const state = c.availability === 'LOCKED' || isLocked(c.heroId) ? 'locked' : c.heroId === selectedId ? 'selected' : 'available';
              const badge=championCardStatus({active:state==='selected',locked:state==='locked',free:c.accessLabel==='GRATIS'});
              return (
                <li key={c.heroId}>
                  <button
                    type="button"
                    className={`ch-item is-${state}${c.heroId === view.heroId ? ' is-viewing' : ''}`}
                    data-champion={c.heroId}
                    data-state={state}
                    aria-pressed={c.heroId === view.heroId}
                    aria-label={`${name}, ${c.role}, ${badge.toLowerCase()}`}
                    onClick={() => setViewId(c.heroId)}
                  >
                    <Portrait heroId={c.heroId} className="ch-item-art" />
                    <span className="ch-item-text" aria-hidden="true">
                      <span className="ch-item-name">{name}</span>
                      <span className="ch-item-role">{c.role}</span>
                      <span className={`ch-badge is-${state}`} data-status={badge}>{badge}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <article className={`ch-detail${isSelected ? ' is-selected' : ''}`} data-champion={view.heroId} data-art-mode={view.heroArtMode} style={{'--champion-art-position':view.heroArtPosition??'50% 15%'} as CSSProperties} aria-labelledby="ch-name">
          <div className="ch-hero-art" aria-hidden="true">
            {portrait && <img src={portrait} alt="" draggable={false} />}
            {view.temporaryArt && <span className="ch-art-note">Arte temporal</span>}
          </div>

          <div className="ch-info">
            <div className="ch-headline">
              <span className="menu-eyebrow ch-role">{view.role}</span>
              <h2 id="ch-name" className="ch-name">
                {hero.name}
              </h2>
              <span className={`ch-badge ch-detail-status${isSelected?' is-selected':''}`} data-status={championCardStatus({active:isSelected,locked,free:view.accessLabel==='GRATIS'})}>{championCardStatus({active:isSelected,locked,free:view.accessLabel==='GRATIS'})}</span>
              <p className="ch-tagline">{view.tagline}</p>
              <p className="ch-identity" aria-label={`Identidad: ${view.identity.join(', ')}`}>
                {view.identity.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </p>
              {requirement && (
                <p className="ch-requirement" role="note">
                  🔒 {requirement}
                </p>
              )}
            </div>

            {!locked && <MasteryPanel heroId={view.heroId} />}
            <a className="ch-guide-link" href={championGuideHref(view.heroId)} target="_blank" rel="noopener noreferrer" title="Se abre en otra pestaña">Ver habilidades y mecánicas ↗</a>
            <p className="ch-desc">{view.description}</p>
            {view.heroId === 'archer' && (
              <p className="ch-desc">
                {archerCampaign
                  ? 'Campaña propia: «Sendero del Cazador». Gratis también en escaramuzas y PvP privado.'
                  : 'La campaña del Arquero llegará próximamente. Disponible gratis para escaramuzas y PvP privado.'}
              </p>
            )}

            <ul className="ch-stats" aria-label="Atributos">
              {stats.map((s) => (
                <li key={s.label}>
                  <GameIcon name={s.icon} />
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>

            <section className="ch-mechanic" aria-labelledby="ch-mechanic-title">
              <h3 id="ch-mechanic-title">
                <GameIcon name="arcane" /> {view.mechanic.title}
              </h3>
              <p>{view.mechanic.summary}</p>
              <ul>
                {view.mechanic.facts(hero, DEFAULT_CONTENT).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>

            <div className="ch-columns">
              <section aria-labelledby="ch-strengths">
                <h3 id="ch-strengths" className="ch-good">
                  Fortalezas
                </h3>
                <ul className="ch-points is-good">
                  {view.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="ch-weaknesses">
                <h3 id="ch-weaknesses" className="ch-bad">
                  Debilidades
                </h3>
                <ul className="ch-points is-bad">
                  {view.weaknesses.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
            </div>

            <section aria-labelledby="ch-style">
              <h3 id="ch-style" className="ch-subtitle">
                Estilo de juego
              </h3>
              <ul className="ch-ratings">
                {RATING_ORDER.map((k) => (
                  <Rating key={k} label={RATING_LABEL[k]} value={view.ratings[k]} />
                ))}
              </ul>
            </section>
          </div>

          <footer className="ch-actions">
            <div className="ch-deck">
              <GameIcon name="deck" />
              <span>
                <strong>{deck.name}</strong>
                <span className={legal ? 'ch-deck-ok' : 'ch-deck-bad'}>
                  {deckSize(deck.cards)}/{DECK_RULES.requiredSize} cartas
                  {deckSource === 'LEGACY'
                    ? ` · mazo antiguo: faltan ${DECK_RULES.requiredSize - deckSize(deck.cards)} (PvP lo exige completo)`
                    : deckSource === 'STARTER'
                      ? ' · inválido, se usará el inicial'
                      : ''}
                </span>
              </span>
            </div>
            <button type="button" className="db-btn ch-deck-btn" disabled={locked} onClick={() => openDeckBuilder(view.heroId)}>
              Editar mazo
            </button>
            <button
              type="button"
              className="db-btn db-btn-primary ch-select"
              disabled={locked}
              onClick={() => isSelected ? closeChampions() : selectChampion(view.heroId)}
            >
              {locked ? 'Bloqueado' : isSelected ? `Continuar con ${hero.name}` : `Elegir ${hero.name}`}
            </button>
          </footer>
        </article>
      </div>
    </div>
  );
}
