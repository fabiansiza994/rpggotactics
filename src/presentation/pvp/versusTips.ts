import { PVP_MAPS } from "../../game/pvp/maps";
import type { LobbyRoom } from "./PvpLobby";
export interface VersusTip {
  id: string;
  title: string;
  text: string;
}
const tip = (id: string, title: string, text: string): VersusTip => ({
  id,
  title,
  text,
});
/** Public room data only: never reads decks, hands or authoritative state. */
export function versusTips(room: LobbyRoom): VersusTip[] {
  const map = PVP_MAPS.find((m) => m.id === room.mapId);
  const symbols: VersusTip[] = [];
  if (map?.layout.some((row) => row.includes("H")))
    symbols.push(
      tip(
        "hazard",
        "Peligro · símbolo rojizo",
        "El símbolo rojizo marca peligro: causa 1 de daño de fuego al terminar el turno en esa casilla.",
      ),
    );
  if (map?.layout.some((row) => row.includes("A")))
    symbols.push(
      tip(
        "arcane",
        "Arcano · símbolo morado",
        "El símbolo morado marca terreno arcano: tu campeón recibe +1 de energía si inicia allí su turno.",
      ),
    );
  if (symbols.length) return symbols;
  const tips = [
    tip(
      "position",
      "Gana posición",
      "Comprueba alcance y línea de visión antes de gastar movimiento. La previsualización te ayuda a elegir el objetivo.",
    ),
    tip(
      "energy",
      "Administra tu energía",
      "Revisa el coste y las casillas válidas antes de activar una carta. Cancelar la selección no juega la carta.",
    ),
    tip(
      "armor",
      "Armadura y escudo",
      "La armadura reduce el daño; después, el escudo absorbe el daño restante antes de perder vida.",
    ),
    tip(
      "rear",
      "Ataques por la espalda",
      "En PvP, atacar por la espalda no concede daño adicional. Prioriza alcance, cobertura y posición.",
    ),
  ];
  if (map?.layout.some((row) => row.includes("C")))
    tips.push(
      tip(
        "cover",
        "Aprovecha la cobertura",
        "La cobertura reduce en 1 el daño de los ataques a distancia elegibles.",
      ),
    );
  if (map?.layout.some((row) => row.includes("#")))
    tips.push(
      tip(
        "void",
        "Respeta el vacío",
        "Las casillas de vacío no son transitables. Busca un paso válido antes de avanzar.",
      ),
    );
  if (room.mode === "DOMINION")
    tips.push(
      tip(
        "dominion",
        "Dominio Arcano",
        "Controla los nodos del mapa: alcanza 8 puntos o derrota al campeón rival para vencer.",
      ),
    );
  const own = room.members[room.seat]?.heroId,
    rival = room.members[1 - room.seat]?.heroId;
  if (own === "mage")
    tips.push(
      tip(
        "mage",
        "Mago · prepara el hechizo",
        "Comprueba la línea de visión y el patrón de la carta antes de gastar energía.",
      ),
    );
  if (own === "summoner")
    tips.push(
      tip(
        "summoner",
        "Invocador · despliega con cuidado",
        "Previsualiza la casilla de invocación: debe ser un destino válido y libre.",
      ),
    );
  if (rival === "summoner")
    tips.push(
      tip(
        "enemy-summoner",
        "Frente al Invocador",
        "Vigila las criaturas invocadas y sus posiciones, además del campeón rival.",
      ),
    );
  if (own === "shapeshifter")
    tips.push(
      tip(
        "forms",
        "Cambiaformas · elige tu forma",
        "Revisa las habilidades de tu forma activa antes de decidir cómo moverte y atacar.",
      ),
    );
  if (own === "shapeshifter" || rival === "shapeshifter")
    tips.push(
      tip(
        "counter",
        "Oso y Minotauro",
        "Oso y Minotauro responden a ataques físicos cuerpo a cuerpo elegibles con un contraataque; la armadura puede reducir su daño.",
      ),
    );
  return tips;
}
/** Select once per presentation; remembering one ID avoids immediate repeats without storing player data. */
export function chooseVersusTip(
  room: LobbyRoom,
  previous?: string,
  random = Math.random,
): VersusTip {
  const all = versusTips(room),
    pool = all.filter((t) => t.id !== previous);
  const eligible = pool.length ? pool : all;
  return eligible[
    Math.min(
      eligible.length - 1,
      Math.max(0, Math.floor(random() * eligible.length)),
    )
  ]!;
}
let lastTip: string | undefined;
export function nextVersusTip(room: LobbyRoom): VersusTip {
  const selected = chooseVersusTip(room, lastTip);
  lastTip = selected.id;
  return selected;
}
