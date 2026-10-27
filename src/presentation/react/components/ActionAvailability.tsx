export type AvailabilityState = 'BLOCKED' | 'BONUS_AVAILABLE' | 'BONUS_NOT_ACTIVE';
/** Mandatory costs and optional riders must never share the same error language. */
export function ActionAvailability({state,label,detail,required=false}:{state:AvailabilityState;label:string;detail?:string;required?:boolean}) {
  return <li className="action-availability" data-availability={state} aria-label={`${required ? 'Requisito' : 'Bono opcional'}: ${label}`} title={!required ? 'Puedes jugar sin este bono' : undefined}>
    <span aria-hidden="true">{state==='BLOCKED'?'✕':state==='BONUS_AVAILABLE'?'✓':'◇'}</span>{' '}
    <span>{label}{detail && <small> · {detail}</small>}</span>
    <small>{state==='BLOCKED'?'Impide jugar':state==='BONUS_AVAILABLE'?'Disponible':required?'Pendiente de comprobar':'Bono no activo'}</small>
  </li>;
}
