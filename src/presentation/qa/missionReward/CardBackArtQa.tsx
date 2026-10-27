import { CardBackFace } from '../../cosmetics/CardBack';
import type { Cosmetics } from '../../shop/api';
const standard:Cosmetics={owned:[],equipped:{}};
const premium:Cosmetics={owned:[{cosmeticId:'cardback_premium_arcane_circle',kind:'CARD_BACK',acquiredAt:1}],equipped:{CARD_BACK:'cardback_premium_arcane_circle'}};
/** Actual shared renderer at large and HUD sizes; no account writes or ownership changes. */
export function CardBackArtQa() {
  return <section className="back-art-qa" aria-label="Comparación de reversos">
    <style>{`.back-art-qa{width:min(760px,95vw);max-height:95dvh;overflow:auto;padding:16px;box-sizing:border-box;background:#0b1624e8;border:1px solid #a78d5b;color:#e5d8b7;border-radius:10px;text-align:center}.back-art-row{display:flex;gap:24px;align-items:start;justify-content:center}.back-art-qa figure{margin:0}.back-art-large{width:min(220px,28vw);height:min(308px,39.2vw)}.back-art-large>.card-back-face{width:100%;height:100%;box-sizing:border-box;border-radius:8px}.back-art-small{display:flex;gap:16px;align-items:center;justify-content:center;padding:14px}.back-art-small .card-back-face:nth-child(2){width:52px;height:72px}.back-art-qa figcaption{padding:8px;font-size:12px}.back-art-qa h2{margin:0 0 14px;font:24px Georgia,serif}.back-art-qa p{font-size:12px}.back-art-turned{transform:rotate(180deg)}@media(max-height:500px){.back-art-large{width:125px;height:175px}.back-art-qa{padding:10px}.back-art-qa h2{font-size:17px;margin-bottom:6px}.back-art-small{padding:4px}.back-art-qa figcaption{padding:3px}}`}</style>
    <h2>Reverso oficial · Standard / Premium</h2>
    <div className="back-art-row">{[[standard,'Standard'],[premium,'Sello del Círculo Arcano · Premium']].map(([cosmetics,label])=><figure key={String(label)}><div className="back-art-large"><CardBackFace cosmetics={cosmetics as Cosmetics}/></div><figcaption>{String(label)}</figcaption><div className="back-art-small"><CardBackFace cosmetics={cosmetics as Cosmetics}/><CardBackFace cosmetics={cosmetics as Cosmetics}/></div></figure>)}</div>
    <p>Miniaturas reales: 26×36 y 52×72. Mismo asset y renderer, sin estirar.</p>
    <details><summary>Standard girado 180°</summary><div className="back-art-large back-art-turned" style={{margin:'12px auto'}}><CardBackFace cosmetics={standard}/></div></details>
  </section>;
}
