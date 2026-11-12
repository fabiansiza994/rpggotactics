import { Component, type ReactNode } from 'react';

/** A failed lazy import must leave a usable recovery path instead of an empty root. */
export class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main role="alert" aria-label="Error al cargar el juego" style={{maxWidth:440,margin:'15vh auto',padding:24,color:'#f5e6c4',background:'#0d1c2a',border:'1px solid #ad8b55',borderRadius:12,fontFamily:'system-ui'}}>
      <h1 style={{fontSize:22}}>No se pudo cargar el juego</h1>
      <p>La carga se interrumpió. Comprueba tu conexión y vuelve a intentarlo.</p>
      <button type="button" onClick={() => window.location.reload()} style={{minHeight:44,padding:'10px 18px',color:'#ffe8b1',background:'#233d50',border:'1px solid #c6a66e',borderRadius:6}}>Reintentar carga</button>
    </main>;
  }
}
