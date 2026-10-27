import type { VoiceDef } from '../../dialogue/dialogue';

/**
 * Character voice bible (see docs/dialogue/VOICE_BIBLE.md). Every new line for a champion must
 * fit its `traits` and `style` and avoid its `avoid` list. Lines stay short: one or two sentences.
 * The pools feed the main acts and PvP fallbacks; authored scenes always win over them.
 */
export const VOICES: Readonly<Record<string, VoiceDef>> = {
  mage: {
    heroId: 'mage',
    traits: ['orgulloso', 'intelectual', 'seguro de su dominio arcano', 'sarcasmo elegante', 'ligeramente arrogante'],
    style: 'Frases pulidas, vocabulario culto, ironía seca. Trata la batalla como una lección que el rival no pidió.',
    avoid: ['gritos', 'insultos burdos', 'parodia de mago despistado'],
    defaultExpression: 'confident',
    greeting: ['Veamos si sabes algo que yo no sepa. Lo dudo.', 'Toma asiento. La lección es breve.'],
    victory: ['Lección terminada. Puedes tomar notas.', 'Previsible, de principio a fin.', 'El poder sin método es solo ruido.'],
    defeat: ['Un error de cálculo. No se repetirá.', 'Interesante… Lo estudiaré.'],
    responses: {
      encounter: ['Una amenaza mediocre. Acabemos pronto.', 'He leído tratados más peligrosos que esto.', 'Apártate, o forma parte de la demostración.'],
      elite: ['Por fin, alguien que merece un hechizo completo.', 'Tu reputación te precede. Mi paciencia, no.'],
      boss: ['Grande, ruidoso y sin teoría. Lo de siempre.'],
      won: ['Exactamente como lo había previsto.', 'Siguiente capítulo.', 'Ni siquiera tuve que improvisar.'],
      eliteWon: ['Respetable. Pero insuficiente.', 'Anotado: fuerte, no brillante.'],
    },
  },
  summoner: {
    heroId: 'summoner',
    traits: ['sereno', 'oscuro', 'paciente', 'habla de pactos y criaturas', 'inquietante sin melodrama'],
    style: 'Voz baja y tranquila. Habla en plural de sus criaturas, de pactos y de esperar. Nunca levanta la voz.',
    avoid: ['risas malvadas', 'melodrama', 'gore'],
    defaultExpression: 'serious',
    greeting: ['Mis criaturas ya conocen tu nombre.', 'Hay un pacto esperando a que caigas.'],
    victory: ['Los pactos se cumplen. Siempre.', 'Descansa. Ellos ya no tienen hambre.', 'La paciencia nunca pierde.'],
    defeat: ['El pacto sigue en pie. Volveremos.', 'Hoy no. Pero esperan.'],
    responses: {
      encounter: ['No vengo solo. Nunca vengo solo.', 'Ellos tienen hambre. Yo tengo tiempo.', 'Avanzad. Despacio.'],
      elite: ['Tu fuerza sería un buen pacto. Lástima.', 'Algo antiguo despierta en ti. En mí, también.'],
      boss: ['Todo lo grande cae igual. Solo tarda más.'],
      won: ['Silencio otra vez. Mejor.', 'Ni una criatura perdida que no pudiera volver.', 'Seguimos.'],
      eliteWon: ['Tu poder vuelve a la tierra. Ahí lo esperan.', 'Un buen rival. Lo recordarán.'],
    },
  },
  warrior: {
    heroId: 'warrior',
    traits: ['directo', 'honorable', 'desafiante', 'pragmático', 'disfruta rivales fuertes'],
    style: 'Frases cortas y de frente. Respeta al rival digno, desprecia al que se esconde. Habla de acero y de pie.',
    avoid: ['crueldad', 'fanfarronería vacía', 'humillar al caído'],
    defaultExpression: 'confident',
    greeting: ['Escudo arriba. Que empiece.', 'Pelea de frente y lo recordaré.'],
    victory: ['Buen combate. Levántate cuando puedas.', 'De pie, hasta el final. Así se hace.', 'Acero contra acero. Gané yo.'],
    defeat: ['Bien golpeado. La próxima es mía.', 'Me levantaré. Siempre lo hago.'],
    responses: {
      encounter: ['Entonces ven y detenme.', 'Uno a uno o todos juntos. Me da igual.', 'Despejad el camino.'],
      elite: ['Por fin un rival que vale la pena.', 'Mírame a los ojos cuando golpees.'],
      boss: ['Cuanto más grande, más fuerte suena al caer.'],
      won: ['Siguiente.', 'Ni un paso atrás.', 'Buen calentamiento.'],
      eliteWon: ['Peleaste bien. Descansa.', 'Eso sí fue un combate.'],
    },
  },
  shapeshifter: {
    heroId: 'shapeshifter',
    traits: ['instintivo', 'salvaje', 'provocador', 'habla de caza, fuerza, forma y naturaleza'],
    style: 'Frases con olor a bosque: presa, colmillo, manada, cambio. Provoca con una sonrisa; nunca se queda quieto.',
    avoid: ['gruñidos sin palabras', 'gore', 'crueldad gratuita'],
    defaultExpression: 'amused',
    greeting: ['Huelo tu miedo desde aquí.', '¿Qué forma tendré cuando me alcances? Adivina.'],
    victory: ['La naturaleza no perdona a los lentos.', 'Buena caza.', 'Cambiar es sobrevivir. Tú no cambiaste.'],
    defeat: ['La manada aprende de cada herida.', 'Volveré con otra piel.'],
    responses: {
      encounter: ['Corred. Me gusta cuando corren.', 'Esto huele a presa fácil.', 'Mis garras ya están listas.'],
      elite: ['Por fin, una bestia de verdad.', 'Veamos quién es el depredador aquí.'],
      boss: ['Todo lo grande tiene un punto blando. Lo encontraré.'],
      won: ['Demasiado fácil.', 'La caza sigue.', 'Ni siquiera tuve que cambiar de forma… casi.'],
      eliteWon: ['Fuiste una buena presa.', 'El bosque se queda con tu fuerza.'],
    },
  },
  archer: {
    heroId: 'archer',
    traits: ['calmado', 'observador', 'confiado', 'seco y burlón', 'frases cortas', 'siempre calculó antes'],
    style: 'Muy breve. Constata hechos en vez de amenazar. Da a entender que ya vio el movimiento del rival.',
    avoid: ['discursos', 'gritos', 'explicar el chiste'],
    defaultExpression: 'neutral',
    greeting: ['Ya te tengo a tiro.', 'Quédate ahí. Así es más fácil.'],
    victory: ['Lo vi venir. Tú no.', 'Una flecha. Bastaba.', 'Distancia, paciencia, fin.'],
    defeat: ['Fallé una vez. No suelo fallar dos.', 'Bien jugado. Anotado.'],
    responses: {
      encounter: ['Ya cometiste el error de mostrarte.', 'Desde aquí se ve todo.', 'Muévete. No cambiará nada.'],
      elite: ['Rápido. Pero no lo bastante.', 'Te estuve observando. Tienes un hábito.'],
      boss: ['Cuanto más grande, más fácil de acertar.'],
      won: ['Limpio.', 'Ni se acercaron.', 'Siguiente rastro.'],
      eliteWon: ['Buena presa.', 'Te vi dudar. Eso bastó.'],
    },
  },
};
