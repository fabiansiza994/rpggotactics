import {useEffect,useRef,useState} from 'react';
import {PVP_MAPS} from '../../game/pvp/maps';
import {GameIcon} from '../react/components/GameIcon';
import type {Invite} from './api';
import {useSocialStore} from './socialStore';
import '../../styles/social.css';
const MODE_LABEL={DUEL:'Duelo',DOMINION:'Dominio Arcano'} as const;
const mapName=(id:string)=>PVP_MAPS.find(m=>m.id===id)?.name??id;
function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function InviteCard({ invite, incoming }: { invite: Invite; incoming: boolean }) {
  const left = useCountdown(invite.expiresAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action: 'accept' | 'reject' | 'cancel') {
    setBusy(true);
    const failed = await useSocialStore.getState().respond(invite, action);
    setBusy(false);
    if (failed) setError(failed);
  }
  return (
    <article className={`social-invite ${incoming ? 'is-incoming' : 'is-outgoing'}`}>
      <GameIcon name={invite.mode === 'DOMINION' ? 'arcane' : 'melee'} />
      <div>
        <b>{incoming ? `${invite.from} te desafía` : `Desafío enviado a ${invite.to}`}</b>
        <small>
          {MODE_LABEL[invite.mode]} · {mapName(invite.mapId)} · {left > 0 ? `${left} s` : 'vencida'}
        </small>
        {error && <small className="social-error">{error}</small>}
      </div>
      <span className="social-invite-actions">
        {incoming ? (
          <>
            <button type="button" disabled={busy} onClick={() => void act('reject')}>
              Rechazar
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={busy || left === 0}
              onClick={() => void act('accept')}
            >
              Aceptar
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void act('cancel')}>
            Cancelar
          </button>
        )}
      </span>
    </article>
  );
}

export function InviteDialog({ friend, onClose }: { friend: string; onClose(): void }) {
  const [mode, setMode] = useState<'DUEL' | 'DOMINION'>('DUEL');
  const [mapId, setMapId] = useState('classic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const maps = PVP_MAPS.filter((m) => m.allowedModes.includes(mode));
  async function send() {
    setBusy(true);
    const failed = await useSocialStore
      .getState()
      .invite(friend, mode, maps.some((m) => m.id === mapId) ? mapId : maps[0]!.id);
    setBusy(false);
    if (failed) setError(failed);
    else {
      useSocialStore.getState().toast(`Desafío enviado a ${friend}`);
      onClose();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="social-dialog"
      aria-labelledby="invite-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <h2 id="invite-title">Desafiar a {friend}</h2>
      <fieldset>
        <legend>Modo</legend>
        {(['DUEL', 'DOMINION'] as const).map((m) => (
          <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
            <GameIcon name={m === 'DOMINION' ? 'arcane' : 'melee'} />
            {MODE_LABEL[m]}
          </button>
        ))}
      </fieldset>
      <fieldset>
        <legend>Mapa</legend>
        {maps.map((m) => (
          <button
            type="button"
            key={m.id}
            aria-pressed={mapId === m.id}
            onClick={() => setMapId(m.id)}
          >
            {m.name}
          </button>
        ))}
      </fieldset>
      <p className="social-dialog-note">
        Cada uno entra con su campeón y mazo activos. La invitación vence en 3 minutos.
      </p>
      {error && (
        <p className="social-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => void send()}>
          Enviar desafío
        </button>
      </footer>
    </dialog>
  );
}

