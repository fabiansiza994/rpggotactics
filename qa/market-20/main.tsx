import React from 'react';import{createRoot}from'react-dom/client';
import{FramedPortrait}from'../../src/presentation/shop/ProfileFrame';
import{PROFILE_FRAME_ART}from'../../src/presentation/assets/profileFrames';
import'../../src/styles/shop.css';
import'../../src/styles/arcane-market.css';
const names=['Áureo Arcano','Pacto Silvestre','Juramento','Duelista de Oro','Faceta de Diamante','Círculo de Bronce','Corona del Umbral'];
createRoot(document.getElementById('root')!).render(<main className="shop-screen" style={{height:'auto',minHeight:'100vh',padding:16,boxSizing:'border-box',background:'#091525',color:'#ecd7aa'}}><h1>Marcos · QA visual</h1><p>Recursos reales. Esta página no compra ni concede cosméticos.</p><div className="shop-offers" style={{gridTemplateColumns:'repeat(auto-fit,minmax(min(230px,100%),1fr))'}}>{Object.keys(PROFILE_FRAME_ART).map((id,i)=><article className="shop-offer" key={id}><FramedPortrait heroId="mage" frameId={id}/><div className="shop-offer-body"><h2>{names[i]}</h2><p>El ornamento completo permanece dentro de su tarjeta.</p></div></article>)}</div></main>);
