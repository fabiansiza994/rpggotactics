import { useRef, useState, type ReactNode } from 'react';
import './store-news.css';
export interface StoreNewsItem { id: string; label: string; content: ReactNode }
export const newsPosition = (current: number, delta: number, count: number): number => count ? ((current + delta) % count + count) % count : 0;
/** Data-driven, manual carousel. Offers remain their original components and contracts. */
export function StoreNewsCarousel({ items }: { items: readonly StoreNewsItem[] }) {
  const [position, setPosition] = useState(0);
  const drag = useRef<{x:number;y:number}|null>(null);
  const active = position < items.length ? position : 0;
  if (!items.length) return null;
  const go = (delta:number) => setPosition(newsPosition(active,delta,items.length));
  return <section className="shop-news" aria-roledescription="carrusel" aria-label="Novedades de la Tienda Arcana"
    onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(e.key==='ArrowRight'?1:-1);}}}>
    <div className="shop-news-window"
      onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};}}
      onPointerCancel={()=>{drag.current=null;}}
      onPointerUp={e=>{const start=drag.current;drag.current=null;if(!start)return;
        const dx=e.clientX-start.x,dy=e.clientY-start.y;
        if(Math.abs(dx)>44&&Math.abs(dx)>Math.abs(dy)*1.3)go(dx<0?1:-1);}}>
      <div className="shop-news-track" style={{transform:`translateX(-${active*100}%)`}}>
        {items.map((item,i)=><div key={item.id} className="shop-news-slide" data-news={item.id}
          role="group" aria-roledescription="diapositiva" aria-label={`${i+1} de ${items.length}: ${item.label}`}
          aria-hidden={i!==active} inert={i!==active}>{item.content}</div>)}
      </div>
    </div>
    {items.length>1&&<nav className="shop-news-nav" aria-label="Cambiar novedad">
      <button type="button" onClick={()=>go(-1)} aria-label="Novedad anterior">‹</button>
      <div>{items.map((item,i)=><button type="button" key={item.id} className="shop-news-dot"
        aria-label={`Ver ${item.label}`} aria-current={i===active?'true':undefined} onClick={()=>setPosition(i)} />)}</div>
      <span className="shop-news-position" aria-live="polite">{active+1} / {items.length}</span>
      <button type="button" onClick={()=>go(1)} aria-label="Novedad siguiente">›</button>
    </nav>}
  </section>;
}
