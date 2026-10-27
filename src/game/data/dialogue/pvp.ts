import type { PvpMatchupDef } from '../../dialogue/dialogue';

/**
 * PvP intro banter: one entry per unordered pair (lookup works in either order) plus mirrors.
 * `by` indexes `pair`; in a mirror, 0 is seat 0's champion. Two variants each, chosen from the
 * match id, so both seats see the same exchange. Keep each line to one breath.
 */
export const PVP_MATCHUPS: readonly PvpMatchupDef[] = [
  {
    pair: ['mage', 'summoner'],
    variants: [
      [
        { by: 0, text: 'Invocar ayuda. Lo que hace quien no sabe hacerlo solo.', expression: 'amused' },
        { by: 1, text: 'Tú hablas solo. Yo nunca estoy solo.', expression: 'serious' },
      ],
      [
        { by: 1, text: 'Tu magia se apaga cuando te cansas. Mis pactos, no.', expression: 'serious' },
        { by: 0, text: 'Entonces terminaré antes de cansarme. No será difícil.', expression: 'confident' },
      ],
    ],
  },
  {
    pair: ['mage', 'warrior'],
    variants: [
      [
        { by: 1, text: 'Deja los libros. Aquí se pelea de frente.', expression: 'confident' },
        { by: 0, text: 'Encantador. Un argumento con escudo.', expression: 'amused' },
      ],
      [
        { by: 0, text: 'Tanta armadura para tan pocas ideas.', expression: 'amused' },
        { by: 1, text: 'Las ideas no paran golpes. El escudo, sí.', expression: 'confident' },
      ],
    ],
  },
  {
    pair: ['mage', 'shapeshifter'],
    variants: [
      [
        { by: 1, text: 'Hueles a tinta y a miedo, hechicero.', expression: 'amused' },
        { by: 0, text: 'Y tú a perro mojado. Cada uno con su perfume.', expression: 'amused' },
      ],
      [
        { by: 0, text: '¿Cuántas formas necesitas para perder?', expression: 'confident' },
        { by: 1, text: 'Solo una. La que te muerda primero.', expression: 'angry' },
      ],
    ],
  },
  {
    pair: ['mage', 'archer'],
    variants: [
      [
        { by: 0, text: 'Una cuerda y unas flechas contra el poder arcano. Qué optimista.', expression: 'amused' },
        { by: 1, text: 'Hablas mucho para alguien que tiene que quedarse quieto para lanzar.', expression: 'neutral' },
      ],
      [
        { by: 1, text: 'Tu túnica brilla. Se ve desde muy lejos.', expression: 'amused' },
        { by: 0, text: 'Que me veas no significa que me alcances.', expression: 'confident' },
        { by: 1, text: 'Ya veremos.', expression: 'neutral' },
      ],
    ],
  },
  {
    pair: ['summoner', 'warrior'],
    variants: [
      [
        { by: 1, text: 'Escóndete detrás de tus bestias, si quieres. Pasaré por encima.', expression: 'confident' },
        { by: 0, text: 'Muchos lo dijeron. Ellas siguen aquí.', expression: 'serious' },
      ],
      [
        { by: 0, text: 'Tu escudo detiene un golpe. ¿Cuántos puedes detener?', expression: 'serious' },
        { by: 1, text: 'Todos los que hagan falta para llegar a ti.', expression: 'angry' },
      ],
    ],
  },
  {
    pair: ['summoner', 'shapeshifter'],
    variants: [
      [
        { by: 1, text: 'Tus bestias obedecen. La mía soy yo.', expression: 'amused' },
        { by: 0, text: 'Entonces solo tengo que romper una.', expression: 'serious' },
      ],
      [
        { by: 0, text: 'Serías una criatura magnífica… atada a un pacto.', expression: 'serious' },
        { by: 1, text: 'Nadie me pone correa. Inténtalo.', expression: 'angry' },
      ],
    ],
  },
  {
    pair: ['summoner', 'archer'],
    variants: [
      [
        { by: 0, text: 'Siempre puedo traer otra criatura.', expression: 'serious' },
        { by: 1, text: 'Perfecto. Así no tendré que buscar objetivos.', expression: 'amused' },
      ],
      [
        { by: 1, text: 'Cuento muchas bestias y un invocador. Solo me importa uno.', expression: 'neutral' },
        { by: 0, text: 'Ellas también te están contando a ti.', expression: 'serious' },
      ],
    ],
  },
  {
    pair: ['warrior', 'shapeshifter'],
    variants: [
      [
        { by: 0, text: 'Cambia de forma cuanto quieras. El acero las corta todas.', expression: 'confident' },
        { by: 1, text: 'Primero tendrás que alcanzarme, lata con patas.', expression: 'amused' },
      ],
      [
        { by: 1, text: 'Te arrancaré ese escudo de las manos.', expression: 'angry' },
        { by: 0, text: 'Muchos lo intentaron. Por eso sigo llevándolo.', expression: 'confident' },
      ],
    ],
  },
  {
    pair: ['warrior', 'archer'],
    variants: [
      [
        { by: 0, text: 'Cuando llegue hasta ti, ese arco no servirá de nada.', expression: 'confident' },
        { by: 1, text: 'Entonces será mejor que consigas llegar.', expression: 'amused' },
      ],
      [
        { by: 1, text: 'Armadura pesada. Pasos lentos. Ya sé dónde vas a estar.', expression: 'neutral' },
        { by: 0, text: 'Bien. Así sabrás también de dónde viene el golpe.', expression: 'confident' },
      ],
    ],
  },
  {
    pair: ['shapeshifter', 'archer'],
    variants: [
      [
        { by: 0, text: 'Puedes seguir mis huellas. No sabrás qué encontrarás al final.', expression: 'amused' },
        { by: 1, text: 'Las huellas cambian. El blanco no.', expression: 'neutral' },
      ],
      [
        { by: 1, text: 'Lobo, oso, lo que seas. Todos caen con la misma flecha.', expression: 'neutral' },
        { by: 0, text: 'Entonces más te vale no fallar la primera.', expression: 'angry' },
      ],
    ],
  },
  // Mirrors: by 0 = seat 0, by 1 = seat 1.
  {
    pair: ['mage', 'mage'],
    variants: [
      [
        { by: 0, text: 'Otro estudioso de lo arcano. Qué refrescante.', expression: 'amused' },
        { by: 1, text: 'No te emociones. Solo uno de los dos aprueba hoy.', expression: 'confident' },
      ],
      [
        { by: 0, text: 'Reconozco esos gestos. Copias mis hechizos.', expression: 'serious' },
        { by: 1, text: 'Los mejoro. No es lo mismo.', expression: 'amused' },
      ],
    ],
  },
  {
    pair: ['summoner', 'summoner'],
    variants: [
      [
        { by: 0, text: 'Tus pactos y los míos beben del mismo pozo.', expression: 'serious' },
        { by: 1, text: 'Entonces veremos quién tiene más sed.', expression: 'serious' },
      ],
      [
        { by: 0, text: 'Tus criaturas me miran como si me conocieran.', expression: 'serious' },
        { by: 1, text: 'Te conocen. Te estaban esperando.', expression: 'amused' },
      ],
    ],
  },
  {
    pair: ['warrior', 'warrior'],
    variants: [
      [
        { by: 0, text: 'Por fin, alguien que pelea de frente.', expression: 'confident' },
        { by: 1, text: 'Escudo contra escudo. Como debe ser.', expression: 'confident' },
      ],
      [
        { by: 0, text: 'No retrocedas.', expression: 'serious' },
        { by: 1, text: 'No sé cómo se hace.', expression: 'amused' },
      ],
    ],
  },
  {
    pair: ['shapeshifter', 'shapeshifter'],
    variants: [
      [
        { by: 0, text: 'Dos depredadores. Un solo territorio.', expression: 'angry' },
        { by: 1, text: 'Entonces uno de los dos acaba siendo presa.', expression: 'amused' },
      ],
      [
        { by: 0, text: 'Hueles igual que yo.', expression: 'amused' },
        { by: 1, text: 'Pero muerdo más fuerte.', expression: 'angry' },
      ],
    ],
  },
  {
    pair: ['archer', 'archer'],
    variants: [
      [
        { by: 0, text: 'Mismo arco. Misma distancia.', expression: 'neutral' },
        { by: 1, text: 'Distinto pulso. Ya lo verás.', expression: 'amused' },
      ],
      [
        { by: 0, text: 'Te vi apuntar antes de que llegaras.', expression: 'neutral' },
        { by: 1, text: 'Lo sé. Te dejé verlo.', expression: 'amused' },
      ],
    ],
  },
];

/** One short winner line per ordered matchup (`winner>loser`), mirrors included. */
export const PVP_VICTORY: Readonly<Record<string, string>> = {
  'mage>summoner': 'Muchas criaturas, ningún método. Lástima.',
  'mage>warrior': 'El escudo era bueno. El argumento, no tanto.',
  'mage>shapeshifter': 'Tantas formas, y ninguna resistía al fuego.',
  'mage>archer': 'Una flecha llega lejos. Un hechizo, más.',
  'mage>mage': 'Buen intento. Sigue estudiando.',
  'summoner>mage': 'Tu magia se agotó. Ellas siguen aquí.',
  'summoner>warrior': 'Detuviste muchos golpes. No todos.',
  'summoner>shapeshifter': 'Al final, toda bestia acepta un pacto.',
  'summoner>archer': 'Te faltaron flechas. A mí nunca me faltan criaturas.',
  'summoner>summoner': 'Tus criaturas ahora me escuchan a mí.',
  'warrior>mage': 'Te dije que llegaría. Llegué.',
  'warrior>summoner': 'Pasé por encima de todas. Como prometí.',
  'warrior>shapeshifter': 'Te alcancé. En todas tus formas.',
  'warrior>archer': 'Conseguí llegar.',
  'warrior>warrior': 'Gran combate. Levántate, te lo ganaste.',
  'shapeshifter>mage': 'Las páginas no te salvaron de los colmillos.',
  'shapeshifter>summoner': 'Tu manada huyó. La mía no.',
  'shapeshifter>warrior': 'El acero pesa. Yo no.',
  'shapeshifter>archer': 'Seguiste mis huellas. Te trajeron hasta mí.',
  'shapeshifter>shapeshifter': 'Este territorio es mío.',
  'archer>mage': 'Tanto poder… y aun así no viste venir la flecha.',
  'archer>summoner': 'Muchos objetivos. Ninguna flecha perdida.',
  'archer>warrior': 'No llegaste.',
  'archer>shapeshifter': 'Cambiaste de forma. No de sitio.',
  'archer>archer': 'Mismo arco. Mejor pulso.',
};
