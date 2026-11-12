import { CONTENT_RELEASE, contentReleaseUrl } from '../cloud/contentRelease';
import { BattleResultPresentation } from '../results/BattleResultPresentation';
import '../react/components/BattleStyles';
import { useMechanismPlayback } from '../mechanisms/mechanismPlayback';
import { useMasteryBattleFeedback } from '../mastery/MasteryFeedback';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../qa/shapeshifter/runtime';
import {PauseMenu} from '../react/components/PauseMenu';
import { useEffect, useRef, useState } from 'react';
import {
  GameEngine, deckSummaries, DECK_RULES,
  type GameState,
  type GameEvent,
  type Command,
} from '../../game';
import { type PvpMode } from '../../game/pvp/dominion';
import { PVP_MAPS, pvpMap, mapScenario, mapSpawns } from '../../game/pvp/maps';
import { TacticalOverview } from '../react/components/TacticalOverview';
import { CLOUD_CONFIG } from '../cloud/config';
import { loadSession } from '../cloud/session';
import { useBattleStore } from '../store/battleStore';
import { presentationBus } from '../events/presentationBus';
import { BoardView } from '../react/components/BoardView';
import { BattleScenery } from '../react/components/BattleScenery';
import { HeroPanel, HandBar } from '../react/components/Hud';
import { describeEvent, rememberUnits, ERROR_LABEL } from '../react/format';
import '../../styles/pvp.css';
import { PvpLobby } from './PvpLobby';
import { PvpHistory } from './PvpHistory';
import { MatchChat, useMatchFriend } from '../social/MatchChat';
import { setPvpReportContext } from '../support/reportContext';
import { PvpBanter, PvpVictoryLines, pvpMatchKey } from '../dialogue/DialogueGates';
import { useRankedQueue } from '../ranked/useRankedQueue';
import { RankedPanel, RankedResult, type QueueKind } from '../ranked/RankedViews';
import type { RankedSnapshot } from '../ranked/rankedApi';
import { pvpChampionRestriction } from './eligibility';
import { VictoryBadge } from '../ranked/RankedCosmetics';
interface Snapshot {
  mode: PvpMode;
  mapId: string;
  code: string;
  /** Absent on servers older than the dialogue pass. */
  matchId?: string;
  version: number;
  seat: number;
  members: {
    name: string;
    heroId: string;
    deckId?: string;
    frameId?: string | null;
    titleId?: string | null;
    crestId?: string | null;
    badgeId?: string | null;
    ready: boolean;
    connected: boolean;
  }[];
  game: GameState | null;
  events: GameEvent[];
  deadline: number | null;
  expiresAt: number;
  result: { winner: number; reason: string } | null;
  /** Ranked Preseason room; null/absent = casual. */
  ranked?: RankedSnapshot | null;
}
const REASONS: Record<string, string> = {
  DOMINION_SCORE: 'Victoria por Dominio Arcano',
  CHAMPION_DEFEATED: 'Campeón derrotado',
  SURRENDER: 'Rendición',
  OPPONENT_DISCONNECTED: 'El rival no volvió a conectarse',
  ABANDONED: 'Abandono de la partida',
  BOTH_DISCONNECTED: 'Ambos jugadores perdieron la conexión',
  MATCH_EXPIRED: 'La partida venció',
};
const ERRORS: Record<string, string> = {
  ...ERROR_LABEL,
  NOT_YOUR_TURN: 'Es el turno del rival.',
  STALE_VERSION: 'La partida cambió. Confirma de nuevo tu acción.',
  OPPONENT_DISCONNECTED: 'Esperando la reconexión del rival.',
  TURN_EXPIRED: 'Tu turno terminó.',
  BATTLE_OVER: 'La partida ya terminó.',
  BAD_COMMAND: 'La acción no es válida.',
};
const LAST_ROOM = 'rpg-go-tactics:pvp-room';
/** Liveness probe while a room is unresolved: a ping every PROBE_MS, a socket without pong after PONG_MS is stale. */
const PROBE_MS = 10000,
  PONG_MS = 5000;
async function api(path: string, body?: unknown) {
  const session = loadSession();
  if (!session) throw Error('Inicia sesión para jugar PvP.');
  const res = await fetch(contentReleaseUrl(CLOUD_CONFIG.apiUrl + '/api/tactics/pvp/' + path), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) {
    if (loadSession()?.token === session.token) useBattleStore.getState().sessionExpired();
    throw Error('Tu sesión venció. Inicia sesión de nuevo para reconectar.');
  }
  if (!res.ok) throw Error(data.error?.message ?? 'No se pudo conectar.');
  return data;
}
export function PvpScreen({ onExit,onOpponentHistory }: { onExit: () => void;onOpponentHistory?:(username:string)=>void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [code, setCode] = useState(''),
    [mode, setMode] = useState<PvpMode>('DUEL'),
    [mapId, setMapId] = useState('classic'),
    [error, setError] = useState(''),
    [network, setNetwork] = useState('Conectando…'),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [history, setHistory] = useState(false),
    [queueKind, setQueueKind] = useState<QueueKind>(()=>new URLSearchParams(location.search).get('queue')==='ranked'?'RANKED':'CASUAL'),
    [clock, setClock] = useState(Date.now());
  const profile=useBattleStore(s=>s.profile);
  const selectedHero=profile.selectedChampionId;
  const [chosenDeck,setChosenDeck]=useState<{heroId:string;deckId:string}|null>(null);
  const socket = useRef<WebSocket | null>(null),
    latest = useRef<Snapshot | null>(null),
    retry = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true),
    pending = useRef<{ id: string; version: number; command: Command } | null>(null),
    lastRevision = useRef(-1),
    connectionGeneration = useRef(0),
    pingSentAt = useRef<number | null>(null);
  // Ranked queue: a MATCHED ticket opens its server-created room like a joined code.
  const ranked = useRankedQueue((room) => {
    setQueueKind('RANKED');
    socket.current?.close();
    lastRevision.current = -1;
    setCode(room);
    void connect(room);
  });
  const hero=snapshot?.members[snapshot.seat]?.heroId ?? (ranked.queue.state==='SEARCHING'?ranked.queue.heroId:selectedHero);
  const masteryFeedback = useMasteryBattleFeedback({heroId:hero,heroName:DEFAULT_CONTENT.heroes[hero]?.name??'Campeón',battleKey:snapshot?pvpMatchKey(snapshot):null,finished:!!snapshot?.result});
  const decks=deckSummaries(profile,hero,DEFAULT_CONTENT,DECK_RULES);
  const queueLocked=ranked.busy || ranked.queue.state !== 'IDLE';
  const roomDeck=snapshot?.members[snapshot.seat]?.deckId;
  const queueDeck=ranked.queue.state==='SEARCHING'&&ranked.queue.heroId===hero ? ranked.queue.deckId : undefined;
  const deckId=roomDeck ?? queueDeck ?? (chosenDeck?.heroId===hero&&decks.some(d=>d.deckId===chosenDeck.deckId)?chosenDeck.deckId:decks.find(d=>d.isDefault)?.deckId);
  const deckValid=!!decks.find(d=>d.deckId===deckId)?.valid;
  const loadoutLocked=busy||queueLocked||!!snapshot?.ranked||!!snapshot?.members[snapshot.seat]?.ready;
  async function chooseDeck(id:string){
    if(loadoutLocked)return;
    if(!snapshot){setChosenDeck({heroId:hero,deckId:id});return;}
    setBusy(true);setError('');
    try{const next=await api('loadout',{code,heroId:hero,deckId:id});setChosenDeck({heroId:hero,deckId:id});renderSnapshot(next);}catch(e){setError(e instanceof Error?e.message:'No se pudo cambiar el mazo.');}finally{setBusy(false);}
  }
  const rankedFinished = !!snapshot?.ranked && !!snapshot.result;
  useEffect(() => {
    if (rankedFinished) void ranked.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedFinished]);
  function renderSnapshot(next: Snapshot) {
    if (next.version < lastRevision.current) return;
    const fresh = next.version > lastRevision.current;
    lastRevision.current = next.version;
    latest.current = next;
    setSnapshot(next);
    setCode(next.code);
    setPvpReportContext({ roomCode: next.code, mode: next.mode, heroId: next.members[next.seat]?.heroId ?? null, inMatch: next.game !== null });
    if (fresh) pending.current = null;
    setBusy(false);
    if (next.game) {
      const state = next.game,
        old = useBattleStore.getState().state;
      rememberUnits(old ?? state);
      const engine = GameEngine.fromSnapshot(
        state,
        DEFAULT_CONTENT,
        mapScenario(pvpMap(next.mapId ?? 'classic', next.mode), next.mode),
      );
      useBattleStore.setState({
        engine,
        state,
        mode: null,
        selectedCardUid: null,
        pairSelection: null,
        aim: null,
        introLocked: false,
        introReached: ['unlock'],
        notice: null,
        onlineCommand: send,
        log: next.events
          .filter(
            (e) =>
              e.type === 'CARD_PLAYED' || e.type === 'UNIT_DAMAGED' || e.type === 'SUMMON_ATTACKED',
          )
          .map((e, i) => ({
            id: next.version * 100 + i,
            text: describeEvent(e, state)?.text ?? e.type,
            tone: 'info',
          })),
      });
      if (fresh && next.events.length) presentationBus.publish(next.events, state);
    }
  }
  function send(command: Command) {
    const s = latest.current;
    if (
      !s?.game ||
      s.game.phase !== 'PLAYER' ||
      pending.current ||
      socket.current?.readyState !== WebSocket.OPEN ||
      s.members.some((m) => !m.connected)
    )
      return;
    const action = { id: crypto.randomUUID(), version: s.version, command };
    pending.current = action;
    setBusy(true);
    socket.current.send(JSON.stringify(action));
  }
  async function connect(room: string) {
    const generation = ++connectionGeneration.current;
    if (retry.current) clearTimeout(retry.current);
    const oldSocket = socket.current;
    socket.current = null;
    oldSocket?.close();
    setNetwork('Conectando…');
    try {
      const token = await api('connect', { code: room });
      if (!alive.current || generation !== connectionGeneration.current) return;
      const url = new URL(CLOUD_CONFIG.apiUrl + '/api/tactics/pvp/socket');
      url.searchParams.set('clientRelease', CONTENT_RELEASE);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('code', room);
      url.searchParams.set('ticket', token.ticket);
      const ws = new WebSocket(url);
      socket.current = ws;
      pingSentAt.current = null;
      ws.onopen = () => {
        setNetwork('Conectado');
        localStorage.setItem(LAST_ROOM, room);
        if (pending.current) ws.send(JSON.stringify(pending.current));
      };
      ws.onmessage = (e) => {
        if (socket.current !== ws) return;
        const msg = JSON.parse(e.data);
        if (msg.type === 'snapshot') renderSnapshot(msg);
        else if (msg.type === 'pong') {
          pingSentAt.current = null;
          // The server moved on without this client seeing it (a push was lost): pull the truth.
          if (msg.version > lastRevision.current) ws.send(JSON.stringify({ type: 'resync' }));
        } else if (msg.type === 'ack') {
          pending.current = null;
          setBusy(false);
        } else if (msg.type === 'error') {
          setError(ERRORS[msg.message] ?? 'No se pudo aplicar la acción.');
          pending.current = null;
          setBusy(false);
          ws.send(JSON.stringify({ type: 'resync' }));
        }
      };
      ws.onclose = () => {
        if (!alive.current || socket.current !== ws) return;
        setNetwork('Reconectando…');
        setBusy(false);
        retry.current = setTimeout(() => void connect(room), 1500);
      };
      ws.onerror = () => ws.close();
    } catch (e) {
      if (generation !== connectionGeneration.current) return;
      setError(e instanceof Error ? e.message : 'Error de conexión');
      setNetwork('Sin conexión');
      if (alive.current && latest.current) {
        void readState(room);
        retry.current = setTimeout(() => void connect(room), 3000);
      }
    }
  }
  /** Authoritative HTTP read of the room (same view as a socket snapshot); never infers a result. */
  async function readState(room: string) {
    try {
      const data = await api('state?code=' + encodeURIComponent(room));
      if (alive.current && latest.current?.code === data.code) renderSnapshot(data);
      return data as Snapshot;
    } catch {
      return null;
    }
  }
  /** A socket that stopped answering (or a push this client missed): pull the truth, then reconnect. */
  async function recover(room: string) {
    const generation = connectionGeneration.current;
    await readState(room);
    if (alive.current && generation === connectionGeneration.current) void connect(room);
  }
  const unresolved = !!snapshot && (!snapshot.result || (!!snapshot.ranked && !snapshot.ranked.outcome));
  // Liveness while the room is unresolved: the terminal state (abandon, timeout, result) is pushed
  // once by the server; a half-open socket or a frozen tab must not keep a stale live view.
  useEffect(() => {
    if (!unresolved) return;
    let lastPing = 0;
    const probe = (force = false) => {
      const ws = socket.current,
        room = latest.current?.code,
        now = Date.now();
      if (!room || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (pingSentAt.current !== null) {
        if (now - pingSentAt.current >= PONG_MS) void recover(room);
        return;
      }
      if (!force && now - lastPing < PROBE_MS) return;
      lastPing = pingSentAt.current = now;
      ws.send(JSON.stringify({ type: 'ping' }));
    };
    const visible = () => {
      if (document.visibilityState === 'visible') probe(true);
    };
    const timer = setInterval(probe, 1000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolved]);
  // The connection lifecycle intentionally captures stable refs on mount.
  useEffect(() => {
    alive.current = true;
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    void api('active')
      .then(({ code: active }) => {
        const saved = active ?? localStorage.getItem(LAST_ROOM);
        if (saved) void connect(saved);
        else setNetwork('Sin sala');
      })
      .catch((e) => {
        setError(e.message);
        setNetwork('Sin conexión');
      });
    return () => {
      alive.current = false;
      clearInterval(clockTimer);
      setPvpReportContext(null);
      if (retry.current) clearTimeout(retry.current);
      socket.current?.close();
      useBattleStore.setState({
        onlineCommand: null,
        engine: null,
        state: null,
        playbackBusy: false,
        introLocked: false,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // connection lifecycle is owned by this screen
  async function action(path: string) {
    if (['create','join','ready','rematch'].includes(path)&&(!deckId||!deckValid)){setError('Corrige el mazo seleccionado antes de entrar a la arena.');return;}
    setError('');
    setBusy(true);
    try {
      const data = await api(path, {
        code,
        heroId: hero,
        deckId,
        ...(path === 'create' ? { mode, mapId } : {}),
      });
      if (path === 'create' || path === 'join') {
        socket.current?.close();
        lastRevision.current = -1;
        renderSnapshot(data);
        await connect(data.code);
      } else renderSnapshot(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }
  async function exit() {
    if (snapshot) {
      try {
        await api('leave', { code: snapshot.code });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    localStorage.removeItem(LAST_ROOM);
    alive.current = false;
    socket.current?.close();
    onExit();
  }
  /** Ranked result → back to the ranked panel (the room is finished; nothing to leave). */
  function backToRanked() {
    localStorage.removeItem(LAST_ROOM);
    connectionGeneration.current++;
    if (retry.current) clearTimeout(retry.current);
    const old = socket.current;
    socket.current = null;
    old?.close();
    lastRevision.current = -1;
    latest.current = null;
    setSnapshot(null);
    setNetwork('Sin sala');
    useBattleStore.setState({ onlineCommand: null, engine: null, state: null, playbackBusy: false });
    ranked.reset();
    void ranked.refresh();
  }
  const game = snapshot?.game,
    engine = useBattleStore((s) => s.engine),
    aim = useBattleStore((s) => s.aim);
  const playback = useBattleStore(s=>s.playbackBusy || s.introLocked);
  const presented = useMechanismPlayback(s=>s.state);
  const displayGame = playback && presented?.scenarioId === game?.scenarioId ? presented : game;
  // Friend chat beside the match: same 1:1 conversation, separate socket, never battle state.
  const matchFriend = useMatchFriend(game ? snapshot.code : null);
  const seatHeroes = [snapshot?.members[0]?.heroId ?? '', snapshot?.members[1]?.heroId ?? ''] as const;
  if (game && engine)
    return (
      <div className={`pvp-match-layout ${matchFriend ? 'has-friend-chat' : ''}`}>
        <div
          className="battle pvp-battle"
          data-pvp-mode={snapshot.mode}
          data-pvp-map={snapshot.mapId ?? 'classic'}
          data-theme="duel"
          data-intro="done"
          data-reveal="unlock deal"
          data-action={busy ? 'resolving' : 'normal'}
        >
          <BattleScenery theme="duel" />
          <details className="pvp-terrain-info">
            <summary>Mapa y terreno</summary>
            <b>{pvpMap(snapshot.mapId ?? 'classic', snapshot.mode).name}</b>
            <p>
              Cobertura ▰: −1 daño de proyectiles y ataques directos a distancia. Peligro △: 1 daño
              al final del turno del propietario. Arcano ◇: campeón +1 energía al iniciar su turno.
              Vacío: sin paso ni destinos; los proyectiles lo cruzan.
            </p>
            <TacticalOverview state={game} />
          </details>
          <header className="top-bar">
            <HeroPanel state={displayGame ?? game} engine={engine} />
            <div className="panel pvp-turn">
              {game.dominion && (
                <div className="dominion-score" aria-label="Puntuación de Dominio">
                  <b>
                    DOMINIO · {game.dominion.scores[snapshot.seat]} —{' '}
                    {game.dominion.scores[1 - snapshot.seat]}
                  </b>
                  <small>
                    Objetivo: {game.dominion.target} ·{' '}
                    {game.dominion.suddenDeath
                      ? 'Muerte súbita'
                      : game.round === 1
                        ? 'Sin puntos en ronda 1'
                        : 'Puntos al cerrar ronda'}
                  </small>
                  <div className="dominion-nodes">
                    {game.dominion.nodes.map((n, i) => (
                      <span
                        key={n.id}
                        data-control={
                          n.control === snapshot.seat
                            ? 'own'
                            : typeof n.control === 'number'
                              ? 'rival'
                              : n.control
                        }
                        title={`Nodo ${i + 1}: ${n.control === snapshot.seat ? 'Tú' : typeof n.control === 'number' ? 'Rival' : n.control === 'CONTESTED' ? 'Disputado' : 'Neutral'}`}
                      >
                        ◈ {i + 1}{' '}
                        {n.control === snapshot.seat
                          ? 'Tú'
                          : typeof n.control === 'number'
                            ? 'Rival'
                            : n.control === 'CONTESTED'
                              ? '×'
                              : '○'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {snapshot.ranked && <span className="pvp-ranked-badge">Clasificatoria · Pretemporada</span>}
              <strong>{busy || playback ? 'Resolviendo…' : game.phase === 'PLAYER' ? 'Tu turno' : 'Esperando al rival'}</strong>
              <span>
                Ronda {displayGame?.round ?? game.round} · {network}
                {snapshot.deadline
                  ? ` · ${Math.max(0, Math.ceil((snapshot.deadline - clock) / 1000))} s`
                  : ''}
                {busy ? ' · Validando…' : ''}
              </span>
              <button onClick={() => setConfirm(true)}>Rendirse</button>
            </div>
            <div className="panel pvp-rival">
              <strong>{snapshot.members[1 - snapshot.seat]?.name}</strong>
              <span>
                {snapshot.members[1 - snapshot.seat]?.heroId} ·{' '}
                {game.units.find((u) => u.kind === 'HERO' && u.faction === 'ENEMY')?.hp ?? 0} HP
              </span>
            </div>
          </header>
          <main className="battle-main">
            <div className="board-column">
              <BoardView focusedEnemyId={null} cameraOrigin={mapSpawns(pvpMap(snapshot.mapId ?? 'classic', snapshot.mode), snapshot.mode)[snapshot.seat]} />
            </div>
          </main>
          <PauseMenu online onExit={() => void exit()} />
          <PvpBanter
            content={DEFAULT_CONTENT}
            matchKey={pvpMatchKey(snapshot)}
            heroes={seatHeroes}
            viewerSeat={snapshot.seat}
            progress={{ round: game.round, cardsPlayed: game.stats.cardsPlayed, finished: !!snapshot.result }}
          />
          <HandBar state={game} engine={engine} />
          {snapshot.events
            .filter((e) => e.type === 'DOMINION_SCORED')
            .map(
              (e) =>
                e.type === 'DOMINION_SCORED' && (
                  <div className="dominion-feedback" role="status" key={e.round}>
                    Ronda {e.round} · +{e.points[snapshot.seat]} Dominio · Rival +
                    {e.points[1 - snapshot.seat]}
                  </div>
                ),
            )}
          {snapshot.events
            .filter((e) => e.type === 'CARD_PLAYED')
            .map(
              (e) =>
                e.type === 'CARD_PLAYED' && (
                  <div className="pvp-played" key={e.cardUid} role="status">
                    {DEFAULT_CONTENT.cards[e.cardId]?.name}
                  </div>
                ),
            )}
          {aim?.source === 'tap' && (
            <div className="pvp-confirm">
              <button onClick={() => useBattleStore.getState().confirmAim()}>
                Confirmar objetivo
              </button>
              <button className="cancel-action cancel-secondary" onClick={() => useBattleStore.getState().cancelAim()}>Cancelar selección</button>
            </div>
          )}
          {(network !== 'Conectado' || snapshot.members.some((m) => !m.connected)) &&
            !snapshot.result && (
              <div className="pvp-overlay" role="status">
                <h2>Esperando reconexión</h2>
                <p>La partida se conserva durante 60 segundos.</p>
                <button onClick={() => void connect(code)}>Reconectar</button>
              </div>
            )}
          {snapshot.result && !playback && (
            <BattleResultPresentation key={pvpMatchKey(snapshot)} identity={pvpMatchKey(snapshot)} tone={snapshot.result.winner < 0 ? 'ended' : snapshot.result.winner === snapshot.seat ? 'victory' : 'defeat'}><div className="pvp-overlay">
              {snapshot.result.winner === snapshot.seat && (
                <VictoryBadge badgeId={snapshot.members[snapshot.seat]?.badgeId} />
              )}
              <h2>
                {snapshot.result.winner < 0
                  ? 'Partida finalizada'
                  : snapshot.result.winner === snapshot.seat
                    ? 'Victoria'
                    : 'Derrota'}
              </h2>
              <p>{REASONS[snapshot.result.reason] ?? 'Partida finalizada'}</p>
              {snapshot.ranked && <RankedResult ranked={snapshot.ranked} />}
              {masteryFeedback}
              {matchFriend&&onOpponentHistory&&<button onClick={()=>onOpponentHistory(matchFriend.username)}>Ver historial contra este jugador</button>}
              <PvpVictoryLines
                content={DEFAULT_CONTENT}
                matchKey={pvpMatchKey(snapshot)}
                heroes={seatHeroes}
                winnerSeat={snapshot.result.winner}
              />
              <div className="pvp-result-actions">
              <button
                onClick={() => {
                  void exit();
                }}
              >
                Salir
              </button>
              {snapshot.ranked ? (
                <button onClick={backToRanked}>Buscar otra partida</button>
              ) : (
                <button disabled={busy} onClick={() => void action('rematch')}>
                  Revancha
                </button>
              )}
              </div>
            </div></BattleResultPresentation>
          )}
          {confirm && (
            <div className="pvp-overlay" role="dialog" aria-label="Confirmar rendición">
              <h2>¿Rendirse?</h2>
              <button
                onClick={() => {
                  socket.current?.send(JSON.stringify({ type: 'surrender' }));
                  setConfirm(false);
                }}
              >
                Sí, rendirme
              </button>
              <button onClick={() => setConfirm(false)}>Seguir jugando</button>
            </div>
          )}
          {error && (
            <div className="pvp-error" role="alert">
              {error}
              <button onClick={() => setError('')}>Cerrar</button>
            </div>
          )}
        </div>
        {matchFriend && <MatchChat friend={matchFriend} />}
      </div>
    );
  if (history && !snapshot) return <PvpHistory onBack={() => setHistory(false)} />;
  return (
    <PvpLobby
      room={snapshot}
      hero={hero}
      decks={decks} deckId={deckId} onDeck={id=>void chooseDeck(id)} loadoutLocked={loadoutLocked}
      mode={mode}
      mapId={mapId}
      code={code}
      busy={busy || (!snapshot && queueLocked)}
      network={network}
      error={error}
      onExit={() => void exit()}
      onHistory={() => setHistory(true)}
      queueKind={queueKind}
      onQueueKind={q=>{if(!queueLocked)setQueueKind(q);}}
      rankedSlot={
        ranked.profile?.enabled ? (
          <RankedPanel
            profile={ranked.profile}
            queue={ranked.queue}
            busy={ranked.busy}
            error={ranked.error}
            blocked={pvpChampionRestriction(hero) || (!deckValid ? 'Selecciona un mazo válido para jugar Ranked.' : null)}
            championName={DEFAULT_CONTENT.heroes[hero]?.name ?? hero}
            onSearch={() => {if(deckValid&&deckId)void ranked.search(hero,deckId);}}
            onCancel={() => void ranked.cancel()}
          />
        ) : undefined
      }
      onCode={setCode}
      onMap={setMapId}
      onMode={(next) => {
        setMode(next);
        // Keep the visual choice legal when a future map supports only one mode.
        if (!PVP_MAPS.find((map) => map.id === mapId)?.allowedModes.includes(next))
          setMapId(PVP_MAPS.find((map) => map.allowedModes.includes(next))!.id);
      }}
      onHero={(id) => {
        if(loadoutLocked)return;
        const nextDeck=deckSummaries(profile,id,DEFAULT_CONTENT,DECK_RULES).find(d=>d.isDefault)?.deckId;
        if (!snapshot) {useBattleStore.getState().selectChampion(id);setChosenDeck(nextDeck?{heroId:id,deckId:nextDeck}:null);}
        else
          void api('loadout', { code, heroId: id, deckId: nextDeck })
            .then(next=>{useBattleStore.getState().selectChampion(id);renderSnapshot(next);})
            .catch((e) => setError(e.message));
      }}
      onAction={(path) => void action(path)}
    />
  );
}
