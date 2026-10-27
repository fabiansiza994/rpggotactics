import {FriendProfileStats} from './FriendProfileStats';
import {InviteCard,InviteDialog} from './Invites';
export {InviteCard,InviteDialog} from './Invites';
import { MasteryTitleLabel } from '../mastery/MasteryViews';
import {useHistoryAccess} from '../pvp/HistoryAccess';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_CONTENT } from '../../game';
import { ENVIRONMENT_PAINTINGS } from '../assets/paintedAssets';
import { GameIcon } from '../react/components/GameIcon';
import type { Friend, ReportReason, SearchResult } from './api';
import { PRESENCE_LABEL, REPORT_LABEL, SocialAvatar } from './ChatPanel';
import { useSocialStore } from './socialStore';
import '../../styles/social.css';
import '../../styles/friend-profile.css';
import { PvpHistory } from '../pvp/PvpHistory';
import { RankedCrest } from '../ranked/RankedCosmetics';
import { headToHeadLine, type PvpHeadToHead } from '../pvp/historyApi';

type Tab = 'FRIENDS' | 'REQUESTS';
type Confirm = { kind: 'remove' | 'block' | 'report'; username: string } | null;

const heroName = (id: string | null) => (id ? (DEFAULT_CONTENT.heroes[id]?.name ?? '') : '');

function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: NonNullable<Confirm>;
  onClose(done?: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const store = useSocialStore.getState();
  async function run(action: () => Promise<string | null>) {
    const failed = await action();
    if (failed) setError(failed);
    else if (confirm.kind === 'report') setSent(true);
    else onClose(true);
  }
  return (
    <dialog
      ref={dialog}
      className="social-dialog"
      aria-labelledby="confirm-title"
      onCancel={() => onClose()}
      onClose={() => onClose()}
    >
      {confirm.kind === 'remove' && (
        <>
          <h2 id="confirm-title">¿Eliminar a {confirm.username}?</h2>
          <p>
            Dejaréis de ser amigos. El historial del chat se conserva, pero no podréis escribiros
            hasta volver a ser amigos.
          </p>
        </>
      )}
      {confirm.kind === 'block' && (
        <>
          <h2 id="confirm-title">¿Bloquear a {confirm.username}?</h2>
          <p>No podrá enviarte solicitudes, mensajes ni desafíos. No se le notificará el motivo.</p>
        </>
      )}
      {confirm.kind === 'report' && (
        <>
          <h2 id="confirm-title">Reportar a {confirm.username}</h2>
          {sent ? (
            <p role="status">Gracias. Revisaremos el reporte.</p>
          ) : (
            <p>¿Cuál es el motivo?</p>
          )}
        </>
      )}
      {error && (
        <p className="social-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" onClick={() => onClose()}>
          {sent ? 'Cerrar' : 'Cancelar'}
        </button>
        {confirm.kind === 'report' && !sent
          ? (Object.keys(REPORT_LABEL) as ReportReason[]).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => void run(() => store.report(confirm.username, r))}
              >
                {REPORT_LABEL[r]}
              </button>
            ))
          : null}
        {confirm.kind !== 'report' && (
          <button
            type="button"
            className="is-danger"
            onClick={() =>
              void run(() =>
                store.relation(
                  confirm.kind === 'remove' ? 'friends/remove' : 'block',
                  confirm.username,
                ),
              )
            }
          >
            {confirm.kind === 'remove' ? 'Eliminar' : 'Bloquear'}
          </button>
        )}
      </footer>
    </dialog>
  );
}

function FriendRow({
  friend,
  selected,
  onOpen,
  onInvite,
  onMenu,
}: {
  friend: Friend;
  selected: boolean;
  onOpen(): void;
  onInvite(): void;
  onMenu(kind: 'remove' | 'block' | 'report'): void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <li
      className={`social-friend ${selected ? 'is-selected' : ''}`}
      data-presence={friend.presence}
    >
      <button
        type="button"
        className="social-friend-main"
        onClick={onOpen}
        aria-label={`Ver perfil de ${friend.username}${friend.unread ? `, ${friend.unread} sin leer` : ''}`}
      >
        <SocialAvatar avatarId={friend.avatarId} frameId={friend.frameId} presence={friend.presence} />
        <span className="social-name">
          <b className="ranked-name-line">
            <RankedCrest crestId={friend.crestId} />
            {friend.username}
          </b>
          <MasteryTitleLabel titleId={friend.titleId} />
          <small>
            {PRESENCE_LABEL[friend.presence]}
            {friend.heroId ? ` · ${heroName(friend.heroId)}` : ''}
          </small>
        </span>
        {friend.unread > 0 && (
          <em className="social-badge" aria-hidden="true">
            {friend.unread > 99 ? '99+' : friend.unread}
          </em>
        )}
      </button>
      <span className="social-friend-actions">
        <button
          type="button"
          className="social-challenge"
          onClick={onInvite}
          disabled={friend.presence === 'IN_PVP'}
          title={friend.presence === 'IN_PVP' ? 'Está en una partida' : undefined}
        >
          <GameIcon name="melee" />
          <span>Invitar a PvP</span>
        </button>
        <button
          type="button"
          className="social-more"
          aria-label={`Más opciones para ${friend.username}`}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          ⋯
        </button>
        {menu && (
          <span className="social-menu" role="menu" onMouseLeave={() => setMenu(false)}>
            {(
              [
                ['remove', 'Eliminar amigo'],
                ['block', 'Bloquear'],
                ['report', 'Reportar'],
              ] as const
            ).map(([kind, label]) => (
              <button
                type="button"
                role="menuitem"
                key={kind}
                onClick={() => {
                  setMenu(false);
                  onMenu(kind);
                }}
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function SearchPanel() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function search() {
    const query = q.trim();
    if (query.length < 3) return setError('Escribe al menos 3 letras del usuario.');
    setBusy(true);
    setError('');
    const res = await useSocialStore.getState().search(query);
    setBusy(false);
    if (res.ok) setResults(res.results);
    else setError(res.message);
  }
  async function add(username: string, action: 'requests' | 'requests/accept') {
    const failed = await useSocialStore.getState().relation(action, username);
    if (failed) return setError(failed);
    setResults(
      (r) =>
        r?.map((x) =>
          x.username === username
            ? { ...x, relation: action === 'requests' ? 'OUTGOING' : 'FRIEND' }
            : x,
        ) ?? null,
    );
  }
  return (
    <section className="social-search" aria-label="Buscar jugadores">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          type="search"
          value={q}
          maxLength={32}
          placeholder="Buscar por usuario"
          aria-label="Buscar por usuario"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Buscar
        </button>
      </form>
      {error && <p className="social-error">{error}</p>}
      {results && (
        <ul className="social-results">
          {!results.length && <li className="social-empty">Sin resultados.</li>}
          {results.map((r) => (
            <li key={r.username}>
              <SocialAvatar avatarId={r.avatarId} frameId={r.frameId} />
              <b>{r.username}</b>
              {r.relation === 'NONE' && (
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => void add(r.username, 'requests')}
                >
                  Añadir
                </button>
              )}
              {r.relation === 'INCOMING' && (
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => void add(r.username, 'requests/accept')}
                >
                  Aceptar
                </button>
              )}
              {r.relation === 'OUTGOING' && <small>Solicitud enviada</small>}
              {r.relation === 'FRIEND' && <small>Amigo</small>}
              {r.relation === 'BLOCKED' && <small>Bloqueado</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FriendHistory({ username, onOpen }: { username: string; onOpen(): void }) {
  const access=useHistoryAccess();
  const [record, setRecord] = useState<PvpHeadToHead | null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(() => {
    let active = true;
    void access.headToHead(username).then(result=>{if(active){if(result?.ok)setRecord(result.data);else setFailed(true);}});
    return () => {
      active = false;
    };
  }, [username,access]);
  if (!record) return <p>{failed?'No pudimos cargar los enfrentamientos.':'Cargando enfrentamientos…'}</p>;
  return (
    <aside className="friend-history" aria-label="Enfrentamiento directo">
      <strong>
        TÚ VS {username} · {record.myWins} V · {record.theirWins} D
      </strong>
      <span>{headToHeadLine(record)}</span>
      <button onClick={onOpen}>VER HISTORIAL</button>
    </aside>
  );
}

export function SocialScreen({ onExit, initialFriend, onOpenChat }: { onExit(): void; initialFriend?:string; onOpenChat(username:string):void }) {
  const overview = useSocialStore((s) => s.overview);
  const live = useSocialStore((s) => s.live);
  const [historyOpponent, setHistoryOpponent] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('FRIENDS');
  const [selected, setSelected] = useState<string | null>(initialFriend??null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState('');
  useEffect(()=>{window.scrollTo(0,0);},[selected,historyOpponent]);
  useEffect(() => {
    void useSocialStore.getState().refresh();
  }, []);
  const friends = overview?.friends ?? [];
  const friend = friends.find((f) => f.username === selected) ?? null;
  // A friend that disappeared (removed/blocked) simply closes the chat (friend becomes null).
  const counts = overview?.counts ?? { unread: 0, requests: 0, invites: 0 };

  async function relation(
    action: Parameters<ReturnType<typeof useSocialStore.getState>['relation']>[0],
    username: string,
  ) {
    const failed = await useSocialStore.getState().relation(action, username);
    setError(failed ?? '');
  }

  if (historyOpponent)
    return <PvpHistory opponent={historyOpponent} opponentAvatarId={friend?.avatarId} onBack={() => setHistoryOpponent(null)} />;
  return (
    <main
      className={`social-screen ${friend ? 'has-chat' : ''}`}
      style={{ '--social-backdrop': `url(${ENVIRONMENT_PAINTINGS.duel})` } as CSSProperties}
    >
      <header className="social-header">
        <button
          type="button"
          className="social-back"
          onClick={friend ? () => setSelected(null) : onExit}
        >
          <span aria-hidden="true">‹</span> {friend ? 'Amigos' : 'Menú'}
        </button>
        <div>
          <span className="social-eyebrow">RPG-GO TACTICS · CÍRCULO ARCANO</span>
          <h1>{friend?`Tú y ${friend.username}`:'Amigos e historial'}</h1>
        </div>
        <span className="social-live" data-live={live} role="status">
          <i />
          {live === 'LIVE' ? 'En línea' : live === 'OFF' ? 'Sin conexión' : 'Reconectando…'}
        </span>
      </header>
      <div className="social-body">
        <section className="social-list" aria-label="Amigos y solicitudes">
          <nav className="social-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'FRIENDS'}
              onClick={() => setTab('FRIENDS')}
            >
              Amigos <span>{friends.length}</span>
              {counts.unread + counts.invites > 0 && (
                <em className="social-badge">{counts.unread + counts.invites}</em>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'REQUESTS'}
              onClick={() => setTab('REQUESTS')}
            >
              Solicitudes{' '}
              {counts.requests > 0 && <em className="social-badge">{counts.requests}</em>}
            </button>
          </nav>
          {error && (
            <p className="social-error" role="alert">
              {error}
            </p>
          )}
          {tab === 'FRIENDS' ? (
            <div className="social-scroll rpg-scroll-y">
              {overview?.invites.incoming.map((i) => (
                <InviteCard key={i.inviteId} invite={i} incoming />
              ))}
              {overview?.invites.outgoing.map((i) => (
                <InviteCard key={i.inviteId} invite={i} incoming={false} />
              ))}
              {!overview ? (
                <p className="social-empty">Cargando…</p>
              ) : friends.length ? (
                <ul className="social-friends">
                  {[...friends]
                    .sort(
                      (a, b) =>
                        b.unread - a.unread ||
                        Number(b.presence !== 'OFFLINE') - Number(a.presence !== 'OFFLINE') ||
                        a.username.localeCompare(b.username),
                    )
                    .map((f) => (
                      <FriendRow
                        key={f.username}
                        friend={f}
                        selected={selected === f.username}
                        onOpen={() => setSelected(f.username)}
                        onInvite={() => setInviting(f.username)}
                        onMenu={(kind) => setConfirm({ kind, username: f.username })}
                      />
                    ))}
                </ul>
              ) : (
                <p className="social-empty">
                  Aún no tienes amigos. Busca a un jugador por su usuario en Solicitudes.
                </p>
              )}
            </div>
          ) : (
            <div className="social-scroll rpg-scroll-y">
              <SearchPanel />
              <h2 className="social-section">Recibidas</h2>
              {overview?.incoming.length ? (
                <ul className="social-requests">
                  {overview.incoming.map((r) => (
                    <li key={r.username}>
                      <SocialAvatar avatarId={r.avatarId} frameId={r.frameId} />
                      <b>{r.username}</b>
                      <span>
                        <button
                          type="button"
                          onClick={() => void relation('requests/reject', r.username)}
                        >
                          Rechazar
                        </button>
                        <button
                          type="button"
                          className="is-primary"
                          onClick={() => void relation('requests/accept', r.username)}
                        >
                          Aceptar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="social-empty">No tienes solicitudes pendientes.</p>
              )}
              <h2 className="social-section">Enviadas</h2>
              {overview?.outgoing.length ? (
                <ul className="social-requests">
                  {overview.outgoing.map((r) => (
                    <li key={r.username}>
                      <SocialAvatar avatarId={r.avatarId} frameId={r.frameId} />
                      <b>{r.username}</b>
                      <span>
                        <button
                          type="button"
                          onClick={() => void relation('requests/cancel', r.username)}
                        >
                          Cancelar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="social-empty">Ninguna solicitud enviada.</p>
              )}
              {!!overview?.blocked.length && (
                <>
                  <h2 className="social-section">Bloqueados</h2>
                  <ul className="social-requests">
                    {overview.blocked.map((u) => (
                      <li key={u}>
                        <b>{u}</b>
                        <span>
                          <button type="button" onClick={() => void relation('unblock', u)}>
                            Desbloquear
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
        <section className="social-friend-detail" aria-label="Perfil e historial del amigo">
          {friend ? <>
            <header className="friend-profile-card">
              <SocialAvatar avatarId={friend.avatarId} frameId={friend.frameId} presence={friend.presence}/>
              <div><h2>{friend.username}</h2><p>{PRESENCE_LABEL[friend.presence]}</p><small>Campeón actual: {heroName(friend.heroId)||'Sin seleccionar'}</small><MasteryTitleLabel titleId={friend.titleId}/>{friend.crestId&&<RankedCrest crestId={friend.crestId}/>}</div>
              <div className="friend-profile-actions"><button className="is-primary" disabled={friend.presence==='IN_PVP'} onClick={()=>setInviting(friend.username)}>Invitar a PvP</button><button disabled={!friend.conversationId} onClick={()=>onOpenChat(friend.username)}>Abrir chat</button></div>
            </header>
            <FriendProfileStats key={`stats-${friend.username}`} username={friend.username} presence={friend.presence}/>
            <PvpHistory key={`matches-${friend.username}`} opponent={friend.username} opponentAvatarId={friend.avatarId} compact onBack={()=>setSelected(null)}/>
            <button className="friend-full-history" onClick={()=>setHistoryOpponent(friend.username)}>VER HISTORIAL COMPLETO</button>
          </> : <div className="social-placeholder"><GameIcon name="arcane"/><p>Selecciona un amigo para ver su perfil y vuestras partidas.</p></div>}
        </section>
      </div>
      {inviting && <InviteDialog friend={inviting} onClose={() => setInviting(null)} />}
      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          onClose={(done) => {
            if (done && confirm.username === selected) setSelected(null);
            setConfirm(null);
          }}
        />
      )}
    </main>
  );
}
