import {TurnstileWidget} from '../../security/TurnstileWidget';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { ASCENT_CAMPAIGN, encounterOrder } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import { GameIcon } from './GameIcon';

const GUEST_NOTE =
  'Como invitado, tu progreso se guarda solo en este dispositivo. PvP, nube y tienda requieren una cuenta.';

/** Native modal dialog that opens on mount (same pattern as the other menu dialogs). */
function Modal({
  label,
  onClose,
  children,
  className = '',
  locked = false,
}: {
  label: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!ref.current?.open) ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`pile-dialog account-dialog ${className}`}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const nodes = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
          ),
        ].filter((node) => node.getClientRects().length > 0);
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (!first || !last) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first || !e.currentTarget.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !e.currentTarget.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

// Compatibility export for existing public-support consumers; implementation is shared.
export {TurnstileWidget} from '../../security/TurnstileWidget';

type AccountView = 'ENTRY' | 'LOGIN' | 'REGISTER' | 'RECOVER' | 'ACCOUNT' | null;
// Only navigation is shared; passwords and one-time codes live in the mounted overlay.
const useAccountView = create<{ view: AccountView; open(view: AccountView): void }>((set) => ({
  view: null,
  open: (view) => set({ view }),
}));

/** Opens the account flow from elsewhere (e.g. the first-time champion choice). */
export const openAccountView = (view: 'LOGIN' | 'REGISTER' | 'ACCOUNT' | 'ENTRY') => useAccountView.getState().open(view);

/**
 * Guest invitation after the free encounters (GUEST_ENCOUNTER_LIMIT). Only real benefits are
 * listed. Creating an account (or signing in to one without cloud progress) imports this
 * device's progress through the usual one-time, server-validated import; an account that
 * already has cloud progress keeps it and the guest save stays on the device (never merged).
 */
export function GuestGateDialog() {
  const open = useBattleStore((s) => s.guestGate);
  const close = useBattleStore((s) => s.closeGuestGate);
  const convert = useBattleStore((s) => s.beginConversion);
  const backToMenu = useBattleStore((s) => s.backToMenu);
  if (!open) return null;
  const go = (view: 'REGISTER' | 'LOGIN') => {
    convert();
    useAccountView.getState().open(view);
  };
  return (
    <Modal label="Tu aventura continúa" onClose={close} className="guest-gate">
      <span className="account-eyebrow">✦ Campaña</span>
      <h2>Tu aventura continúa</h2>
      <p>Has completado las primeras 3 misiones.</p>
      <p>Crea una cuenta para guardar tu progreso en la nube, seguir la campaña y jugar online.</p>
      <p className="onb-preserved">✦ Tu progreso actual se conservará al crear la cuenta.</p>
      <ul className="guest-gate-benefits">
        <li>Tu campeón, cartas, mazos y misiones completadas pasan a tu cuenta.</li>
        <li>Continúa la campaña desde el Encuentro IV.</li>
        <li>PvP, amigos y chat, y la tienda.</li>
        <li>Recupera tu cuenta con un código si olvidas la contraseña.</li>
      </ul>
      <div className="account-entry-actions">
        <button type="button" className="account-primary" autoFocus onClick={() => go('REGISTER')}>
          Crear cuenta y continuar
        </button>
        <button type="button" className="account-secondary" onClick={() => go('LOGIN')}>
          Ya tengo cuenta
        </button>
        <button
          type="button"
          className="account-link"
          onClick={() => {
            close();
            backToMenu();
          }}
        >
          Volver al menú
        </button>
      </div>
      <p className="account-note">
        Tu progreso de invitado sigue guardado en este dispositivo. Si tu cuenta ya tiene progreso en la nube, se usa ese y no se
        mezclan.
      </p>
    </Modal>
  );
}

/** One-off account information (e.g. which progress an existing account kept). */
export function AccountNotice() {
  const notice = useBattleStore((s) => s.accountNotice);
  const dismiss = useBattleStore((s) => s.dismissAccountNotice);
  if (!notice) return null;
  return (
    <div className="cloud-banner account-notice" role="status">
      <GameIcon name="arcane" />
      <span>{notice}</span>
      {notice === 'Cuenta creada · progreso guardado' && <button type="button" className="account-primary" onClick={() => { dismiss(); useBattleStore.getState().continueRun(); }}>Continuar Encuentro IV</button>}
      <button type="button" aria-label="Cerrar aviso" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  login = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  login?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="account-password">
        <input
          aria-label={label}
          type={visible ? 'text' : 'password'}
          autoComplete={login ? 'current-password' : 'new-password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={login ? 1 : 8}
          maxLength={128}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </span>
    </label>
  );
}

export function AccountOverlay() {
  const view = useAccountView((s) => s.view);
  const open = useAccountView((s) => s.open);
  return view ? <AccountFlow key="account-flow" view={view} open={open} /> : null;
}

function AccountFlow({
  view,
  open,
}: {
  view: Exclude<AccountView, null>;
  open(view: AccountView): void;
}) {
  const account = useBattleStore((s) => s.account);
  const signIn = useBattleStore((s) => s.signIn);
  const register = useBattleStore((s) => s.register);
  const recover = useBattleStore((s) => s.recoverAccount);
  const finish = useBattleStore((s) => s.finishAccountSetup);
  const signOut = useBattleStore((s) => s.signOut);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  useEffect(() => {
    if (!recoveryCode) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recoveryCode]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  function navigate(next: AccountView) {
    if (busy || recoveryCode) return;
    setPassword('');
    setRepeat('');
    setInputCode('');
    setError(null);
    setTurnstile(null);
    open(next);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (view !== 'LOGIN') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))
        return setError('Usa de 3 a 20 letras, números o guion bajo para el usuario.');
      if (password.length < 8 || password.length > 128)
        return setError('La contraseña debe tener entre 8 y 128 caracteres.');
      if (password !== repeat) return setError('Las contraseñas no coinciden.');
    }
    if (view === 'REGISTER' && !turnstile)
      return setError('Completa la verificación de seguridad.');
    setBusy(true);
    try {
      if (view === 'LOGIN') {
        const failure = await signIn(username.trim(), password);
        if (failure) setError(failure);
        else open(null);
        return;
      }
      const result =
        view === 'REGISTER'
          ? await register(username.trim(), password, turnstile!)
          : await recover(username.trim(), inputCode, password);
      if ('error' in result) {
        setError(result.error);
        if (view === 'REGISTER') {
          setTurnstile(null);
          setChallengeVersion((n) => n + 1);
        }
        return;
      }
      setPassword('');
      setRepeat('');
      setInputCode('');
      setRecoveryCode(result.recoveryCode);
    } finally {
      setBusy(false);
    }
  }
  const title = recoveryCode
    ? 'Guarda tu código de recuperación'
    : confirmLogout
      ? '¿Cerrar sesión?'
      : view === 'ENTRY'
        ? 'Tu aventura, siempre contigo'
        : view === 'LOGIN'
          ? 'Iniciar sesión'
          : view === 'REGISTER'
            ? 'Crear cuenta'
            : view === 'RECOVER'
              ? 'Recuperar cuenta'
              : 'Tu cuenta';
  return (
    <Modal
      label={recoveryCode ? 'Código de recuperación' : title}
      onClose={() => navigate(null)}
      locked={busy || !!recoveryCode}
      className="account-premium"
    >
      <aside className="account-art" aria-hidden="true">
        <div className="account-art-rune">✦</div>
        <img src="/art/checkpoint05/characters/mage.webp" alt="" />
        <div>
          <span>RPG-GO TACTICS</span>
          <h2>
            Un vínculo
            <br />
            con lo arcano
          </h2>
          <p>
            Tu colección. Tus campeones.
            <br />
            Tu próxima aventura.
          </p>
        </div>
      </aside>
      <section className="account-content" aria-busy={busy}>
        <div className="account-heading">
          <span className="account-eyebrow">
            ✦ {recoveryCode ? 'Protege tu aventura' : 'Portal de cuentas'}
          </span>
          {!recoveryCode && (
            <button
              type="button"
              aria-label="Cerrar cuenta"
              disabled={busy}
              onClick={() => navigate(null)}
            >
              ×
            </button>
          )}
        </div>
        <h2>{title}</h2>
        {recoveryCode ? (
          <>
            <p>
              {view === 'RECOVER'
                ? 'Contraseña actualizada. Este nuevo código reemplaza al anterior y las sesiones anteriores se han cerrado.'
                : '¡Cuenta creada! Guarda este código en un lugar seguro.'}{' '}
              Es la única forma de recuperar tu cuenta si olvidas la contraseña. Solo se muestra
              ahora.
            </p>
            <code className="recovery-code">{recoveryCode}</code>
            <button
              type="button"
              className="account-secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recoveryCode);
                  setCopied(true);
                  setError(null);
                } catch {
                  setError('No se pudo copiar. Selecciona el código y guárdalo manualmente.');
                }
              }}
            >
              {copied ? 'Copiado' : 'Copiar código'}
            </button>
            <span className="account-copy-feedback" role="status">
              {copied ? 'Código copiado al portapapeles.' : ''}
            </span>
            <label className="account-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              He guardado mi código de recuperación
            </label>
            <button
              type="button"
              className="account-primary"
              disabled={!acknowledged || busy}
              onClick={async () => {
                setBusy(true);
                const before = useBattleStore.getState();
                const conversion = view === 'REGISTER' && before.account.status === 'GUEST' && before.run?.completedEncounterIds.length === 3;
                await finish();
                const after = useBattleStore.getState();
                if (conversion && after.account.status === 'READY' && !after.cloud.error && after.run?.completedEncounterIds.length === 3) {
                  useBattleStore.setState({ accountNotice: 'Cuenta creada · progreso guardado' });
                }
                setRecoveryCode(null);
                open(null);
              }}
            >
              {busy ? 'Conectando…' : 'Continuar'}
            </button>
          </>
        ) : view === 'ENTRY' ? (
          <>
            <p>
              Guarda colección, mazos y campaña en la nube. Tu cuenta RPG-GO también abre el acceso
              al PvP y la tienda.
            </p>
            <div className="account-entry-actions">
              <button className="account-primary" onClick={() => navigate('LOGIN')}>
                Iniciar sesión
              </button>
              <button className="account-secondary" onClick={() => navigate('REGISTER')}>
                Crear cuenta
              </button>
              <button className="account-link" onClick={() => navigate(null)}>
                Jugar como invitado
              </button>
            </div>
            <p className="account-note">{GUEST_NOTE}</p>
          </>
        ) : view === 'ACCOUNT' ? (
          <>
            <div className="account-identity">
              <span aria-hidden="true">✦</span>
              <div>
                <strong>{'username' in account ? account.username : 'Invitado'}</strong>
                <small>
                  {account.status === 'READY'
                    ? 'Conectado · progreso en la nube'
                    : account.status === 'OFFLINE'
                      ? 'Sin conexión · guardado pendiente'
                      : 'Conectando…'}
                </small>
              </div>
            </div>
            <p>
              {confirmLogout
                ? 'Cerrar sesión no elimina tu cuenta ni el progreso ya guardado en la nube. Volverás al progreso de invitado de este dispositivo. Los cambios pendientes no se consideran guardados.'
                : 'Tu colección, mazos, campeón y campaña se guardan en la nube cuando estás conectado.'}
            </p>
            {confirmLogout ? (
              <div className="account-entry-actions">
                <button
                  className="account-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await signOut();
                    open(null);
                  }}
                >
                  Confirmar cierre de sesión
                </button>
                <button
                  className="account-secondary"
                  disabled={busy}
                  onClick={() => setConfirmLogout(false)}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="account-entry-actions">
                {account.status === 'OFFLINE' && (
                  <button
                    className="account-primary"
                    onClick={() => {
                      useBattleStore.getState().retryCloud();
                      open(null);
                    }}
                  >
                    Reintentar conexión
                  </button>
                )}
                <button className="account-secondary" onClick={() => setConfirmLogout(true)}>
                  Cerrar sesión
                </button>
                <button className="account-link" onClick={() => navigate(null)}>
                  Volver al juego
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="account-note">
              {view === 'RECOVER'
                ? 'Usa el código que guardaste al crear tu cuenta. Al recuperarla recibirás uno nuevo.'
                : 'Usa tu cuenta de RPG-GO: es la misma para los dos juegos.'}
            </p>
            <form className="account-form" onSubmit={(e) => void submit(e)}>
              <fieldset disabled={busy}>
                <label>
                  Usuario
                  <input
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={view === 'LOGIN' ? 1 : 3}
                    maxLength={20}
                  />
                </label>
                {view === 'REGISTER' && (
                  <p className="account-note">
                    3–20 caracteres: letras, números y guion bajo. El nombre debe estar disponible.
                  </p>
                )}
                {view === 'RECOVER' && (
                  <label>
                    Código de recuperación
                    <input
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value)}
                      required
                      maxLength={64}
                    />
                  </label>
                )}
                <PasswordField
                  label={view === 'RECOVER' ? 'Nueva contraseña' : 'Contraseña'}
                  login={view === 'LOGIN'}
                  value={password}
                  onChange={setPassword}
                />
                {view !== 'LOGIN' && (
                  <>
                    <p className="account-note">De 8 a 128 caracteres.</p>
                    <PasswordField
                      label="Confirmar contraseña"
                      value={repeat}
                      onChange={setRepeat}
                    />
                  </>
                )}
                {view === 'REGISTER' && (
                  <TurnstileWidget key={challengeVersion} onToken={setTurnstile} />
                )}
                <button
                  type="submit"
                  className="account-primary"
                  disabled={busy || (view === 'REGISTER' && !turnstile)}
                >
                  {busy
                    ? 'Conectando…'
                    : view === 'LOGIN'
                      ? 'Entrar'
                      : view === 'REGISTER'
                        ? 'Crear cuenta'
                        : 'Actualizar contraseña'}
                </button>
              </fieldset>
            </form>
            <nav className="account-form-nav" aria-label="Opciones de cuenta">
              {view === 'LOGIN' && (
                <button
                  className="account-link"
                  disabled={busy}
                  onClick={() => navigate('RECOVER')}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              )}
              <button
                className="account-link"
                disabled={busy}
                onClick={() => navigate(view === 'LOGIN' ? 'REGISTER' : 'LOGIN')}
              >
                {view === 'LOGIN' ? 'Crear cuenta' : 'Volver a iniciar sesión'}
              </button>
            </nav>
          </>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Modal>
  );
}

/** A quiet menu indicator opens the single account flow mounted in App. */
export function AccountChip() {
  const account = useBattleStore((s) => s.account);
  const open = useAccountView((s) => s.open);
  if (account.status === 'DISABLED')
    return <span className="account-chip is-disabled">Invitado</span>;
  const label =
    account.status === 'GUEST'
      ? 'Invitado · Iniciar sesión'
      : account.status === 'READY'
        ? account.username
        : account.status === 'OFFLINE'
          ? `${account.username} · sin conexión`
          : `${account.username} · conectando…`;
  return (
    <button
      type="button"
      className={`account-chip is-${account.status.toLowerCase()}`}
      onClick={() => open(account.status === 'GUEST' ? 'ENTRY' : 'ACCOUNT')}
      title={account.status === 'GUEST' ? GUEST_NOTE : undefined}
    >
      <span className="account-dot" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Bootstrap blocks guest actions while the saved account is being restored. */
export function AccountBootstrap() {
  return (
    <main className="account-bootstrap" aria-busy="true">
      <div>
        <span className="account-eyebrow">RPG-GO TACTICS</span>
        <span className="account-loading-rune" aria-hidden="true">
          ✦
        </span>
        <h1>Restaurando tu aventura</h1>
        <p role="status">Cargando tu progreso guardado en la nube…</p>
        <AccountChip />
      </div>
    </main>
  );
}

/** First sign-in on an account without cloud save while this device has guest progress. */
export function ImportDialog() {
  const account = useBattleStore((s) => s.account);
  const resolveImport = useBattleStore((s) => s.resolveImport);
  const signOut = useBattleStore((s) => s.signOut);
  const busy = useBattleStore((s) => s.cloud.busy);
  if (account.status !== 'NEEDS_IMPORT') return null;
  const { local } = account;
  const total = encounterOrder(ASCENT_CAMPAIGN).length;
  return (
    <Modal label="Importar progreso" onClose={() => void signOut()} className="import-dialog">
      <h2>Progreso en este dispositivo</h2>
      <p>
        La cuenta <strong>{account.username}</strong> todavía no tiene progreso en la nube.
        Encontramos esto jugado como invitado:
      </p>
      <ul className="import-summary">
        <li>
          Campaña:{' '}
          {local.campaignStatus === null
            ? 'sin empezar'
            : local.campaignStatus === 'COMPLETED'
              ? 'completada'
              : `${local.completedEncounters}/${total} encuentros`}
        </li>
        <li>Cartas ganadas: {local.earnedCards}</li>
        <li>Mazos y campeón elegido</li>
      </ul>
      <p className="account-note">
        Se importa una sola vez y el servidor lo valida (cartas, mazos y campaña). Después, la nube
        manda.
      </p>
      <div className="confirm-actions">
        <button type="button" disabled={busy !== null} onClick={() => void resolveImport('FRESH')}>
          Empezar de cero
        </button>
        <button
          type="button"
          className="db-dialog-save"
          autoFocus
          disabled={busy !== null}
          onClick={() => void resolveImport('IMPORT')}
        >
          {busy ? 'Importando…' : 'Importar a mi cuenta'}
        </button>
      </div>
    </Modal>
  );
}

/** Cloud writes in flight or failed. A failure stays visible until retried or dismissed. */
export function CloudBanner() {
  const cloud = useBattleStore((s) => s.cloud);
  const account = useBattleStore((s) => s.account);
  const retryCloud = useBattleStore((s) => s.retryCloud);
  const dismiss = useBattleStore((s) => s.dismissCloudError);
  const guestMessage = account.status === 'GUEST' ? account.message : undefined;
  if (!cloud.busy && !cloud.error && !guestMessage) return null;
  return (
    <div
      className={`cloud-banner${cloud.error || guestMessage ? ' is-error' : ''}`}
      role={cloud.error ? 'alert' : 'status'}
    >
      <GameIcon name={cloud.error ? 'target' : 'arcane'} />
      <span>{cloud.error ?? (cloud.busy ? `${cloud.busy}…` : guestMessage)}</span>
      {guestMessage && (
        <button type="button" onClick={() => useAccountView.getState().open('LOGIN')}>
          Iniciar sesión
        </button>
      )}
      {cloud.error && cloud.canRetry && (
        <button type="button" onClick={retryCloud}>
          Reintentar
        </button>
      )}
      {cloud.error && (
        <button type="button" aria-label="Cerrar aviso" onClick={dismiss}>
          ×
        </button>
      )}
    </div>
  );
}
