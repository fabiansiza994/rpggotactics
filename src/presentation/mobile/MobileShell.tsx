import {useEffect,useRef,type ReactNode} from 'react';
import {requestBugReport} from '../support/reportContext';
import {GameIcon} from '../react/components/GameIcon';
import {interfaceController,type InterfacePreference} from './interfaceMode';
import type {PlayMode} from '../play/navigation';
import '../../styles/mobile-shell.css';
export type MobileTab='hub'|'campaign'|'cards'|'store'|'profile';
const tabs=[['hub','Inicio','home'],['campaign','Jugar','melee'],['cards','Cartas','deck'],['store','Tienda','shop'],['profile','Perfil','user']] as const;
function MobileGlyph({name}:{name:'home'|'shop'|'user'|'crystal'}){
 const paths={home:'M3 10 12 3l9 7v10h-6v-7H9v7H3Z',shop:'M3 9h18l-2-6H5ZM4 10v11h16V10M9 21v-7h6v7',user:'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 21v-3a8 8 0 0 1 16 0v3',crystal:'M12 2 19 9l-7 13L5 9ZM5 9h14M12 2v20'};
 return <svg className="game-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function activeMobileTab(mode:PlayMode,screen:string):MobileTab{return mode==='store'?'store':mode==='profile'?'profile':screen==='DECK'||mode==='cards'?'cards':mode==='hub'?'hub':'campaign';}
export function InterfaceSettings({preference,pending,onClose,showHelp=false}:{preference:InterfacePreference;pending:boolean;onClose():void;showHelp?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="interface-settings" aria-labelledby="interface-title" onCancel={onClose}><header><h2 id="interface-title">Tu experiencia</h2><button onClick={onClose} aria-label="Cerrar ajustes de interfaz">×</button></header><p>Interfaz preferida</p><div role="group" aria-label="Interfaz preferida">{(['auto','mobile','desktop'] as const).map((mode,i)=><button key={mode} aria-pressed={preference===mode} onClick={()=>interfaceController.setPreference(mode)}>{['Automático','Móvil','Escritorio'][i]}</button>)}</div><p role="status">{pending?'El cambio se aplicará al salir de la partida.':'La preferencia se guarda en este dispositivo.'}</p>{showHelp&&<button className="m2-help" onClick={()=>{onClose();requestBugReport({});}}>Reportar un problema</button>}<small>El combate mantiene su presentación actual. La elección de interfaz no modifica tu cuenta ni tu progreso.</small><button onClick={onClose}>Listo</button></dialog>;
}
/** Stable frame: children never move between desktop/mobile branches. Battle receives no chrome. */
export function MobileShell({enabled,active,balance,onSettings,onNavigate,children}:{enabled:boolean;active:MobileTab;balance:number|null;onSettings():void;onNavigate(tab:MobileTab):void;children?:ReactNode}){
 return <div className={enabled?'mobile-shell':undefined} data-interface-frame="true">
 {enabled&&<header className="m2-topbar"><button className="m2-brand" onClick={()=>onNavigate('hub')} aria-label="RPG-GO Tactics · Inicio"><span>✧</span><b>RPG-GO<small>TACTICS</small></b></button><div className="m2-top-actions"><span className="m2-wallet" aria-label={balance===null?'Cristales: inicia sesión para consultar saldo':`${balance} cristales`}><MobileGlyph name="crystal"/><b>{balance===null?'—':balance.toLocaleString('es-CO')}</b></span><button className="m2-settings" onClick={onSettings} aria-label="Cambiar interfaz y ajustes">⚙</button></div></header>}
 <div className={enabled?'m2-content':undefined}>{children}</div>
 {enabled&&<nav className="m2-bottom-nav" aria-label="Navegación móvil">{tabs.map(([id,label,icon])=><button key={id} aria-current={active===id?'page':undefined} onClick={()=>onNavigate(id)}>{icon==='melee'||icon==='deck'?<GameIcon name={icon}/>:<MobileGlyph name={icon}/>}<span>{label}</span></button>)}</nav>}
 </div>;
}
