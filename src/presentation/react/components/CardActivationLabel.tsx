import { GameIcon } from './GameIcon';
/** Presentation only: command validation remains owned by the existing aiming path. */
export function CardActivationLabel({card}:{card:boolean}) {
 return card ? <><span className="card-activation-icon" aria-hidden="true"><GameIcon name="deck"/><GameIcon name="energy"/></span>Activar</> : <>Confirmar</>;
}
