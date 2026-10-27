import type { ChampionDeckSummary } from '../../game';
import '../../styles/my-decks.css';
import {pvpChampionRestriction} from './eligibility';
import {CampaignChampionSelector} from '../react/components/CampaignChampionSelector';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../qa/shapeshifter/runtime';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { activeDeck, DECK_RULES, deckSize, heroProfile } from '../../game';
import { type PvpMode } from '../../game/pvp/dominion';
import { PVP_MAPS, mapScenario, pvpMap, type PvpMapDefinition } from '../../game/pvp/maps';
import { championsIn, championPortrait, championOf } from '../assets/champions';
import { ProfileFrame } from '../shop/ProfileFrame';
import { RankedCrest } from '../ranked/RankedCosmetics';
import { ENVIRONMENT_PAINTINGS } from '../assets/paintedAssets';
import { loadSession } from '../cloud/session';
import { championUsableIn, useBattleStore, warriorReleasedIn } from '../store/battleStore';
import { championReleased } from '../campaignRelease';
import { GameIcon } from '../react/components/GameIcon';
import { QueueTabs, RankedIntro, type QueueKind } from '../ranked/RankedViews';
import { MasteryTitleLabel, OwnMasteryTitle } from '../mastery/MasteryViews';
import type { RankedSnapshot } from '../ranked/rankedApi';
import '../../styles/pvp-lobby.css';

export interface LobbyRoom {
  code: string;
  mode: PvpMode;
  mapId: string;
  seat: number;
  /** frameId: the member's equipped profile frame (public cosmetic, resolved by the server). */
  /** titleId: equipped mastery title (public catalog id, resolved by the server). */
  members: { name: string; heroId: string; deckId?: string; frameId?: string | null; titleId?: string | null; crestId?: string | null; badgeId?: string | null; ready: boolean; connected: boolean }[];
  /** Ranked Preseason room (server-created by the queue); absent/null = casual. */
  ranked?: RankedSnapshot | null;
}
interface Props {
  room: LobbyRoom | null;
  hero: string;
  decks?: ChampionDeckSummary[];
  deckId?: string;
  onDeck?: (id:string)=>void;
  loadoutLocked?: boolean;
  mode: PvpMode;
  mapId: string;
  code: string;
  busy: boolean;
  network: string;
  error: string;
  onHero: (id: string) => void;
  onMode: (mode: PvpMode) => void;
  onMap: (id: string) => void;
  onCode: (code: string) => void;
  onAction: (action: string) => void;
  onExit: () => void;
  /** PvP → Historial (shown while no room is open). */
  onHistory?: () => void;
  /** Casual / Ranked switch (shown only when ranked is available to this account). */
  queueKind?: QueueKind;
  onQueueKind?: (q: QueueKind) => void;
  /** Ranked panel shown instead of mode/map selection while queueKind is RANKED. */
  rankedSlot?: ReactNode;
}
const MODES = [
  {
    id: 'DUEL',
    name: 'Duelo',
    icon: 'melee',
    tagline: 'Dos campeones. Un vencedor.',
    description: 'Derrota al campeón rival.',
    goal: 'Victoria por combate',
  },
  {
    id: 'DOMINION',
    name: 'Dominio Arcano',
    icon: 'arcane',
    tagline: 'Conquista el campo.',
    description: 'Controla tres nodos. Alcanza 8 puntos o derrota al rival.',
    goal: 'Control de objetivos',
  },
] as const;

function MapPreview({ map, mode }: { map: PvpMapDefinition; mode: PvpMode }) {
  const layout = mapScenario(map, mode).layout;
  return (
    <div
      className="lobby-map-grid"
      role="img"
      aria-label={`Vista previa: ${map.name}`}
      style={{ gridTemplateColumns: `repeat(${layout[0]!.length}, 1fr)` }}
    >
      {layout.flatMap((row, y) =>
        row
          .split('')
          .map((tile, x) => (
            <i
              key={`${x}-${y}`}
              data-tile={tile}
              data-node={
                mode === 'DOMINION' && map.objectiveNodes.some((p) => p.x === x && p.y === y)
                  ? 'true'
                  : undefined
              }
            />
          )),
      )}
    </div>
  );
}
function TerrainTags({ map }: { map: PvpMapDefinition }) {
  const tiles = map.layout.join('');
  const tags = [
    ['C', 'Cobertura'],
    ['H', 'Peligro'],
    ['A', 'Arcano'],
    ['#', 'Vacío'],
  ];
  return (
    <span className="lobby-tags">
      {tags
        .filter(([tile]) => tiles.includes(tile!))
        .map(([tile, label]) => (
          <span key={tile} data-terrain={tile}>
            {label}
          </span>
        ))}
      {!tags.some(([tile]) => tiles.includes(tile!)) && <span>Terreno neutral</span>}
    </span>
  );
}

export function PvpLobby(props: Props) {
  const {
    room,
    hero,
    mode,
    mapId,
    code,
    busy,
    network,
    error,
    onHero,
    onMode,
    onMap,
    onCode,
    onAction,
    onExit,
    onHistory,
    queueKind = 'CASUAL',
    onQueueKind,
    rankedSlot,
    decks, deckId, onDeck, loadoutLocked=false,
  } = props;
  const rankedSetup = !room && queueKind === 'RANKED' && !!rankedSlot;
  const rankedRoom = room?.ranked ?? null;
  const profile = useBattleStore((s) => s.profile);
  const [choosing, setChoosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeButton = useRef<HTMLButtonElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [room?.code]);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  function closeChooser() {
    setChoosing(false);
    changeButton.current?.focus();
  }
  const warriorReleased = useBattleStore(warriorReleasedIn);
  const activeMode = room?.mode ?? mode;
  const map = pvpMap(room?.mapId ?? mapId, activeMode);
  const selectedMode = MODES.find((m) => m.id === activeMode)!;
  const local = room?.members[room.seat];
  const rival = room?.members[1 - room.seat];
  const localHero = local?.heroId ?? hero;
  const heroDecks = heroProfile(profile, localHero, DEFAULT_CONTENT);
  const deck = heroDecks.decks.find(d=>d.id===deckId) ?? activeDeck(heroDecks);
  const deckValid = decks ? !!decks.find(d=>d.deckId===deckId)?.valid : true;
  const deckCards = deckSize(deck.cards);
  // PvP needs a complete deck (the server re-checks): an incomplete/legacy deck says so here.
  const deckLabel =
    deckCards === DECK_RULES.requiredSize
      ? `${deck.name} · ${deckCards} cartas`
      : `${deck.name} · ${deckCards}/${DECK_RULES.requiredSize} cartas · incompleto, no válido en PvP`;
  const restriction=pvpChampionRestriction(localHero);
  const isReady = !!local?.ready;
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room!.code);
      setCopyFailed(false);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  }
  function player(member: LobbyRoom['members'][number] | undefined, own: boolean) {
    const id = own ? localHero : member?.heroId;
    return (
      <article
        className={`lobby-combatant ${own ? 'is-local' : 'is-rival'} ${member?.ready ? 'is-ready' : ''} ${!own && !member ? 'is-waiting' : ''}`}
        key={`${own ? 'local' : 'rival'}-${id ?? 'waiting'}`}
      >
        <span className="lobby-eyebrow">
          {own
            ? `Jugador ${room ? (room.seat === 0 ? 'A' : 'B') : 'A'} · Tú`
            : `Jugador ${room?.seat === 1 ? 'A' : 'B'} · Rival`}
        </span>
        <div className="lobby-portrait">
          {id ? (
            <ProfileFrame frameId={member?.frameId}>
              <img src={championPortrait(id)} alt="" draggable={false} />
            </ProfileFrame>
          ) : (
            <GameIcon name="wait" />
          )}
        </div>
        <div className="lobby-combatant-info">
          <h2>{id ? DEFAULT_CONTENT.heroes[id]?.name : 'Esperando rival'}</h2>
          <p className="lobby-player-name">
            <RankedCrest crestId={member?.crestId} />
            {own
              ? (local?.name ?? loadSession()?.username)
              : (member?.name ?? (rankedSetup ? 'Rival de la cola clasificatoria' : 'Comparte el código de tu sala'))}
          </p>
          {own ? (local ? <MasteryTitleLabel titleId={local.titleId} /> : <OwnMasteryTitle />) : <MasteryTitleLabel titleId={member?.titleId} />}
          {own ? (
            <p className="lobby-deck">
              <GameIcon name="deck" />
              <span>
                Mazo activo
                <br />
                <b>{deckLabel}</b>
              </span>
            </p>
          ) : member ? (
            <p className="lobby-role">{championOf(member.heroId)?.role}</p>
          ) : (
            <p className="lobby-role">Un lugar en la arena te espera.</p>
          )}
          <div className="lobby-player-status" aria-live="polite">
            {room ? (
              <>
                <span className={`lobby-status-dot ${member?.connected ? 'is-connected' : ''}`} />
                <span>
                  {member ? (member.connected ? 'Conectado' : 'Desconectado') : 'Esperando'}
                </span>
                <b className={member?.ready ? 'ready-mark' : ''}>
                  {member?.ready ? '✓ Listo' : member ? 'Preparando' : ''}
                </b>
              </>
            ) : (
              <span>{own ? championOf(id!)?.role : rankedSetup ? 'Clasificatoria · 1 vs 1' : 'Sala privada · 1 vs 1'}</span>
            )}
          </div>
          {own && !rankedRoom && (
            <button
              ref={changeButton}
              className="lobby-change"
              disabled={busy||loadoutLocked}
              onClick={() => setChoosing(true)}
            >
              Cambiar campeón
            </button>
          )}
        </div>
        {own&&decks&&onDeck&&<label className="pvp-deck-choice">Mazo · {DEFAULT_CONTENT.heroes[localHero]?.name}<select aria-label="Mazo para PvP o Ranked" value={deckId??''} disabled={loadoutLocked} onChange={e=>onDeck(e.target.value)}>{decks.map(d=><option key={d.deckId} value={d.deckId}>{d.name} · {d.cardCount}/{d.maxCards}{d.isDefault?' · Predeterminado':''}{d.valid?'':' · Inválido'}</option>)}</select>{!deckValid&&<small role="status">Mazo inválido: edítalo antes de entrar a la arena.</small>}{loadoutLocked&&<small>Mazo fijado para esta búsqueda o sala.</small>}</label>}
      </article>
    );
  }
  return (
    <main
      className={`pvp-lobby ${room ? 'has-room' : 'is-setup'}`}
      style={{ '--lobby-backdrop': `url(${ENVIRONMENT_PAINTINGS.duel})` } as CSSProperties}
    >
      <div className="lobby-shell">
        <header className="lobby-header">
          <button className="lobby-back" onClick={onExit}>
            <span aria-hidden="true">‹</span> Menú
          </button>
          <div>
            <span className="lobby-eyebrow">
              RPG-GO TACTICS · {rankedRoom ? 'PARTIDA CLASIFICATORIA' : rankedSetup ? 'CLASIFICATORIA' : 'ARENA PRIVADA'}
            </span>
            <h1>{room ? 'La arena os espera' : 'Elige tu batalla'}</h1>
          </div>
          <span className="lobby-network" role="status">
            <i data-connected={network === 'Conectado'} />
            {busy ? 'Preparando…' : network === 'Sin sala' ? (rankedSetup ? 'Clasificatoria' : 'Partida privada') : network}
          </span>
          {!room && rankedSlot && onQueueKind && <QueueTabs value={queueKind} onChange={onQueueKind} disabled={busy} />}
          {!room && onHistory && (
            <button className="lobby-history" onClick={onHistory}>
              Historial
            </button>
          )}
        </header>
        <div className="lobby-content" ref={content}>
          <section className="lobby-versus" aria-label="Jugadores de la partida">
            {player(local, true)}
            <div className="lobby-vs" aria-hidden="true">
              <span>VS</span>
              <i>◇</i>
            </div>
            {player(rival, false)}
          </section>

          {rankedSetup ? (
            rankedSlot
          ) : !room ? (
            <div className="lobby-selection">
              <section className="lobby-modes" aria-labelledby="lobby-mode-title">
                <h2 id="lobby-mode-title" className="lobby-section-title">
                  01 <span>Modo de batalla</span>
                </h2>
                <div className="lobby-mode-grid">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      className="lobby-mode-card"
                      aria-label={m.name}
                      aria-pressed={mode === m.id}
                      disabled={busy}
                      onClick={() => onMode(m.id)}
                    >
                      <GameIcon name={m.icon} />
                      <span>
                        <b>{m.name}</b>
                        <small>{m.tagline}</small>
                        <em>{m.description}</em>
                      </span>
                      <i className="lobby-selection-mark" aria-hidden="true">
                        {mode === m.id ? '◆' : '◇'}
                      </i>
                    </button>
                  ))}
                </div>
              </section>
              <section className="lobby-maps" aria-labelledby="lobby-map-title">
                <h2 id="lobby-map-title" className="lobby-section-title">
                  02 <span>Campo de batalla</span>
                  <small>{selectedMode.goal}</small>
                </h2>
                <div className="lobby-map-cards">
                  {PVP_MAPS.filter((m) => m.allowedModes.includes(mode)).map((m) => (
                    <button
                      className="lobby-map-card"
                      key={m.id}
                      aria-label={`Mapa: ${m.name}`}
                      aria-pressed={mapId === m.id}
                      disabled={busy}
                      onClick={() => onMap(m.id)}
                    >
                      <MapPreview map={m} mode={mode} />
                      <b>{m.name}</b>
                      <TerrainTags map={m} />
                      <span className="lobby-selection-mark" aria-hidden="true">
                        {mapId === m.id ? '◆' : '◇'}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="lobby-map-description" aria-live="polite">
                  {map.description}
                </p>
              </section>
            </div>
          ) : (
            <section className="lobby-room-details" aria-label="Configuración de sala">
              <div className="lobby-room-map">
                <MapPreview map={map} mode={activeMode} />
                <div>
                  <span className="lobby-eyebrow">Campo de batalla</span>
                  <h3>{map.name}</h3>
                  <TerrainTags map={map} />
                </div>
              </div>
              <div className="lobby-room-mode">
                <GameIcon name={selectedMode.icon} />
                <div>
                  <h2>{selectedMode.name}</h2>
                  <p>{selectedMode.description}</p>
                </div>
              </div>
              {rankedRoom && (
                <RankedIntro
                  ranked={rankedRoom}
                  seat={room.seat}
                  names={[room.members[0]?.name ?? '', room.members[1]?.name ?? '']}
                  champions={[room.members[0]?.heroId, room.members[1]?.heroId]}
                  titles={[room.members[0]?.titleId, room.members[1]?.titleId]}
                  crests={[room.members[0]?.crestId, room.members[1]?.crestId]}
                />
              )}
              {!rankedRoom && <div className="lobby-invite">
                <span className="lobby-eyebrow">Código de sala</span>
                <strong className="pvp-code" aria-label={`Código de sala: ${room.code}`}>
                  {room.code}
                </strong>
                <button onClick={() => void copyCode()}>
                  {copied ? '✓ Copiado' : 'Copiar código'}
                </button>
                <span role="status">
                  {copyFailed
                    ? 'No se pudo copiar. Selecciona el código para copiarlo.'
                    : copied
                      ? 'Código copiado. Compártelo con tu rival.'
                      : 'Comparte el código para invitar a tu rival.'}
                </span>
              </div>}
            </section>
          )}
        </div>
        <footer className="lobby-footer" hidden={rankedSetup}>
          {rankedSetup ? null : !room ? (
            <>
              <div className="lobby-create">
                <button
                  className="lobby-primary"
                  disabled={busy||!!restriction||!deckValid}
                  onClick={() => onAction('create')}
                >
                  <GameIcon name="melee" />
                  Crear partida privada
                </button>
                <small>Tu campeón y mazo activo entran a la arena.</small>
              </div>
              <span className="lobby-or">o</span>
              <form
                className="lobby-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy && deckValid && code.length === 8) onAction('join');
                }}
              >
                <label htmlFor="lobby-room-code">Unirse por código</label>
                <div>
                  <input
                    id="lobby-room-code"
                    aria-label="Código de sala"
                    placeholder="XXXXXXXX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={code}
                    maxLength={8}
                    onChange={(e) => onCode(e.target.value.toUpperCase())}
                  />
                  <button disabled={busy || !deckValid || code.length !== 8} type="submit">
                    Unirse con código
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="lobby-ready-copy" role="status">
                <b>
                  {isReady
                    ? rival?.ready
                      ? 'Ambos listos. Entrando a la arena…'
                      : 'Estás listo para combatir'
                    : rival
                      ? 'Tu rival está en la arena'
                      : 'Tu sala está preparada'}
                </b>
                <small>
                  {isReady
                    ? 'La batalla comienza cuando ambos estén listos.'
                    : rival
                      ? 'Confirma tu campeón y pulsa Estoy listo.'
                      : 'Puedes marcarte listo mientras esperas al rival.'}
                </small>
              </div>
              <button
                className="lobby-primary"
                aria-pressed={isReady}
                disabled={busy || !deckValid || !!restriction || network !== 'Conectado' || isReady}
                onClick={() => onAction('ready')}
              >
                <GameIcon name={isReady ? 'shield' : 'melee'} />
                {isReady ? '✓ Listo para combatir' : 'Estoy listo'}
              </button>
            </>
          )}
        </footer>
        {error && (
          <p className="lobby-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {restriction&&<p className="lobby-error" role="status">{restriction}. Elige otro campeón para jugar en la arena.</p>}
      {choosing&&<CampaignChampionSelector entries={championsIn(DEFAULT_CONTENT,id=>championReleased(id,warriorReleased)).filter(c=>c.availability==='AVAILABLE'&&championUsableIn(useBattleStore.getState(),c.heroId)).map(c=>({id:c.heroId,name:DEFAULT_CONTENT.heroes[c.heroId]!.name,portrait:championPortrait(c.heroId)??'',completed:0,total:0,reason:pvpChampionRestriction(c.heroId)}))} selectedId={localHero} actName="Arena privada · mazo activo guardado" contextLabel="PVP" subtitle="Confirma tu campeón y el mazo guardado" onClose={closeChooser} onSelect={id=>{if(!busy){onHero(id);closeChooser();}}}/>}

    </main>
  );
}
