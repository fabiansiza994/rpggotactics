import '../../../styles/campaign.css';
import '../../../styles/menu.css';
import {CampaignChampionSelector,campaignProgressLabel} from '../components/CampaignChampionSelector';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import '../../../styles/campaign-carousel.css';
import '../../../styles/infernal.css';
import { WorldArrival } from '../components/WorldArrival';
import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from 'react';
import {
  activeDeck,
  ARCHER_ACT_1,
  campaignRoute,
  supportsHero,
  DECK_RULES,
  deckSize,
  heroProfile,
  encounterOrder,
  guestGateReached,
  GUEST_ENCOUNTER_LIMIT,
  nextEncounterId,
  SCENARIOS,
  scenarioBoardSize,
  type EncounterDef,
  type RouteProgress,
} from '../../../game';
import { championOf, championPortrait } from '../../assets/champions';
import { CHARACTER_PAINTINGS, ENVIRONMENT_PAINTINGS } from '../../assets/paintedAssets';
import { encounterIdentity } from '../../assets/visualIdentity';
import { SummonerQa } from '../components/SummonerQa';
import { campaignChampionsIn, championUsableIn, guestLimited, selectedCampaign, campaignOfWorld, useBattleStore, worldsIn } from '../../store/battleStore';
import { AccountChip } from '../components/Account';
import { GameIcon } from '../components/GameIcon';
import { boardLabel, RewardChoice, TIER_LABEL } from '../components/RunPanels';
import { objectiveBrief, OBJECTIVE_TAG } from '../format';
import { socialBadge, useSocialStore } from '../../social/socialStore';

/** A chosen mode, held while the menu plays its commit (confirm → recede → darken). */
type Pending = { key: string; start(): void };

/** Entry stagger slot (motion.css reads --i). */
const slot = (i: number) => ({ '--i': i }) as CSSProperties;

/** "V · El alfa" → numeral "V" + title "El alfa" (names carry their numeral in the data). */
function splitName(name: string): { numeral: string | null; title: string } {
  const [numeral, ...rest] = name.split(' · ');
  return rest.length
    ? { numeral: numeral ?? null, title: rest.join(' · ') }
    : { numeral: null, title: name };
}

function TierBadge({ tier }: { tier: EncounterDef['tier'] }) {
  if (tier === 'NORMAL') return <span className="path-tier">{TIER_LABEL[tier]}</span>;
  return (
    <span className={`path-tier tier-badge tier-badge-${tier.toLowerCase()}`}>
      {tier === 'BOSS' ? <GameIcon name="melee" /> : <span aria-hidden="true">◆</span>}
      {TIER_LABEL[tier]}
    </span>
  );
}

const PROGRESS_LABEL: Record<RouteProgress, string> = {
  COMPLETED: 'Completado',
  CURRENT: 'Siguiente',
  LOCKED: 'Bloqueado',
};

/** Small state badge on a route medallion: ✓ completed, padlock locked, nothing when current. */
function ProgressBadge({ progress }: { progress: RouteProgress }) {
  if (progress === 'CURRENT') return null;
  return (
    <span className={`path-state path-state-${progress.toLowerCase()}`} aria-hidden="true">
      {progress === 'COMPLETED' ? (
        '✓'
      ) : (
        <svg viewBox="0 0 12 12" focusable="false">
          <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
          <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
        </svg>
      )}
    </span>
  );
}

/** New-campaign confirmation (native modal dialog, like the pile viewer). */
function ConfirmNewCampaign({
  completed,
  heroName,
  worldName,
  onCancel,
  onConfirm,
}: {
  completed: boolean;
  heroName: string;
  /** Set when the campaign has worlds: replaying one never relocks what it unlocked. */
  worldName?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pile-dialog confirm-dialog"
      aria-labelledby="confirm-new-title"
      onCancel={onCancel}
      onClose={onCancel}
    >
      <h2 id="confirm-new-title">¿Iniciar una nueva campaña?</h2>
      <p>
        {completed && worldName
          ? `Vuelves a recorrer «${worldName}» con el ${heroName}. El mundo sigue completado y lo que desbloqueaste se conserva.`
          : completed
            ? `Se borrará el registro de la campaña completada del ${heroName}.`
            : `Se perderá el progreso actual del ${heroName}${worldName ? ` en «${worldName}»` : ''}.`}{' '}
        Los demás campeones, tu colección y tus mazos se conservan.
      </p>
      <div className="confirm-actions">
        <button type="button" autoFocus onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="confirm-danger" onClick={onConfirm}>
          Nueva campaña
        </button>
      </div>
    </dialog>
  );
}

export function MainMenu({ onPvp, onStore, onSocial, mode }: { onPvp?: () => void; onStore?: () => void; onSocial?: () => void; mode?: 'campaign'|'stories'|'skirmish' }) {
  const socialCount = useSocialStore(socialBadge);
  const signedIn = useBattleStore((s) => s.account.status === 'READY');
  const skirmish = useBattleStore((s) => s.skirmish);
  const account = useBattleStore((s) => s.account);
  const startScenario = useBattleStore((s) => s.startScenario);
  const startRun = useBattleStore((s) => s.startRun);
  const continueRun = useBattleStore((s) => s.continueRun);
  const openDeckBuilder = useBattleStore((s) => s.openDeckBuilder);
  const openChampions = useBattleStore((s) => s.openChampions);
  const run = useBattleStore((s) => s.run);
  const runs = useBattleStore((s) => s.runs);
  const worldRuns = useBattleStore((s) => s.worldRuns);
  const campaignHeroId = useBattleStore((s) => s.campaignHeroId);
  const selectCampaignHero = useBattleStore((s) => s.selectCampaignHero);
  // Worlds (acts) of the campaign for the shown champion; one world = the historical card.
  const campaignWorldId = useBattleStore((s) => s.campaignWorldId);
  const selectWorld = useBattleStore((s) => s.selectWorld);
  const worldsJson = useBattleStore((s) => JSON.stringify(worldsIn(s, s.campaignHeroId)));
  const allWorlds = JSON.parse(worldsJson) as ReturnType<typeof worldsIn>;
  const [campaignKind, setCampaignKind] = useState<'MAIN_ACT' | 'CHAMPION_STORY'>('MAIN_ACT');
  const kindOf = (w: (typeof allWorlds)[number]) => w.kind ?? campaignOfWorld(w.id).kind ?? 'MAIN_ACT';
  const hasStories = allWorlds.some(w => kindOf(w) === 'CHAMPION_STORY');
  const activeKind = mode ? mode==='stories'?'CHAMPION_STORY':'MAIN_ACT' : hasStories ? campaignKind : 'MAIN_ACT';
  const worlds = allWorlds.filter(w => kindOf(w) === activeKind);
  const continuingWorld = [...worlds].reverse().find(w => w.unlocked && !w.completed)
    ?? worlds.find(w => w.unlocked);
  const continuingWorldId = continuingWorld?.id;
  useEffect(() => {
    if (continuingWorldId && continuingWorldId !== useBattleStore.getState().campaignWorldId)
      selectWorld(continuingWorldId);
  }, [campaignHeroId, continuingWorldId, selectWorld]);
  const [browsedAct, setBrowsedAct] = useState<{hero:string; id:string; direction:number} | null>(null);
  const shownWorld = worlds.find(w => w.id === (browsedAct?.hero === campaignHeroId ? browsedAct.id : continuingWorld?.id)) ?? worlds[0];
  const shownCampaign = campaignOfWorld(shownWorld?.id ?? campaignWorldId);
  const shownRun = shownCampaign.id === 'ascent' ? runs[campaignHeroId] ?? null : worldRuns[shownCampaign.id]?.[campaignHeroId] ?? null;
  const actIndex = worlds.findIndex(w => w.id === shownWorld?.id);
  const browseAct = (direction:number) => {
    const target = worlds[actIndex + direction];
    if (!target) return;
    setSelectedId(null);
    setBrowsedAct({hero:campaignHeroId,id:target.id,direction});
  };
  const campaign = useBattleStore(selectedCampaign);
  const world = worlds.find((w) => w.id === campaignWorldId) ?? null;
  const nextWorld = world ? (worlds.find((w) => w.order === world.order + 1 && w.unlocked) ?? null) : null;
  const profile = useBattleStore((s) => s.profile);
  // The champion who plays the campaign shown here (each one keeps its own run).
  const qaSummonerCampaign = useBattleStore(s=>s.qaSummonerCampaign);
  // Only champions this player has unlocked (and that are released) can play the campaign.
  const heroChoices = useBattleStore((s) => campaignChampionsIn(s).join(',')).split(',').filter(Boolean);
  const usable = useBattleStore((s) => Object.keys(DEFAULT_CONTENT.heroes).filter((id) => championUsableIn(s, id)).join(','))
    .split(',')
    .filter(Boolean);
  const openGuestGate = () => useBattleStore.setState({ guestGate: true });
  const gated = useBattleStore((s) => guestLimited(s) && guestGateReached(selectedCampaign(s), s.run));
  const deckCount = deckSize(
    activeDeck(heroProfile(profile, campaignHeroId, DEFAULT_CONTENT)).cards,
  );
  // Skirmish fights with the champion chosen in Campeones (the campaign keeps its own hero).
  const champion = DEFAULT_CONTENT.heroes[usable.includes(profile.selectedChampionId) ? profile.selectedChampionId : (usable[0] ?? DEFAULT_CONTENT.defaultHeroId ?? 'mage')]!;
  const championDeckCount = deckSize(
    activeDeck(heroProfile(profile, champion.id, DEFAULT_CONTENT)).cards,
  );
  const championPortraitSrc = championPortrait(champion.id);
  const encounters = encounterOrder(campaign);
  const route = campaignRoute(shownCampaign, shownRun).map(n => shownWorld?.unlocked ? n : {...n, progress: 'LOCKED' as const});
  const nextId = nextEncounterId(campaign, run);
  const next = campaignRoute(campaign, run).find((n) => n.encounter.id === nextId) ?? null;
  const completedCount = campaignRoute(campaign, run).filter((n) => n.progress === 'COMPLETED').length;
  const hero = DEFAULT_CONTENT.heroes[campaignHeroId];
  const count = (tier: EncounterDef['tier']) => encounters.filter((e) => e.tier === tier).length;
  const boards = [...new Set(encounters.map(boardLabel))];
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [selectorOpen,setSelectorOpen] = useState(false);
  const selectorEntries = heroChoices.filter(id=>supportsHero(shownCampaign,id)).map(id=>{
    const ownRun=shownCampaign.id==='ascent'?runs[id]:worldRuns[shownCampaign.id]?.[id];
    return {id,name:DEFAULT_CONTENT.heroes[id]?.name??id,portrait:championPortrait(id)??'',completed:ownRun?.completedEncounterIds.length??0,total:encounterOrder(shownCampaign).length};
  });
  // Details follow the next encounter unless the player picks another node (tap or focus).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = route.find((n) => n.encounter.id === selectedId) ?? route.find(n => n.progress === 'CURRENT') ?? route[0]!;
  const detailName = splitName(detail.encounter.name);
  // First choice wins; repeated clicks during the commit are ignored.
  const choose = (key: string, start: () => void) => setPending((p) => p ?? { key, start });
  const chosen = (key: string) => (pending?.key === key ? ' is-chosen' : '');
  // A cloud start can fail (shown by the cloud banner): give the menu back instead of staying committed.
  const startCampaign = () => void startRun().then((ok) => ok || setPending(null));
  // The commit animation itself hands over to the battle: no timer to drift from the CSS.
  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.animationName === 'menu-commit') pending?.start();
  };
  return (
    <div
      className={`menu${mode ? ` play-content-${mode}` : ''}${pending ? ' is-committing' : ''}`}
      data-world={campaignWorldId}
      onAnimationEnd={onAnimationEnd}
      aria-busy={pending !== null}
      style={{ '--menu-backdrop': `url(${ENVIRONMENT_PAINTINGS[campaignWorldId === 'archer_act_1' ? 'veil_forest' : campaignWorldId === 'world_2' ? 'infernal_forge' : 'duel']})` } as CSSProperties}
    >
      <WorldArrival worldId={campaignWorldId} />
      {!mode && <header className="menu-header menu-enter" style={slot(0)}>
        <h1 className="menu-title">
          RPG-GO <span>Tactics</span>
        </h1>
        <p className="menu-tagline">Táctica arcana por turnos</p>
        <AccountChip />
        <button className="menu-nav-pvp menu-nav-store" type="button" onClick={onStore}>
          ◆ Tienda
        </button>
        <button
          className="menu-nav-pvp menu-nav-social"
          type="button"
          onClick={onSocial}
          disabled={!signedIn}
          aria-label={socialCount ? `Amigos, ${socialCount} pendientes` : 'Amigos'}
        >
          Amigos
          {socialCount > 0 && (
            <em className="social-badge" aria-hidden="true">
              {socialCount > 99 ? '99+' : socialCount}
            </em>
          )}
        </button>
        <button
          className="menu-nav-pvp"
          type="button"
          onClick={onPvp}
          disabled={useBattleStore.getState().account.status !== 'READY'}
        >
          PvP · Partida privada
        </button>
        <button
          type="button"
          className="menu-nav-champions"
          disabled={pending !== null}
          onClick={openChampions}
        >
          <GameIcon name="arcane" />
          Campeones
        </button>
        <span className="menu-version">v0.2 · vertical slice</span>
      </header>}

      {mode!=='skirmish'&&<div className="menu-stage">
        <section
          className={`campaign-hero menu-enter${chosen('campaign')}`}
          style={slot(1)}
          aria-labelledby="campaign-title"
          data-campaign={run ? run.status.toLowerCase() : 'new'}
        >
          {heroChoices.map(id => CHARACTER_PAINTINGS[id] && (
            <img key={id} className={`campaign-hero-art${id === campaignHeroId ? ' is-current' : ''}`}
              data-hero={id} src={CHARACTER_PAINTINGS[id]} alt="" aria-hidden="true" />
          ))}
          <div className="campaign-hero-body">
            <span className="menu-eyebrow">Campaña{hero ? ` · ${hero.name}` : ''}</span>
            {!mode&&<div className="campaign-selected-champion" aria-label="Campeón seleccionado">
              <img src={championPortrait(campaignHeroId)} alt=""/>
              <div aria-live="polite"><strong>{hero?.name}</strong><small>{campaignProgressLabel(shownRun?.completedEncounterIds.length??0,encounterOrder(shownCampaign).length)}</small><small>Mazo {deckCount}/{DECK_RULES.requiredSize}</small></div>
              {activeKind==='CHAMPION_STORY'?<span className="campaign-story-fixed">HISTORIA DE CAMPEÓN<br/>Exclusiva de {hero?.name}</span>:selectorEntries.length>1&&<button type="button" disabled={pending!==null} onClick={()=>setSelectorOpen(true)}>Cambiar campeón</button>}
            </div>
            }
            {selectorOpen&&activeKind==='MAIN_ACT'&&<CampaignChampionSelector entries={selectorEntries} selectedId={campaignHeroId} actName={shownCampaign.name} onClose={()=>setSelectorOpen(false)} onSelect={id=>{if(pending!==null||!selectorEntries.some(e=>e.id===id))return;setSelectorOpen(false);setSelectedId(null);selectCampaignHero(id);}}/>}
            {qaSummonerCampaign && import.meta.env.VITE_SUMMONER_CAMPAIGN_QA === '1' && <SummonerQa />}
            <h2 id="campaign-title" className="campaign-title">
              {campaign.name}
            </h2>
            <p className="campaign-desc">
              {campaignWorldId === 'world_2' ? 'Cruza las puertas de ceniza. Cadenas, hornos y ríos de magma custodian la gran forja: cada paso importa.' : campaignWorldId === ARCHER_ACT_1.id ? ARCHER_ACT_1.description : 'Cada misión pide algo distinto: eliminar, cazar a un líder, recuperar reliquias, escapar, resistir o proteger. Gana, elige 1 de 3 recompensas y avanza.'}
            </p>
            <ul className="campaign-facts">
              {run && (
                <li className="fact-progress">
                  <strong>{completedCount}</strong>/{encounters.length} completados
                </li>
              )}
              {!run && (
                <li>
                  <strong>{encounters.length}</strong> encuentros
                </li>
              )}
              <li className="fact-elite">
                <strong>{count('ELITE')}</strong> {count('ELITE') === 1 ? 'élite' : 'élites'}
              </li>
              <li className="fact-boss">
                <strong>{count('BOSS')}</strong> {count('BOSS') === 1 ? 'jefe' : 'jefes'}
              </li>
              <li className="fact-boards">{boards.join(' → ')}</li>
            </ul>
            <div className="campaign-actions">
              {run?.status === 'COMPLETED' && nextWorld ? (
                <>
                  <span className="campaign-done" role="status">
                    <span aria-hidden="true">✓</span> {world?.name ?? 'Campaña'} completado
                  </span>
                  <button
                    type="button"
                    className="campaign-cta"
                    data-next-world={nextWorld.id}
                    onClick={() => {
                      setSelectedId(null);
                      selectWorld(nextWorld.id);
                    }}
                  >
                    <GameIcon name="arcane" />
                    <span className="cta-text">
                      Ir a {nextWorld.name}
                      <span className="cta-sub">
                        Mundo {nextWorld.order} · {nextWorld.completedEncounters}/{nextWorld.totalEncounters}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="campaign-secondary" onClick={() => setConfirmNew(true)}>
                    Rejugar {world?.name ?? 'campaña'}
                  </button>
                </>
              ) : run?.status === 'COMPLETED' ? (
                <>
                  <span className="campaign-done" role="status">
                    <span aria-hidden="true">✓</span> Campaña completada
                  </span>
                  <button
                    type="button"
                    className="campaign-cta"
                    onClick={() => setConfirmNew(true)}
                  >
                    <GameIcon name="arcane" />
                    Nueva campaña
                  </button>
                </>
              ) : run ? (
                <>
                  <button
                    type="button"
                    className="campaign-cta"
                    onClick={() =>
                      run.status === 'CHOOSING_REWARD'
                        ? setRewardOpen(true)
                        : gated
                          ? openGuestGate()
                          : choose('campaign', continueRun)
                    }
                  >
                    <GameIcon name="arcane" />
                    <span className="cta-text">
                      Continuar campaña
                      <span className="cta-sub">
                        {run.status === 'CHOOSING_REWARD'
                          ? 'Recompensa pendiente'
                          : gated
                            ? `Crea una cuenta para seguir después del encuentro ${GUEST_ENCOUNTER_LIMIT}`
                            : next &&
                              `Encuentro ${next.index + 1}/${encounters.length} · ${splitName(next.encounter.name).title}`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="campaign-secondary"
                    onClick={() => setConfirmNew(true)}
                  >
                    Nueva campaña
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="campaign-cta"
                  onClick={() => choose('campaign', startCampaign)}
                >
                  <GameIcon name="arcane" />
                  Iniciar campaña
                </button>
              )}
              <button
                type="button"
                className="campaign-secondary deck-entry"
                disabled={pending !== null}
                onClick={() => openDeckBuilder(campaignHeroId)}
                aria-label={`Mazo y colección: ${deckCount} de ${DECK_RULES.requiredSize} cartas`}
              >
                <GameIcon name="deck" />
                Mazo
                <span className="deck-entry-count" aria-hidden="true">
                  {deckCount}/{DECK_RULES.requiredSize}
                </span>
              </button>
            </div>
          </div>
        </section>

        <section className="campaign-path menu-enter" style={slot(2)} aria-labelledby="path-title">
          {!mode&&<div className="campaign-kind-nav" role="group" aria-label="Tipo de campaña">
            <button type="button" aria-pressed={activeKind === 'MAIN_ACT'} onClick={() => { setBrowsedAct(null); setCampaignKind('MAIN_ACT'); }}>Actos principales</button>
            {hasStories && <button type="button" aria-pressed={activeKind === 'CHAMPION_STORY'} onClick={() => { setBrowsedAct(null); setCampaignKind('CHAMPION_STORY'); }}>Historias de campeón</button>}
          </div>}
          <p className="muted campaign-kind-copy">{activeKind === 'MAIN_ACT' ? 'Combate a través de la historia principal con cualquiera de tus campeones compatibles.' : 'Misiones especiales centradas en la historia y las habilidades de un campeón.'}</p>
          <header className="route-act-nav" aria-label="Navegación entre actos">
            <button type="button" aria-label="Acto anterior" disabled={actIndex <= 0}
              onClick={() => browseAct(-1)}>‹</button>
            <h2 id="path-title" className="menu-section-title" aria-live="polite">
              {activeKind === 'CHAMPION_STORY' ? `Historia de ${hero?.name ?? 'campeón'}` : shownWorld?.actLabel ?? `Acto ${shownWorld?.order ?? 1}`} · {shownWorld?.name ?? shownCampaign.name}
              <span className="path-count"> {shownWorld?.completedEncounters ?? 0}/{shownWorld?.totalEncounters ?? route.length}</span>
              {!shownWorld?.unlocked && <small> · Bloqueado</small>}
            </h2>
            <button type="button" aria-label="Acto siguiente" disabled={actIndex < 0 || actIndex >= worlds.length - 1}
              onClick={() => browseAct(1)}>›</button>
          </header>
          <div key={`${campaignHeroId}:${shownWorld?.id}`} className="route-act-slide"
            data-act={shownWorld?.id} data-direction={browsedAct?.direction ?? 1}>
          <ol className="path-nodes">
            {route.map(({ encounter: e, index: i, progress }) => {
              const { numeral, title } = splitName(e.name);
              const brief = objectiveBrief(e.objectives[0]!, e);
              return (
                <li
                  key={e.id}
                  className={`path-node tier-${e.tier.toLowerCase()} progress-${progress.toLowerCase()}${
                    detail.encounter.id === e.id ? ' is-selected' : ''
                  }`}
                  style={slot(i)}
                  data-encounter={e.id}
                  data-progress={progress.toLowerCase()}
                  aria-current={progress === 'CURRENT' ? 'step' : undefined}
                >
                  <button
                    type="button"
                    className="path-hit"
                    aria-label={`${e.name}: ${PROGRESS_LABEL[progress]}. ${TIER_LABEL[e.tier]}, ${brief}.`}
                    aria-pressed={detail.encounter.id === e.id}
                    onClick={() => setSelectedId(e.id)}
                    onFocus={() => setSelectedId(e.id)}
                  />
                  <span className="path-mark-wrap" aria-hidden="true">
                    <span className="path-mark">
                      <span>{numeral ?? i + 1}</span>
                    </span>
                    <ProgressBadge progress={progress} />
                  </span>
                  <span className="path-text" aria-hidden="true">
                    <span className="path-name">{title}</span>
                    <span className="path-meta">
                      <TierBadge tier={e.tier} />
                      <span className="path-objective">{OBJECTIVE_TAG[e.objectives[0]!.type]}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <div
            className={`path-detail progress-${detail.progress.toLowerCase()} tier-${detail.encounter.tier.toLowerCase()}`}
            aria-live="polite"
          >
            <span className="path-detail-state">{PROGRESS_LABEL[detail.progress]}</span>
            <span className="path-detail-name">
              {detailName.numeral && (
                <span className="path-detail-numeral">{detailName.numeral} · </span>
              )}
              {detailName.title}
            </span>
            <span className="path-detail-objective">
              <GameIcon name="arcane" />{' '}
              {detail.encounter.objectives
                .map((o) => objectiveBrief(o, detail.encounter))
                .join(' · ')}
            </span>
            <span className="path-detail-meta">
              {TIER_LABEL[detail.encounter.tier]} · {boardLabel(detail.encounter)}
            </span>
          </div>
          </div>
        </section>
      </div>}

      {(!mode||mode==='skirmish')&&<section className="skirmish" aria-labelledby="skirmish-title">
        <h2 id="skirmish-title" className="menu-section-title menu-enter" style={slot(3)}>
          Escaramuza
        </h2>
        {!mode&&<div className="skirmish-loadout menu-enter" style={slot(3)} data-champion={champion.id}>
          <span className="loadout-art" aria-hidden="true">
            {championPortraitSrc && <img src={championPortraitSrc} alt="" />}
          </span>
          <span className="loadout-text">
            <span className="loadout-label">Campeón</span>
            <strong className="loadout-name">{champion.name}</strong>
            <span className="loadout-role">{championOf(champion.id)?.role}</span>
          </span>
          <span className="loadout-text">
            <span className="loadout-label">Mazo</span>
            <strong className="loadout-deck">
              {championDeckCount}/{DECK_RULES.requiredSize}
            </strong>
          </span>
          <span className="loadout-actions">
            <button
              type="button"
              className="campaign-secondary"
              disabled={pending !== null}
              onClick={openChampions}
            >
              Cambiar
            </button>
            <button
              type="button"
              className="campaign-secondary"
              disabled={pending !== null}
              aria-label={`Mazo del ${champion.name}`}
              onClick={() => openDeckBuilder(champion.id)}
            >
              <GameIcon name="deck" /> Mazo
            </button>
          </span>
        </div>
        }
        {skirmish?.run.status === 'CHOOSING_REWARD' && <RewardChoice run={skirmish.run} />}
        {champion.id === 'summoner' && (
          <p className="muted">
            {account.status === 'READY'
              ? 'Victorias verificadas: desbloqueos del Invocador. First Blood: normal · Crystal Guard: élite · Escape: jefe.'
              : 'Práctica como invitado. Inicia sesión para ganar y guardar desbloqueos del Invocador.'}
          </p>
        )}
        <div className="mode-list">
          {SCENARIOS.map((s, i) => {
            const place = encounterIdentity(s.id);
            const board = scenarioBoardSize(s);
            const heroName = champion.name;
            const tags = s.objectives.map((o) => OBJECTIVE_TAG[o.type]).join(' · ');
            return (
              <button
                key={s.id}
                type="button"
                className={`mode-card menu-enter${chosen(s.id)}`}
                style={
                  {
                    ...slot(4 + i),
                    '--mode-art': `url(${ENVIRONMENT_PAINTINGS[place.theme] ?? ''})`,
                    '--mode-accent': place.accent,
                  } as CSSProperties
                }
                aria-label={`${s.name} · ${tags}`}
                aria-describedby={`mode-${s.id}-place mode-${s.id}-desc`}
                onClick={() =>
                  choose(s.id, () => void startScenario(s.id).then((ok) => ok || setPending(null)))
                }
              >
                <span className="mode-art" aria-hidden="true" />
                <span className="mode-body">
                  <span className="mode-tag">{tags}</span>
                  <span className="mode-title">{s.name}</span>
                  <span className="mode-place" id={`mode-${s.id}-place`}>
                    {place.title}
                  </span>
                  <span className="mode-desc" id={`mode-${s.id}-desc`}>
                    {s.description}
                  </span>
                  <span className="mode-foot">
                    <span className="mode-meta">
                      {heroName} · {board.rows}×{board.columns}
                    </span>
                    <span className="mode-go" aria-hidden="true">
                      Jugar ›
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>}

      {confirmNew && (
        <ConfirmNewCampaign
          completed={run?.status === 'COMPLETED'}
          heroName={hero?.name ?? ''}
          worldName={worlds.length > 1 ? world?.name : undefined}
          onCancel={() => setConfirmNew(false)}
          onConfirm={() => {
            setConfirmNew(false);
            choose('campaign', startCampaign);
          }}
        />
      )}
      {rewardOpen && run?.status === 'CHOOSING_REWARD' && (
        <div
          className="result-overlay menu-reward"
          role="dialog"
          aria-modal="true"
          aria-label="Recompensa pendiente"
        >
          <RewardChoice run={run} />
        </div>
      )}
    </div>
  );
}
