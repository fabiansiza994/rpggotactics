import {SocialChampionPortrait} from '../social/SocialChampionPortrait';
import {SocialAvatar} from '../social/ChatPanel';
import { RankedHistoryBadge } from '../ranked/RankedViews';
import {useHistoryAccess} from './HistoryAccess';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../qa/shapeshifter/runtime';
import { useEffect, useState } from 'react';
import type { CloudResult } from '../cloud/http';
import {
  DELETED_PLAYER,
  formatDuration,
  MODE_LABEL,
  REASON_LABEL,
  RESULT_LABEL,
  type PvpHistoryItem,
  type PvpHistoryPage,
  type PvpMatchDetail,
  type PvpStats,
} from './historyApi';
import { CHARACTER_PAINTINGS } from '../assets/paintedAssets';
import { RankLine } from '../ranked/RankShield';
import '../../styles/pvp-history.css';
import '../../styles/ranked.css';

/** Own server-recorded matches, newest first, with cursor pagination. */
const heroName = (id: string) => DEFAULT_CONTENT.heroes[id]?.name ?? id;
const rivalName = (o: PvpHistoryItem['opponent']) =>
  o.deleted || !o.username ? DELETED_PLAYER : o.username;
const when = (ms: number | null) =>
  ms === null
    ? '—'
    : new Date(ms).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

function Portrait({ id }: { id: string }) {
  return (
    <span className="history-portrait">
      {CHARACTER_PAINTINGS[id] ? (
        <img src={CHARACTER_PAINTINGS[id]} alt={heroName(id)} />
      ) : (
        <span aria-label={heroName(id)}>✧</span>
      )}
    </span>
  );
}

export function PvpHistory({ onBack, opponent,opponentAvatarId,compact=false }: { onBack: () => void; opponent?: string;opponentAvatarId?:string|null;compact?:boolean }) {
  const Container=compact?'section':'main';
  const access=useHistoryAccess();
  const [tab, setTab] = useState<'general' | 'champion' | 'mode'>('general');
  const [championFilter,setChampionFilter]=useState('ALL');
  const [resultFilter,setResultFilter]=useState('ALL');
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'CASUAL' | 'RANKED'>('ALL');
  const [items, setItems] = useState<PvpHistoryItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [stats, setStats] = useState<PvpStats | null>(null),
    [detail, setDetail] = useState<PvpMatchDetail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const hasRanked = items.some((m) => m.queue === 'RANKED');

  function apply(page: CloudResult<PvpHistoryPage> | null, next: string | null) {
    if (!page) setError('Inicia sesión para ver tu historial.');
    else if (page.ok) {
      setItems((prev) => (next ? [...prev, ...page.data.matches] : page.data.matches));
      setCursor(page.data.nextCursor);
      setError('');
    } else setError(page.error.message);
    setLoading(false);
  }
  const fetchPage = (next:string|null)=>access.history(next,opponent);
  useEffect(()=>{let alive=true;void access.history(null,opponent,compact?3:undefined).then(page=>{if(alive)apply(page,null);});if(!compact&&!opponent)void access.stats().then(r=>{if(alive&&r?.ok)setStats(r.data);});return()=>{alive=false;};},[access,opponent,compact]);
  async function open(matchId:string){const r=await access.detail(matchId);if(r?.ok)setDetail(r.data);else if(r)setError(r.error.message);}

  if (detail)
    return (
      <Container className={`pvp-history${compact?' is-embedded':''}`} data-view="detail">
        <header className="pvp-history-header">
          <button onClick={() => setDetail(null)}>‹ Historial</button>
          <h1>Detalle de partida</h1>
        </header>
        <section className="pvp-history-detail" data-result={detail.result}>
          <span className="history-eyebrow">CRÓNICA DE LA ARENA</span>
          <h2>{RESULT_LABEL[detail.result]}</h2>
          <div className="history-versus">
            <Portrait id={detail.myChampion} />
            <span>
              {detail.me.username}
              <small>{heroName(detail.myChampion)}</small>
            </span>
            <b>VS</b>
            <Portrait id={detail.opponent.champion} />
            <span>
              {rivalName(detail.opponent)}
              <small>{heroName(detail.opponent.champion)}</small>
            </span>
          </div>
          <dl>
            <dt>Jugadores</dt>
            <dd>
              {detail.me.username} ({heroName(detail.myChampion)}) vs {rivalName(detail.opponent)} (
              {heroName(detail.opponent.champion)})
            </dd>
            <dt>Modo</dt>
            <dd>
              {MODE_LABEL[detail.mode] ?? detail.mode} · {detail.queue === 'RANKED' ? 'Clasificatoria' : 'Casual'}
            </dd>
            {detail.ranked && (
              <>
                <dt>Rango</dt>
                <dd>
                  <RankLine rp={detail.ranked.rpBefore} compact /> → <RankLine rp={detail.ranked.rpAfter} compact /> ·{' '}
                  {detail.ranked.rpDelta > 0 ? '+' : ''}
                  {detail.ranked.rpDelta} RP ({detail.ranked.rpBefore} → {detail.ranked.rpAfter})
                  {detail.ranked.capped ? ' · sin RP (mismo rival)' : ''}
                </dd>
              </>
            )}
            <dt>Motivo</dt>
            <dd>{REASON_LABEL[detail.reason] ?? detail.reason}</dd>
            {detail.score && (
              <>
                <dt>Puntos</dt>
                <dd>
                  {detail.score.mine} — {detail.score.theirs}
                </dd>
              </>
            )}
            <dt>Rondas</dt>
            <dd>{detail.rounds}</dd>
            <dt>Duración</dt>
            <dd>{formatDuration(detail.durationSeconds)}</dd>
            {detail.firstTurn && (
              <>
                <dt>Primer turno</dt>
                <dd>{detail.firstTurn === 'ME' ? 'Tú' : 'Rival'}</dd>
              </>
            )}
            <dt>Fecha</dt>
            <dd>{when(detail.playedAt)}</dd>
          </dl>
        </section>
      </Container>
    );

  return (
    <Container className={`pvp-history${compact?' is-embedded':''}`} data-view="list">
      <header className="pvp-history-header">
        {!compact&&<button onClick={onBack}>‹ PvP</button>}
        <h1>{compact?'Partidas recientes':'Historial PvP'}</h1>
      </header>
      {opponent && <p className="history-eyebrow">TUS ENFRENTAMIENTOS CONTRA {opponent}</p>}
      {stats && !opponent && (
        <section className="pvp-history-stats" aria-label="Estadísticas PvP">
          <div className="history-totals">
            <span>
              <b>{stats.overall.matches}</b> partidas
            </span>
            <span>
              <b>{stats.overall.wins}</b> victorias
            </span>
            <span>
              <b>{stats.overall.losses}</b> derrotas
            </span>
            <span>
              <b>{stats.overall.winRate}%</b> victorias / partidas
            </span>
          </div>
          <div className="history-tabs" role="group" aria-label="Resumen">
            {(['general', 'champion', 'mode'] as const).map((t) => (
              <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === 'general' ? 'General' : t === 'champion' ? 'Por campeón' : 'Por modo'}
              </button>
            ))}
          </div>
          {tab === 'general' ? (
            <p className="history-summary">Tu legado en la arena · {stats.overall.draws} empates</p>
          ) : (
            <ul>
              {(tab === 'champion'
                ? stats.byChampion.map((c) => ({ ...c, label: heroName(c.champion) }))
                : stats.byMode.map((m) => ({ ...m, label: MODE_LABEL[m.mode] ?? m.mode }))
              ).map((row) => (
                <li key={row.label}>
                  <b>{row.label}</b>
                  <span>
                    {row.wins}–{row.losses} · {row.matches} partidas · {row.winRate}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {error && (
        <p className="pvp-history-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="pvp-history-empty">
          {opponent
            ? 'Aún no tienes partidas contra este rival.'
            : 'Aún no has jugado partidas PvP.'}
        </p>
      )}
      {!compact&&<label>Campeón <select value={championFilter} onChange={e=>setChampionFilter(e.target.value)}><option value="ALL">Todos</option>{[...new Set(items.map(m=>m.myChampion))].map(id=><option key={id} value={id}>{heroName(id)}</option>)}</select></label>}
      {!compact && <label>Resultado <select value={resultFilter} onChange={e=>setResultFilter(e.target.value)}><option value="ALL">Todos</option><option value="WIN">Victorias</option><option value="LOSS">Derrotas</option><option value="DRAW">Empates</option></select></label>}
      {hasRanked && (
        <div className="history-tabs" role="group" aria-label="Tipo de partida">
          {(['ALL', 'CASUAL', 'RANKED'] as const).map((q) => (
            <button key={q} aria-pressed={queueFilter === q} onClick={() => setQueueFilter(q)}>
              {q === 'ALL' ? 'Todos' : q === 'CASUAL' ? 'Casual' : 'Ranked'}
            </button>
          ))}
        </div>
      )}
      <ol className="pvp-history-list">
        {items
          .filter((m) => !opponent || m.opponent.username?.toLowerCase() === opponent.toLowerCase())
          .filter((m) => queueFilter === 'ALL' || (m.queue ?? 'CASUAL') === queueFilter)
          .filter(m=>championFilter==='ALL'||m.myChampion===championFilter)
          .filter(m=>resultFilter==='ALL'||m.result===resultFilter)
          .slice(0,compact?3:undefined)
          .map((m) => (
            <li key={m.matchId}>
              <button data-result={m.result} onClick={() => void open(m.matchId)}>
                <b className="pvp-history-result">{RESULT_LABEL[m.result]}</b>
                {compact?<SocialChampionPortrait id={m.myChampion}/>:<Portrait id={m.myChampion}/>}
                <span className="history-vs">VS</span>
                {compact?<SocialChampionPortrait id={m.opponent.champion}/>:<Portrait id={m.opponent.champion}/>}
                <span className="pvp-history-rival">
                  <SocialAvatar avatarId={opponentAvatarId} frameId={null}/> {rivalName(m.opponent)}
                  <small>
                    {heroName(m.myChampion)} vs {heroName(m.opponent.champion)}
                  </small>
                </span>
                <span className="history-mode">
                  <i aria-hidden="true">{m.mode === 'DOMINION' ? '✦' : '⚔'}</i>
                  {MODE_LABEL[m.mode] ?? m.mode}
                </span>
                {m.ranked && (
                  <RankedHistoryBadge rp={m.ranked.rpAfter} delta={m.ranked.rpDelta} />
                )}
                <span>{when(m.playedAt)}</span>
                <span>{m.rounds} rondas</span>
                <span>{formatDuration(m.durationSeconds)}</span>
              </button>
            </li>
          ))}
      </ol>
      {opponent && items.length > 0 && (
        <p className="pvp-history-note">
          Solo tus partidas contra este rival. Carga más para consultar encuentros anteriores.
        </p>
      )}
      {loading && <p role="status">Cargando…</p>}
      {cursor && !loading && !compact && (
        <button
          className="pvp-history-more"
          onClick={() => {
            setLoading(true);
            void fetchPage(cursor).then((page) => apply(page, cursor));
          }}
        >
          Ver más
        </button>
      )}
      <p className="pvp-history-note">Historial disponible desde esta versión.</p>
    </Container>
  );
}
