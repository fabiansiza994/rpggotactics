import '../../styles/social-dock.css';

/** Shared handle: the open instance lives in the dialog's top layer. */
export function SocialDockButton({expanded=false,count=0,disabled=false,hidden=false,onClick}:{expanded?:boolean;count?:number;disabled?:boolean;hidden?:boolean;onClick():void}) {
 return <button className={`social-dock${expanded?' is-expanded':' social-dock-entry'}`} hidden={hidden} disabled={disabled} onClick={onClick} aria-expanded={expanded} aria-controls="social-drawer" aria-label={`${expanded?'Cerrar':'Abrir'} panel social${count?`, ${count} pendientes`:''}`} title={disabled?'Inicia sesión para conectar con amigos':'Amigos'}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5v3"/></svg>{count>0&&<b>{count>99?'99+':count}</b>}</button>;
}
