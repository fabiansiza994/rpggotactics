import { useEffect, useRef, useState } from 'react';
import { championPortrait } from '../assets/champions';
import { COSMETICS, STORE_CATALOG } from '../../game/data/store-catalog';
import { PROFILE_FRAME_ART } from '../assets/profileFrames';
import { legalPages } from './legal';
import { ChampionGuides } from './ChampionGuides';
import { PublicSupport } from './PublicSupport';
import '../../styles/official-site.css';


const gallery = [
  ['/site/battle.jpg', 'Combate real: tablero táctico, campeón y mano de cartas'],
  ['/art/checkpoint05/environments/sanctuary.webp', 'Arte oficial de la arena Santuario'],
  ['/art/infernal/forge-background.webp', 'Arte oficial del Reino Infernal'],
];
const faqs = [
  ['¿Qué es RPG GO Tactics?', 'Un juego de estrategia táctica por turnos con cartas, tablero y campeones de estilos distintos.'],
  ['¿Cómo accedo al juego?', 'Pulsa Jugar ahora. Tu cuenta conserva el progreso y las colecciones.'],
  ['¿Cómo consigo Cristales Arcanos?', 'Jugando con tu cuenta conectada: primera victoria diaria válida y recompensas únicas de campaña. Consulta Cómo conseguir cristales en la Tienda Arcana.'],
  ['¿Para qué sirven los Cristales Arcanos?', 'Para conseguir cartas, packs y cosméticos de la tienda. Cada oferta indica su contenido y precio en Cristales.'],
  ['¿Los cosméticos cambian el combate?', 'No. Personalizan tu apariencia sin cambiar las reglas.'],
  ['¿Dónde pido ayuda?', 'Usa Reportar un problema dentro del juego. Para dudas sobre la tienda, elige la categoría Tienda.'],
];
function Support() {
  return <><p>Atención sin sesión para compras y privacidad. <a href="/contact#public-support">Abrir formulario público →</a></p>{location.pathname === '/contact' && <PublicSupport />}</>;
}

function Catalog() {
  return (
    <>
      <div className="official-products">
        {Object.values(COSMETICS).map((c) => {
          const offer = STORE_CATALOG.find(
            (o) =>
              o.contents.some((i) => i.kind === 'COSMETIC' && i.cosmeticId === c.id) &&
              o.type === 'COSMETIC',
          );
          return (
            <article key={c.id}>
              <div className="official-product-art">
                <img
                  src={PROFILE_FRAME_ART[c.id]}
                  alt={c.name}
                  loading="lazy"
                  width="240"
                  height="320"
                />
              </div>
              <span className="official-eyebrow">COSMÉTICO · MARCO DE PERFIL</span>
              <h3>{c.name}</h3>
              <p>{c.description}</p>
              <strong className="official-price">◇ {offer?.price} Cristales Arcanos</strong>
              <small>
                Precio base del catálogo. Disponibilidad y propiedad verificadas dentro del juego.
              </small>
              <a href="/play?store=1">Consultar en el juego →</a>
            </article>
          );
        })}
      </div>
      <div className="official-commerce">
        <div>
          <h3>Cristales Arcanos</h3>
          <p>
            Obtén Cristales Arcanos jugando campañas y consiguiendo recompensas únicas. Consulta las fuentes disponibles en la Tienda Arcana.
          </p>
        </div>
        <div>
          <h3>Cartas y packs</h3>
          <p>
            El catálogo del juego incluye cartas y packs de campeón. Consulta allí las ofertas
            disponibles para tu cuenta y sus contenidos exactos.
          </p>
          <a href="/play?store=1">Abrir tienda del juego →</a>
        </div>
        <div>
          <h3>Pases de temporada</h3>
          <p>No disponibles. Beneficios, duración y condiciones pendientes de definición.</p>
        </div>
      </div>
      <p className="official-note">Las ofertas se adquieren con Cristales Arcanos. Su contenido y disponibilidad se verifican dentro del juego.</p>

    </>
  );
}
export default function OfficialSite() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const legal = legalPages[path.slice(1)];
  const [menu, setMenu] = useState(false);
  const [image, setImage] = useState<number | null>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    document.title = `${legal?.title ?? (path === '/store' ? 'Tienda digital' : path === '/contact' ? 'Soporte' : 'Invoca. Combate. Conquista.')} | RPG GO Tactics`;
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = `https://rpg-go-tactics.com${path === '/' ? '/' : path}`;
    document.head.appendChild(canonical);
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = legal ? 'noindex,follow' : 'index,follow';
    document.head.appendChild(robots);
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.08 },
    );
    document.querySelectorAll('.official-reveal').forEach((el) => observer.observe(el));
    return () => { observer.disconnect(); canonical.remove(); robots.remove(); };
  }, [legal, path]);
  useEffect(() => {
    if (image !== null) lightbox.current?.showModal();
  }, [image]);
  const home = path === '/';
  return (
    <div className="official-site">
      <a className="official-skip" href="#official-main">
        Saltar al contenido
      </a>
      <header className="official-header">
        <a className="official-brand" href="/" aria-label="RPG GO Tactics — Inicio">
          <span aria-hidden="true">✧</span>
          <span>
            RPG GO<small>TACTICS</small>
          </span>
        </a>
        <button
          className="official-menu"
          aria-expanded={menu}
          aria-controls="official-nav"
          onClick={() => setMenu(!menu)}
        >
          {menu ? 'Cerrar ×' : 'Menú ☰'}
        </button>
        <nav
          id="official-nav"
          data-open={menu}
          aria-label="Navegación principal"
          onClick={() => setMenu(false)}
        >
          <a href="/#game">El juego</a>
          <a href="/#champions">Campeones</a>
          <a href="/#modes">Modos de juego</a>
          <a href="/store">Tienda</a>
          <a href="/contact">Soporte</a>
          <a className="official-cta" href="/play">
            Jugar ahora ↗
          </a>
        </nav>
      </header>
      <main id="official-main">
        {home ? (
          <>
            <section className="official-hero">
              <div className="official-hero-copy">
                <span className="official-eyebrow">ESTRATEGIA TÁCTICA · FANTASÍA OSCURA</span>
                <h1>
                  RPG GO <em>TACTICS</em>
                </h1>
                <h2>
                  Invoca. Combate.
                  <br />
                  <em>Conquista.</em>
                </h2>
                <p>
                  Domina el campo de batalla en un juego de estrategia táctica por turnos, donde
                  cada carta, movimiento y decisión puede cambiar el destino del combate.
                </p>
                <div className="official-actions">
                  <a className="official-cta" href="/play">
                    Jugar ahora ↗
                  </a>
                  <a className="official-secondary" href="#game">
                    Descubrir el juego ↓
                  </a>
                </div>
                <span className="official-caption">
                  TU MAZO. TU CAMPEÓN. TU SIGUIENTE MOVIMIENTO.
                </span>
              </div>
              <div className="official-hero-art">
                <div className="official-orbit" />
                <img
                  src={championPortrait('mage')}
                  alt="Mago, campeón del arsenal arcano"
                  fetchPriority="high"
                  width="660"
                  height="880"
                />
                <span>✦ EL CAMPO TE ESPERA</span>
              </div>
            </section>
            <section id="game" className="official-section official-reveal">
              <span className="official-eyebrow">CADA DECISIÓN CUENTA</span>
              <h2>
                Un tablero.
                <br />
                <em>Infinitas formas de imponerte.</em>
              </h2>
              <div className="official-game">
                <figure>
                  <img
                    src="/site/battle.jpg"
                    alt={gallery[0]![1]}
                    width="1440"
                    height="900"
                    loading="lazy"
                  />
                  <figcaption>Captura real del juego · combate y mano de cartas</figcaption>
                </figure>
                <div>
                  {[
                    [
                      '01',
                      'Piensa en turnos',
                      'Gestiona tu energía, encuentra la casilla adecuada y decide cuándo atacar o protegerte.',
                    ],
                    [
                      '02',
                      'Construye tu estrategia',
                      'Combina cartas, movimiento y habilidades especiales en un mazo que responda a tu forma de jugar.',
                    ],
                    [
                      '03',
                      'Domina el terreno',
                      'Invoca criaturas, controla espacios y cumple objetivos para avanzar en la campaña.',
                    ],
                  ].map(([n, t, d]) => (
                    <article key={n}>
                      <span>{n}</span>
                      <div>
                        <h3>{t}</h3>
                        <p>{d}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
            <ChampionGuides />
            <section id="modes" className="official-section official-reveal">
              <span className="official-eyebrow">TU PRÓXIMO DESAFÍO</span>
              <h2>
                Una aventura. <em>Distintas batallas.</em>
              </h2>
              <div className="official-modes">
                {[
                  [
                    'Ⅰ',
                    'Campaña',
                    'Recorre una ruta de encuentros con objetivos y recompensas. Cada campeón conserva su propio progreso.',
                  ],
                  [
                    '⚔',
                    'PvP privado',
                    'Crea una sala e invita a un rival. Duelo y Dominio Arcano ponen a prueba tu lectura del campo.',
                  ],
                  [
                    '✦',
                    'Escaramuza',
                    'Entra en encuentros independientes para probar tus cartas e invocaciones.',
                  ],
                ].map(([i, t, d]) => (
                  <article key={t}>
                    <span>{i}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                    <a href="/play">Entrar al juego →</a>
                  </article>
                ))}
              </div>
            </section>
            <section className="official-section official-reveal">
              <span className="official-eyebrow">DESDE EL CAMPO DE BATALLA</span>
              <h2>
                Un mundo <em>por conquistar.</em>
              </h2>
              <div className="official-gallery">
                {gallery.map(([src, alt], i) => (
                  <button key={src} onClick={() => setImage(i)} aria-label={`Ampliar: ${alt}`}>
                    <img src={src} alt={alt} loading="lazy" width="640" height="400" />
                    <span>
                      {i === 0
                        ? 'Combate real'
                        : i === 1
                          ? 'Santuario'
                          : 'Reino Infernal · arte de escenario'}{' '}
                      ↗
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
        {(home || path === '/store') && (
          <section className="official-section official-reveal" id="shop">
            <span className="official-eyebrow">TIENDA DIGITAL</span>
            {path === '/store' ? (
              <h1>
                Personaliza <em>tu leyenda.</em>
              </h1>
            ) : (
              <h2>
                Personaliza <em>tu leyenda.</em>
              </h2>
            )}
            <p className="official-intro">
              Objetos del juego, identidad propia. Descubre los marcos auténticos del catálogo.
            </p>
            <Catalog />
          </section>
        )}
        {(home || path === '/contact') && (
          <section className="official-section official-reveal">
            {path === '/contact' && <h1>Soporte y atención al comprador</h1>}
            <Support />
          </section>
        )}
        {legal && (
          <article className="official-legal">
            <span className="official-eyebrow">DOCUMENTO PARA REVISIÓN</span>
            <h1>{legal.title}</h1>
            <p className="official-draft" role="note">
              BORRADOR · Pendiente de aprobación. No constituye una política comercial definitiva
              lista para publicación.
            </p>
            <nav aria-label="Índice del documento"><ol>{legal.sections.map(([t], i) => <li key={t}><a href={`#legal-${i}`}>{t}</a></li>)}</ol></nav>
            {legal.sections.map(([t, d], i) => (
              <section key={t} id={`legal-${i}`}>
                <h2>{t}</h2>
                <p>{d}</p>
              </section>
            ))}
            <nav aria-label="Documentos relacionados"><a href="/terms">Términos</a> · <a href="/privacy">Privacidad</a> · <a href="/delivery">Entregas</a> · <a href="/refunds">Reembolsos</a> · <a href="/contact">Soporte público</a></nav>
            <a href="https://www.sic.gov.co/" target="_blank" rel="noopener noreferrer">Superintendencia de Industria y Comercio</a>
          </article>
        )}
        {home && (
          <section className="official-section official-faq">
            <span className="official-eyebrow">ANTES DE ENTRAR</span>
            <h2>Preguntas frecuentes</h2>
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </section>
        )}
      </main>
      <footer className="official-footer">
        <a className="official-brand" href="/">
          RPG GO <small>TACTICS</small>
        </a>
        <p>
          Responsable comercial: Fabian Mauricio Siza Paladines.
          <br />
          Videojuego digital y contenido virtual.
        </p>
        <nav aria-label="Enlaces del pie">
          {[
            ['/', 'Inicio'],
            ['/play', 'Jugar'],
            ['/store', 'Tienda'],
            ['/contact', 'Soporte'],
            ['/terms', 'Términos'],
            ['/privacy', 'Privacidad'],
          ].map(([href, label]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
        <small>RPG GO Tactics · Estrategia, campeones y cartas.</small>
      </footer>
      <dialog
        ref={lightbox}
        className="official-lightbox"
        aria-label="Galería ampliada"
        onCancel={() => setImage(null)}
      >
        <button
          autoFocus
          aria-label="Cerrar galería"
          onClick={() => {
            lightbox.current?.close();
            setImage(null);
          }}
        >
          Cerrar ×
        </button>
        {image !== null && (
          <>
            <img src={gallery[image]![0]} alt={gallery[image]![1]} />
            <p>{gallery[image]![1]}</p>
            <div>
              <button onClick={() => setImage((image + gallery.length - 1) % gallery.length)}>
                ← Anterior
              </button>
              <button onClick={() => setImage((image + 1) % gallery.length)}>Siguiente →</button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
