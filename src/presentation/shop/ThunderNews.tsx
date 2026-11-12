import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONTENT, ownedFor, type PlayerProfile } from '../../game';
import { MAGE_THUNDER_CORE } from '../../game/data/mage-thunder-core';
import { MAGE_THUNDER_EXPANSION } from '../../game/data/mage-thunder-expansion';
import { SpellArt } from '../react/components/SpellArt';
import type { CatalogOffer } from './api';
import './thunder-news.css';

export const THUNDER_NEWS_IDS = [...MAGE_THUNDER_CORE, ...MAGE_THUNDER_EXPANSION].map(c => c.id);
const rarityLabel = { COMMON:'Común', UNCOMMON:'Infrecuente', RARE:'Rara', LEGENDARY:'Legendaria', ULTRA:'Ultra' };
export function thunderSeenKey(account: string): string { return `rpggo:news:thunder-release-2:${account}`; }
export function ThunderNews({ profile, account, offers, onOffer }: {
  profile: PlayerProfile; account: string; offers: readonly CatalogOffer[]; onOffer: (offer: CatalogOffer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(thunderSeenKey(account)) === '1'; } catch { return false; } });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if(open) dialog.current?.showModal(); else dialog.current?.close(); },[open]);
  const close = () => {setOpen(false); trigger.current?.focus();};
  const browse = () => {setSeen(true); try {localStorage.setItem(thunderSeenKey(account),'1');} catch { /* News seen is cosmetic; storage failure must not block browsing. */ } setOpen(true);};
  const owned = ownedFor(profile, 'mage', DEFAULT_CONTENT);
  return <article className="shop-featured shop-thunder" data-expansion="thunder-release-2">
    <div className="shop-featured-copy">
      <span className="shop-label">{seen ? 'EXPANSIÓN DEL MAGO' : 'NUEVO · EXPANSIÓN DEL MAGO'}</span>
      <h2>EL DESPERTAR DEL TRUENO</h2>
      <p>Domina el poder de la tormenta con 15 hechizos eléctricos. Descubre nuevas estrategias de daño, movilidad, control y sobrecarga.</p>
      <button ref={trigger} className="shop-primary" onClick={browse}>Descubrir las 15 cartas</button>
      <small>También se obtienen jugando. Las compras usan Cristales Arcanos y no cambian tu mazo.</small>
    </div>
    <div className="shop-thunder-art" aria-hidden="true"><SpellArt cardId="tempest_judgment" spell="tempest_judgment" /></div>
    <dialog ref={dialog} className="thunder-gallery rpg-scroll-y" aria-labelledby="thunder-gallery-title"
      onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}
      onKeyDown={e=>{if(e.key!=='Tab')return;const nodes=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}>
      <header><div><span className="shop-label">15 CARTAS · MAGO</span><h2 id="thunder-gallery-title">El Despertar del Trueno</h2></div><button aria-label="Cerrar cartas de Trueno" onClick={close}>×</button></header>
      {open && <div className="thunder-gallery-grid">{THUNDER_NEWS_IDS.map(id=>{
        const card=DEFAULT_CONTENT.cards[id]!; const offer=offers.find(o=>o.id===`card_${id}`);
        return <article key={id} data-thunder-card={id}>
          <div className="thunder-card-art"><SpellArt cardId={id} spell={card.presentation.visualKey} /></div>
          <div className="thunder-card-info"><span className="shop-label">NUEVO · {rarityLabel[card.rarity ?? 'COMMON']} · Energía {card.cost}</span>
          <h3>{card.name}</h3><p>{card.rulesText}</p><small>En tu colección: {owned(id)} · {id==='storm_avatar'?'Recompensa del Acto III · XXX':'Recompensas de campaña del Mago'}</small>
          <button disabled={!offer} onClick={()=>{if(offer){close();onOffer(offer);}}}>{offer?'Ver adquisición y propiedad':id==='storm_avatar'?'Se obtiene en Acto III · XXX':'Inicia sesión para consultar la adquisición'}</button></div>
        </article>;
      })}</div>}
    </dialog>
  </article>;
}
