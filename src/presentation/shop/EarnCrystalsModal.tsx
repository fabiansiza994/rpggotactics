import { useEffect, useRef } from 'react';
import { ASCENT_CRYSTAL_MILESTONES, DAILY_FIRST_WIN_CRYSTALS } from '../../game/store/freeEconomy';
import '../../styles/crystal-shop.css';
export function EarnCrystalsModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="crystal-modal-backdrop" onClick={onClose}>
      <div
        ref={root}
        className="crystal-modal earn-crystals"
        role="dialog"
        aria-modal="true"
        aria-labelledby="earn-crystals-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <small>TIENDA ARCANA · RECOMPENSAS</small>
            <h2 id="earn-crystals-title">Consigue Cristales Arcanos</h2>
          </div>
          <button type="button" aria-label="Cerrar información de Cristales" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="crystal-modal-body">
          <p>
            Obtén Cristales Arcanos jugando con tu cuenta conectada. Gástalos en las cartas, packs y
            cosméticos de la Tienda Arcana.
          </p>
          <section>
            <h3>Primera victoria del día · +{DAILY_FIRST_WIN_CRYSTALS} 💎</h3>
            <p>
              Gana un encuentro de campaña o una escaramuza del Invocador verificada por el
              servidor. Una recompensa por cuenta al día, compartida entre campeones. El día se
              reinicia a las 00:00 UTC. PvP y las escaramuzas locales de otros campeones no dan esta
              recompensa.
            </p>
          </section>
          <section>
            <h3>El Ascenso · hitos únicos</h3>
            <p>
              {Object.entries(ASCENT_CRYSTAL_MILESTONES)
                .map(([at, amount]) => `Encuentro ${at}: +${amount} 💎`)
                .join(' · ')}
              .
            </p>
            <p>
              Primera victoria en cada hito por campeón. Repetir una ruta no vuelve a pagarlos; los
              hitos ya completados antes de esta actualización no se pagan retroactivamente.
            </p>
          </section>
          {import.meta.env.VITE_WORLD_2_ENABLED === '1' && (
            <section>
              <h3>Reino Infernal · +250 💎</h3>
              <p>
                Completa el mundo. Su recompensa única se conserva y no se duplica al repetirlo.
              </p>
            </section>
          )}
          {import.meta.env.VITE_ARCHER_CAMPAIGN === '1' && (
            <section>
              <h3>Sendero del Cazador · +250 💎</h3>
              <p>
                Completa la historia del Arquero para obtener su recompensa única, además de sus
                cartas exclusivas.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
