import type { EncounterDialogueDef } from '../../dialogue/dialogue';

/**
 * Campaign scenes keyed by encounter id. Main acts (El Ascenso, Reino Infernal, El Templo del Umbral) author the enemy
 * side once; the champion answers with its own `byHero` line when written, else a line from its
 * response pool (voices.ts). Normal fights: 1–2 lines. Elites and bosses: 2–4 exchanges, plus a
 * defeat scene. Champion stories (Sendero del Cazador) are written for their one champion.
 * Speaker 'HERO' = the run's champion, 'narrator' = scene text without a portrait.
 */
const MAIN_ACTS: Readonly<Record<string, EncounterDialogueDef>> = {
  // ---------------------------------------------------------------- El Ascenso
  ascent_01_outpost: {
    intro: [
      { speaker: 'orc_warrior', text: '¡Alto! Nadie cruza el puesto de guardia.', expression: 'angry' },
      { speaker: 'HERO', pool: 'encounter' },
    ],
  },
  ascent_02_watchtower: {
    intro: [
      { speaker: 'dark_shaman', text: 'Desde la atalaya lo veo todo. Y te he visto a ti.' },
      { speaker: 'HERO', byHero: { archer: 'Bien. Yo también te veo.' }, pool: 'encounter' },
    ],
  },
  ascent_03_open_field: {
    intro: [
      { speaker: 'orc_warrior', text: '¡Los orbes son del chamán! ¡Fuera de aquí!', expression: 'angry' },
      { speaker: 'HERO', byHero: { mage: 'Orbes arcanos en manos de orcos. Qué desperdicio.' }, pool: 'encounter' },
    ],
  },
  ascent_04_shield_wall: {
    intro: [
      { speaker: 'stone_brute', text: 'Muro. Yo soy muro.' },
      { speaker: 'HERO', byHero: { warrior: 'Yo también. Veamos cuál aguanta.' }, pool: 'encounter' },
    ],
  },
  ascent_05_alpha: {
    intro: [
      { speaker: 'narrator', text: 'Un aullido largo baja por la ladera. El Alfa ha olido sangre.' },
      {
        speaker: 'HERO',
        byHero: { shapeshifter: 'Un alfa. Por fin alguien que entiende la caza.', archer: 'Carga en línea recta. Qué considerado.' },
        pool: 'elite',
      },
      { speaker: 'narrator', text: 'El Alfa enseña los colmillos y toma carrerilla.', hint: { emphasis: 'shout' } },
    ],
    outro: [
      { speaker: 'narrator', text: 'El Alfa cae. La manada se dispersa entre las rocas.' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  ascent_06_pincer: {
    intro: [
      { speaker: 'orc_warrior', text: '¡Rodeadlo! ¡Por los dos lados!', expression: 'angry' },
      { speaker: 'HERO', pool: 'encounter' },
    ],
  },
  ascent_07_chasm: {
    intro: [
      { speaker: 'dark_shaman', text: 'Las páginas del grimorio no son para ti.' },
      { speaker: 'HERO', byHero: { mage: 'Un grimorio en manos de un chamán. Lo rescataré de ti.' }, pool: 'encounter' },
    ],
  },
  ascent_08_warband: {
    intro: [
      { speaker: 'orc_warrior', text: '¡Romped el cristal! ¡Y luego, a por él!', expression: 'angry' },
      { speaker: 'HERO', byHero: { summoner: 'Tocad el cristal y conoceréis a mis criaturas.' }, pool: 'encounter' },
    ],
  },
  ascent_09_elder: {
    intro: [
      { speaker: 'shaman_elder', text: 'Muchos subieron esta montaña. Ninguno bajó.', expression: 'serious' },
      { speaker: 'HERO', byHero: { mage: 'Un anciano con trucos viejos. Esto será didáctico.' }, pool: 'elite' },
      { speaker: 'shaman_elder', text: 'Mis espíritus decidirán si eres digno.', expression: 'confident' },
    ],
    outro: [
      { speaker: 'shaman_elder', text: 'Los espíritus… te dejan pasar…', expression: 'wounded' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  ascent_10_colossus: {
    intro: [
      { speaker: 'narrator', text: 'La cima tiembla. Algo enorme se levanta entre las piedras.' },
      { speaker: 'stone_colossus', portraitVariant: 'threatening', text: 'PEQUEÑO. TODOS SOIS PEQUEÑOS.', expression: 'angry', hint: { emphasis: 'shout' } },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'Pesado, lento y sin una sola idea. Te desmontaré piedra a piedra.',
          summoner: 'Las piedras también se quiebran. Solo hay que esperar.',
          warrior: 'Por fin, alguien de mi tamaño. Casi.',
          shapeshifter: 'Grande y lento. Me gusta la presa que no puede correr.',
          archer: 'Cuanto más grande, más fácil de acertar.',
        },
        pool: 'boss',
      },
      { speaker: 'stone_colossus', portraitVariant: 'angry', text: 'APLASTAR.', expression: 'angry', hint: { emphasis: 'shout' } },
    ],
    outro: [
      { speaker: 'stone_colossus', portraitVariant: 'defeated', text: 'LA MONTAÑA… CAE…', expression: 'wounded' },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'Ascenso completado. Las vistas compensan la compañía.',
          summoner: 'Ahora la montaña duerme. Mejor así.',
          warrior: 'Gran combate. La cima es nuestra.',
          shapeshifter: 'La montaña ya no ruge. Ahora rujo yo.',
          archer: 'Cayó justo donde lo esperaba.',
        },
        pool: 'eliteWon',
      },
    ],
  },
  // ---------------------------------------------------------------- Reino Infernal
  w2_e01: {
    intro: [
      { speaker: 'infernal_imp', text: '¡Carne fresca en las puertas! ¡Que arda!', expression: 'amused' },
      { speaker: 'HERO', pool: 'encounter' },
    ],
  },
  w2_e02: {
    intro: [
      { speaker: 'infernal_knight', text: 'El corredor termina en la lava. Tú también.', expression: 'serious' },
      { speaker: 'HERO', byHero: { warrior: 'Empuja todo lo que quieras. No me muevo.' }, pool: 'encounter' },
    ],
  },
  w2_e03: {
    intro: [
      { speaker: 'ash_shaman', text: 'Los núcleos alimentan la forja. No te los llevarás.' },
      { speaker: 'HERO', pool: 'encounter' },
    ],
  },
  w2_e04: {
    intro: [
      { speaker: 'infernal_imp', text: '¡Por detrás! ¡Siempre por detrás!', expression: 'amused' },
      { speaker: 'HERO', byHero: { archer: 'Por delante, por detrás. Todo queda a tiro.' }, pool: 'encounter' },
    ],
  },
  w2_e05: {
    intro: [
      { speaker: 'infernal_jailer', text: 'Otra alma para mis celdas.', expression: 'confident' },
      { speaker: 'HERO', byHero: { warrior: 'Las celdas son para los que se rinden.' }, pool: 'elite' },
      { speaker: 'infernal_jailer', text: 'Todos se rinden. Al final.', expression: 'amused' },
    ],
    outro: [
      { speaker: 'infernal_jailer', text: 'Las llaves… se me caen…', expression: 'wounded' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  w2_e06: {
    intro: [
      { speaker: 'infernal_knight', text: 'Nadie cruza el río sin pagar el peaje.' },
      { speaker: 'HERO', byHero: { archer: 'Pago a distancia.', mage: 'Acepto pagar en fuego. Ah, no: eso ya lo tenéis.' }, pool: 'encounter' },
    ],
  },
  w2_e07: {
    intro: [
      { speaker: 'ash_shaman', text: 'Los hornos nunca se apagan. Tú, sí.', expression: 'confident' },
      { speaker: 'HERO', pool: 'encounter' },
    ],
  },
  w2_e08: {
    intro: [
      { speaker: 'narrator', text: 'Una cadena se tensa en la oscuridad. Algo hirviente respira.' },
      { speaker: 'HERO', byHero: { shapeshifter: 'Encadenada. Qué tristeza. Te liberaré… a mi manera.' }, pool: 'elite' },
      { speaker: 'narrator', text: 'La Bestia de Magma rompe la cadena.', hint: { emphasis: 'shout' } },
    ],
    outro: [
      { speaker: 'narrator', text: 'La bestia se enfría hasta quedar en piedra negra.' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  w2_e09: {
    intro: [
      { speaker: 'infernal_knight', text: 'Toda la guardia de la forja. Toda, por ti.', expression: 'serious' },
      { speaker: 'HERO', pool: 'elite' },
      { speaker: 'infernal_knight', text: 'El Rey te espera. No llegarás.', expression: 'angry' },
    ],
    outro: [
      { speaker: 'infernal_knight', text: 'El Rey… ya sabe que vienes…', expression: 'wounded' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  w2_e10: {
    intro: [
      { speaker: 'forge_king', portraitVariant: 'threatening', text: 'Has cruzado mi reino. Ahora te forjaré en ceniza.', expression: 'confident' },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'Mucho fuego y poca precisión. Te enseñaré la diferencia.',
          summoner: 'Tu fuego quema. Mis pactos son más antiguos.',
          warrior: 'Tu forja hizo muchas armas. Ninguna como yo.',
          shapeshifter: 'Hasta el fuego le teme a algo. Hoy, a mí.',
          archer: 'Una corona que brilla. Blanco perfecto.',
        },
        pool: 'boss',
      },
      { speaker: 'forge_king', portraitVariant: 'angry', text: '¡Arrodíllate ante el yunque!', expression: 'angry', hint: { emphasis: 'shout' } },
    ],
    outro: [
      { speaker: 'forge_king', portraitVariant: 'defeated', text: 'La forja… se apaga…', expression: 'wounded' },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'El fuego obedece a quien lo entiende. Tú solo gritabas.',
          summoner: 'Hasta la llama más vieja se apaga. Bastaba con esperar.',
          warrior: 'Buena pelea. Tu reino queda libre.',
          shapeshifter: 'Ceniza. Al final, todo vuelve a la tierra.',
          archer: 'Rey caído. Siguiente rastro.',
        },
        pool: 'eliteWon',
      },
    ],
  },
  // ---------------------------------------------------------------- El Templo del Umbral (Act III)
  w3_e05: {
    intro: [
      { speaker: 'narrator', text: 'Un engranaje gira bajo el suelo. El Guardián abre los ojos de bronce.' },
      { speaker: 'temple_guardian', text: 'Núcleo sellado. Intruso detectado.', expression: 'serious' },
      { speaker: 'HERO', byHero: { mage: 'Sellado no es lo mismo que intocable.', warrior: 'Lo abriré a golpes si hace falta.' }, pool: 'elite' },
    ],
    outro: [
      { speaker: 'narrator', text: 'El Guardián se detiene con un chasquido de piezas sueltas.' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  w3_e09: {
    intro: [
      { speaker: 'narrator', text: 'Tras el muro late algo enorme. Cada latido mueve una piedra del templo.' },
      { speaker: 'heart_warden', text: 'El Corazón no se toca. El Corazón construye.', expression: 'serious' },
      { speaker: 'HERO', byHero: { summoner: 'Todo lo que late puede calmarse.', archer: 'Un latido es un ritmo. Un ritmo es un blanco.' }, pool: 'elite' },
    ],
    outro: [
      { speaker: 'narrator', text: 'El Corazón se apaga. En lo alto, alguien deja de trabajar.' },
      { speaker: 'HERO', pool: 'eliteWon' },
    ],
  },
  w3_e10: {
    intro: [
      { speaker: 'temple_architect', text: 'Cada piedra de este templo está donde yo quiero. Tú también.', expression: 'confident' },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'Un mapa que cambia sigue siendo un mapa. Lo leeré.',
          summoner: 'Mueve tus piedras. Mis pactos no dependen del suelo.',
          warrior: 'Gira el suelo cuanto quieras. Yo sigo de pie.',
          shapeshifter: 'Cambias tu templo. Yo cambio de forma. Veamos quién se cansa antes.',
          archer: 'Si el blanco se mueve, el arco también.',
        },
        pool: 'boss',
      },
      { speaker: 'temple_architect', text: 'Entonces aprende el plano de memoria. Cambia cada ronda.', expression: 'amused', hint: { emphasis: 'shout' } },
    ],
    outro: [
      { speaker: 'temple_architect', text: 'El templo… se queda quieto…', expression: 'wounded' },
      {
        speaker: 'HERO',
        byHero: {
          mage: 'Todo diseño tiene un fallo. El tuyo era confiar en él.',
          summoner: 'Las piedras descansan. Que descansen también los pactos rotos.',
          warrior: 'Sellos rotos. Templo libre.',
          shapeshifter: 'Ahora el templo tiene una sola forma. La que dejé yo.',
          archer: 'Último blanco del templo. Abatido.',
        },
        pool: 'eliteWon',
      },
    ],
  },
};

/** Sendero del Cazador: the Archer's own story, written for that one champion. */
const ARCHER_STORY: Readonly<Record<string, EncounterDialogueDef>> = {
  hunt_01_trail: {
    intro: [
      { speaker: 'HERO', text: 'Huellas frescas. Dos orcos. Pesados… y distraídos.', expression: 'neutral', hint: { emphasis: 'aside' } },
      { speaker: 'orc_warrior', text: '¿Has oído algo?' },
      { speaker: 'HERO', text: 'No. Nunca oyen nada.', expression: 'amused', hint: { emphasis: 'aside' } },
    ],
    outro: [{ speaker: 'HERO', text: 'El rastro sigue hacia el Velo.', expression: 'serious' }],
  },
  hunt_02_trees: {
    intro: [
      { speaker: 'dark_shaman', text: 'Los árboles me protegen, cazador. No puedes verme.', expression: 'confident' },
      { speaker: 'HERO', text: 'No necesito verte. Necesito un hueco entre las ramas.', expression: 'neutral' },
    ],
  },
  hunt_03_field: {
    intro: [{ speaker: 'HERO', text: 'Campo abierto. Buena luz. Mala suerte para ellos.', expression: 'amused', hint: { emphasis: 'aside' } }],
  },
  hunt_04_thorns: {
    intro: [
      { speaker: 'narrator', text: 'Aullidos detrás. Muchos, y cada vez más cerca.' },
      { speaker: 'HERO', text: 'Que me persigan. Así sé exactamente dónde están.', expression: 'neutral' },
    ],
    outro: [{ speaker: 'HERO', text: 'Las espinas hicieron su parte.', expression: 'amused' }],
  },
  hunt_05_stalker: {
    intro: [
      { speaker: 'narrator', text: 'Algo se mueve entre los helechos. Demasiado rápido para ser un lobo.' },
      { speaker: 'veil_stalker', portraitVariant: 'threatening', text: 'Llevo tres días siguiéndote, cazador.', expression: 'confident' },
      { speaker: 'HERO', text: 'Cuatro. Te vi en el río.', expression: 'amused' },
      { speaker: 'veil_stalker', portraitVariant: 'angry', text: 'Entonces sabes que no puedes huir de mí.', expression: 'angry' },
      { speaker: 'HERO', text: 'No pensaba huir.', expression: 'confident' },
    ],
    outro: [
      { speaker: 'veil_stalker', portraitVariant: 'defeated', text: 'Me dejaste… acercarme…', expression: 'wounded' },
      { speaker: 'HERO', text: 'Hasta donde yo quise.', expression: 'neutral' },
    ],
  },
  hunt_06_gorge: {
    intro: [{ speaker: 'HERO', text: 'Tres pasos y una reliquia. Que vengan en fila.', expression: 'confident' }],
    outro: [{ speaker: 'HERO', text: 'La reliquia aguanta. Ellos, no.', expression: 'neutral' }],
  },
  hunt_07_cornered: {
    intro: [
      { speaker: 'narrator', text: 'Antorchas en todos los lados del claro.' },
      { speaker: 'orc_warrior', text: '¡Te tenemos rodeado!', expression: 'angry', hint: { emphasis: 'shout' } },
      { speaker: 'HERO', text: 'Rodeado no. Con blancos en todas direcciones.', expression: 'amused' },
    ],
  },
  hunt_08_two_prey: {
    intro: [
      { speaker: 'shaman_elder', text: 'El Velo no quiere que sigas, cazador.', expression: 'serious' },
      { speaker: 'HERO', text: 'Dos presas y una sola marca. El Velo no decide por mí.', expression: 'neutral' },
    ],
  },
  hunt_09_guardian: {
    intro: [
      { speaker: 'veil_guardian', portraitVariant: 'threatening', text: 'Ningún mortal cruza el Velo.', expression: 'serious' },
      { speaker: 'HERO', text: 'No vengo a cruzarlo. Vengo a por lo que se esconde detrás.', expression: 'neutral' },
      { speaker: 'veil_guardian', portraitVariant: 'angry', text: 'Entonces el Velo te aplastará donde estés.', expression: 'angry', hint: { emphasis: 'shout' } },
      { speaker: 'HERO', text: 'Por eso no pienso estarme quieto.', expression: 'amused' },
    ],
    outro: [
      { speaker: 'veil_guardian', portraitVariant: 'defeated', text: 'El Velo… se abre… La Bestia ya sabe que vienes.', expression: 'wounded' },
      { speaker: 'HERO', text: 'Que lo sepa. No le servirá de nada.', expression: 'confident' },
    ],
  },
  hunt_10_veil_beast: {
    intro: [
      { speaker: 'narrator', text: 'El bosque calla. Hasta el viento se detiene.' },
      { speaker: 'veil_beast', portraitVariant: 'threatening', text: 'Has seguido mis rastros demasiado lejos, cazador.', expression: 'confident' },
      { speaker: 'HERO', text: 'No seguía tus rastros. Te dejaba creer que escapabas.', expression: 'neutral' },
      { speaker: 'veil_beast', portraitVariant: 'angry', text: '¡Entonces ven a cazarme!', expression: 'angry', hint: { emphasis: 'shout' } },
      { speaker: 'HERO', text: 'Ya empecé.', expression: 'confident' },
    ],
    outro: [
      { speaker: 'veil_beast', portraitVariant: 'defeated', text: 'Entonces… eras tú… quien me cazaba…', expression: 'wounded' },
      { speaker: 'HERO', text: 'Desde el principio.', expression: 'neutral' },
    ],
  },
};

export const CAMPAIGN_DIALOGUES: Readonly<Record<string, EncounterDialogueDef>> = { ...MAIN_ACTS, ...ARCHER_STORY };
