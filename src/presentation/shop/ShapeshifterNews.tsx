import { QA_FORM_VISUALS } from '../qa/shapeshifter/visuals';
export function ShapeshifterNews({owned,busy,canClaim,onClaim,onPlay}:{owned:boolean;busy:boolean;canClaim:boolean;onClaim:()=>void;onPlay:()=>void}) {
 return <article className="shop-featured shop-shapeshifter" data-champion-news="shapeshifter">
  <div className="shop-featured-copy">
   <span className="shop-label">NUEVO CAMPEÓN · GRATIS</span><h2>CAMBIAFORMAS</h2>
   <strong className="shop-shifter-tagline">ELIGE TU CAMINO</strong>
   <p>Domina la resistencia del Oso, desata la fuerza del Minotauro o combina ambas transformaciones para construir tu propia estrategia.</p>
   <ul className="shop-shifter-paths">
    <li><b>OSO</b> Resistencia, protección y contraataques.</li>
    <li><b>MINOTAURO</b> Fuerza, embestidas y control del campo.</li>
    <li><b>HÍBRIDO</b> Combina ambas formas utilizando cartas universales Humano/Bestia.</li>
   </ul>
   <span className="shop-label">48 cartas en su catálogo · 2 transformaciones iniciales · Mazo personalizable</span>
   <button type="button" className="shop-primary" disabled={busy||(!owned&&!canClaim)} onClick={owned?onPlay:onClaim}>
    {busy?'Confirmando…':owned?'Jugar con Cambiaformas':'Desbloquear gratis'}
   </button>
   {!owned&&!canClaim&&<small>Inicia sesión para reclamar al campeón gratis.</small>}
  </div>
  <div className="shop-shifter-art" aria-hidden="true">
   {['bear','humanoid','minotaur'].map((id,i)=><img key={id} className={`shop-shifter-form form-${id}`} src={QA_FORM_VISUALS[id]!.poses.idle} alt="" loading={i===1?'eager':'lazy'} decoding="async" />)}
  </div>
 </article>;
}
