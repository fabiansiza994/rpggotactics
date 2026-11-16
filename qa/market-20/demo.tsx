import { DEFAULT_CONTENT } from "../../src/game";
import { MarketCard } from "../../src/presentation/shop/MarketCard";
import { MarketHome } from "../../src/presentation/shop/MarketHome";
import { StoreArt, CrystalIcon } from "../../src/presentation/shop/StoreArt";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExpansionCatalog } from "../../src/presentation/shop/ExpansionCatalog";
import { packExpansion } from "../../src/presentation/shop/PackArt";
import { PackConfirmation } from "../../src/presentation/shop/PackConfirmation";
import {
  PackBatchOpening,
  batchSceneKey,
} from "../../src/presentation/shop/PackBatchOpening";
import { useMarketNavigation } from "../../src/presentation/shop/marketNavigation";
import { MarketCardPreview } from "../../src/presentation/shop/MarketCardPreview";
import { MARKET_SECTIONS } from "../../src/presentation/shop/market";
import { FramedPortrait } from "../../src/presentation/shop/ProfileFrame";
import { PROFILE_FRAME_ART } from "../../src/presentation/assets/profileFrames";
import type { CatalogOffer } from "../../src/presentation/shop/api";
import {
  DEMO_KEY,
  demoShowcase,
  expansions,
  offers,
  freshDemo,
  simulatePurchase,
  type DemoState,
} from "./demo-state";
import "../../src/styles/shop.css";
import "../../src/styles/arcane-market.css";
import "./demo.css";
function Lab() {
  const [state, setState] = useState<DemoState>(() => {
    try {
      const s = sessionStorage.getItem(DEMO_KEY);
      if (s) return JSON.parse(s) as DemoState;
    } catch {
      /* Only disposable demo data. */
    }
    return freshDemo();
  });
  const {
    category,
    expansionId: selected,
    navigate: navigateMarket,
    up: marketUp,
  } = useMarketNavigation();
  const setCategory = (id: typeof category) => navigateMarket(id);
  const setSelected = (id: string | null) =>
    id ? navigateMarket("packs", id) : marketUp();
  const [showcase, setShowcase] = useState<CatalogOffer | null>(null);
  const [hero, setHero] = useState("mage");
  const [inspect, setInspect] = useState<string | null>(null),
    [confirm, setConfirm] = useState<CatalogOffer | null>(null),
    [opening, setOpening] = useState<DemoState["purchases"][number] | null>(
      () => {
        const last = state.purchases.at(-1);
        if (!last) return null;
        try {
          const raw = localStorage.getItem(batchSceneKey(`demo-${last.id}-0`));
          return raw && JSON.parse(raw).summary === true ? null : last;
        } catch {
          return last;
        }
      },
    ),
    [error, setError] = useState(""),
    [tab, setTab] = useState("Tienda"),
    [blur, setBlur] = useState(false),
    [metrics, setMetrics] = useState(""),
    [replay, setReplay] = useState(0),
    [fixture, setFixture] = useState("random");
  const liveOffers = offers.map((o) => {
    if (!o.booster?.freeGrant) return o;
    const n = Math.max(
      0,
      (o.purchaseLimit ?? 0) -
        state.purchases.filter((p) => p.offerId === o.id).length,
    );
    return {
      ...o,
      freeRemaining: n,
      availability: { ...o.availability, purchasable: n > 0 },
    };
  });
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef(0);
  useEffect(() => {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(state));
  }, [state]);
  useEffect(() => {
    if (confirm || opening || showcase) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirm, opening, showcase]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const close = () => {
    setConfirm(null);
    setShowcase(null);
    setOpening(null);
    setInspect(null);
  };
  const buy = () => {
    if (!confirm) return;
    try {
      let n = 0;
      const rolls = [99, 0, 90, 0, 20, 0, 60, 0];
      const below =
        fixture === "rarities"
          ? (bound: number) => rolls[n++ % rolls.length]! % bound
          : fixture === "duplicates"
            ? () => 0
            : undefined;
      const next = simulatePurchase(state, confirm.id, below);
      setState(next);
      setOpening(next.purchases.at(-1)!);
      setConfirm(null);
    } catch (e) {
      setError(String(e));
      setConfirm(null);
    }
  };
  const measure = () => {
    cancelAnimationFrame(frame.current);
    setMetrics("Midiendo 5 segundos…");
    const times: number[] = [];
    let start = 0,
      last = 0;
    const tick = (now: number) => {
      if (!start) {
        start = last = now;
      } else {
        times.push(now - last);
        last = now;
      }
      if (now - start < 5000) frame.current = requestAnimationFrame(tick);
      else {
        const a = [...times].sort((a, b) => a - b);
        setMetrics(
          JSON.stringify({
            blur,
            frames: a.length,
            fps: (1000 * a.length) / times.reduce((a, b) => a + b, 0),
            median: a[Math.floor(a.length * 0.5)],
            p95: a[Math.floor(a.length * 0.95)],
            max: a.at(-1),
          }),
        );
      }
    };
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <div className="qa-market-app">
      <aside className="qa-tools">
        <strong>DEMOSTRACIÓN QA · DATOS SIMULADOS</strong>
        <details>
          <summary>Controles de demostración</summary>
          <p>
            Sin sesión, sin servicios ni compras reales. Saldo y colección solo
            en esta pestaña.
          </p>
          <div>
            <button
              onClick={() => {
                for (const k of Object.keys(localStorage))
                  if (
                    k.startsWith("rpggo.pack-scene.v1:demo-") ||
                    k.startsWith("rpggo.pack-batch.v1:demo-")
                  )
                    localStorage.removeItem(k);
                setState(freshDemo());
                close();
                setError("");
              }}
            >
              Reiniciar saldo, colección y compras
            </button>
            <a href="/play?mode=store">QA autenticado local ↗</a>
            <button onClick={measure}>Medir 5 s</button>
            <label>
              Escenario de apertura QA
              <select
                aria-label="Escenario de apertura QA"
                value={fixture}
                onChange={(e) => setFixture(e.target.value)}
              >
                <option value="random">Aleatorio real</option>
                <option value="rarities">Rara y legendaria · fixture</option>
                <option value="duplicates">Duplicados · fixture</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={blur}
                onChange={(e) => setBlur(e.target.checked)}
              />{" "}
              Desenfoque de fondo · comparación QA
            </label>
          </div>
          <section className="qa-receipts">
            <h2>Compras simuladas · {state.purchases.length}</h2>
            {state.purchases.map((p) => (
              <button key={p.id} onClick={() => setOpening(p)}>
                Consultar sobre DEMO #{p.id} · {(p.openings?.length ?? 1) * 4}{" "}
                cartas
              </button>
            ))}
          </section>
          <output aria-live="polite">{metrics}</output>
          <details>
            <summary>Diagnóstico de errores del laboratorio</summary>
            <pre id="qa-errors">Sin errores capturados al iniciar.</pre>
          </details>
        </details>
      </aside>
      <header className="qa-market-header">
        <strong>✧ RPG-GO TACTICS</strong>
        <span
          className="qa-market-balance"
          aria-label={`Cristales de demostración: ${state.balance}`}
        >
          <CrystalIcon />
          {state.balance.toLocaleString("es-CO")}
        </span>
      </header>
      <main className="shop-screen qa-market-content">
        {!(category === "packs" && selected) && <h1>Mercado Arcano</h1>}
        {tab !== "Tienda" && (
          <section className="qa-notice">
            <h2>{tab} · navegación de demostración</h2>
            <p>
              Este laboratorio demuestra el mercado; el juego autenticado está
              disponible por separado.
            </p>
            <button onClick={() => setTab("Tienda")}>
              Volver al Mercado Arcano
            </button>
          </section>
        )}
        {tab === "Tienda" && (
          <>
            {category !== "featured" && !(category === "packs" && selected) && (
              <nav className="market-nav" aria-label="Categorías del mercado">
                {MARKET_SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    aria-pressed={category === s.id}
                    onClick={() => setCategory(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>
            )}
            {category === "packs" && !selected && (
              <button onClick={marketUp}>← Mercado Arcano</button>
            )}
            {category === "featured" && (
              <MarketHome
                expansions={expansions}
                offers={[...liveOffers, ...demoShowcase]}
                profile={state.profile}
                heroId={hero}
                onExpansion={(id) => navigateMarket("packs", id)}
                onCategory={setCategory}
                onOffer={setShowcase}
              />
            )}
            {category === "packs" && (
              <ExpansionCatalog
                expansions={expansions}
                offers={liveOffers}
                balance={state.balance}
                busy={false}
                selectedId={selected}
                onSelect={setSelected}
                profile={state.profile}
                onInspect={setInspect}
                onBuy={setConfirm}
              />
            )}
            {category === "cards" && (
              <section>
                <h2>Cartas individuales</h2>
                <p>Catálogo real · Solo visualización QA</p>
                <div className="market-expansion-cards">
                  {demoShowcase
                    .filter((o) => o.type === "CARD")
                    .map((o) => {
                      const item = o.contents.find((c) => c.kind === "CARD");
                      const card =
                        item?.kind === "CARD"
                          ? DEFAULT_CONTENT.cards[item.cardId]
                          : null;
                      return card ? (
                        <button
                          key={o.id}
                          className="market-card-button"
                          onClick={() => setInspect(card.id)}
                          aria-label={`Consultar ${card.name}`}
                        >
                          <MarketCard card={card} />
                        </button>
                      ) : null;
                    })}
                </div>
              </section>
            )}
            {category === "cosmetics" && (
              <section>
                <h2>Marcos · vista previa sin compra</h2>
                <div className="shop-offers">
                  {Object.keys(PROFILE_FRAME_ART).map((id) => (
                    <article className="shop-offer" key={id}>
                      <FramedPortrait frameId={id} heroId={hero} />
                      <p>{id}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {category === "crystals" && (
              <section>
                <h2>Cristales de demostración</h2>
                <p>
                  Las operaciones económicas están desconectadas. Reinicia el
                  laboratorio para recuperar 2000 Cristales simulados.
                </p>
              </section>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
      <nav className="qa-bottom" aria-label="Navegación inferior DEMO">
        {["Inicio", "Jugar", "Cartas", "Tienda", "Perfil"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <dialog
        ref={dialog}
        className="shop-dialog qa-market-dialog"
        data-blur={blur}
        onCancel={close}
      >
        <button
          className="shop-close"
          aria-label="Cerrar detalle"
          onClick={close}
        >
          ×
        </button>
        {showcase ? (
          <section className="qa-showcase-detail">
            <StoreArt offer={showcase} heroId={hero} />
            <h2>{showcase.title}</h2>
            <p>{showcase.description}</p>
            <p>{showcase.price.toLocaleString("es-CO")} Cristales</p>
            <p>Vista previa QA · Compra y regalos deshabilitados.</p>
          </section>
        ) : confirm ? (
          <PackConfirmation
            offer={confirm}
            balance={state.balance}
            busy={false}
            onConfirm={buy}
            onCancel={() => setConfirm(null)}
            demo
          />
        ) : opening ? (
          <>
            <p className="qa-demo-label">
              SOBRE SIMULADO #{opening.id} · SIN PREMIOS REALES
            </p>
            <details className="qa-scene-tools">
              <summary>Herramientas de escena QA</summary>
              <div className="qa-opening-tools">
                <button
                  onClick={() => {
                    setReplay((n) => n + 1);
                  }}
                >
                  Repetir escena (sin comprar)
                </button>
                <button onClick={measure}>Medir escena actual · 5 s</button>
                <label>
                  <input
                    type="checkbox"
                    checked={blur}
                    onChange={(e) => setBlur(e.target.checked)}
                  />{" "}
                  Desenfoque QA
                </label>
                <output>{metrics}</output>
              </div>
            </details>
            <PackBatchOpening
              key={`${opening.id}-${replay}`}
              openings={opening.openings ?? [opening.opening]}
              receiptId={`demo-${opening.id}-${replay}`}
              onDone={() => {
                setSelected(packExpansion(opening.opening.packId)?.id ?? null);
                setHero(opening.opening.cards[0]?.heroId ?? "mage");
                close();
              }}
              onInspect={setInspect}
            />
          </>
        ) : null}
      </dialog>
      <MarketCardPreview cardId={inspect} onClose={() => setInspect(null)} />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Lab />);
