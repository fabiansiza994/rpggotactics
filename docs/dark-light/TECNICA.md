# Aprobaciones vigentes — 23 de noviembre de 2026

Estas aprobaciones sustituyen los pendientes históricos citados más abajo. La Parca: Legendaria neutral, energía 4, sacrificio 4 HP no letal, vida 12, daño 3, movimiento 2, capacidad 0 y máximo 2 copias. Conserva lealtad bajo Mundo Oscuro propio, alcance dinámico 1/2 y traición al 10%.

Rey Serpiente, Pacto del Guerrero y Llamado de la Gracia son **diseños nuevos aprobados**, no originales recuperados. Sus contratos y valores definitivos se registran en BALANCE.json. Serpiente: Invocador Legendaria 3, 9 HP/3 PM/2 daño, veneno 1×3 no acumulable y +1 daño directo contra envenenados. Pacto: Guerrero Rara 2, sacrificio de 1 PM máximo durante la batalla, nunca menos de 1; ataques directos aplican Sangrado 1×2 renovable. Gracia: Mago Infrecuente 2, una instancia elegible propia del cementerio a la mano, recuperación única por UID.

Se mantienen 15 cartas por expansión y máximo 2 copias. Todos los modos pasan a exigir 40 cartas; Historia conserva su reciclaje automático, sin reiniciar ni consumir la recuperación explícita por instancia. La transición de starters existentes requiere preservar inventarios y no autoriza grants. Cajas en borrador sin venta activa. Implementación local en curso: no equivale a PASS funcional, artístico o PvP. Sin commit, push, deploy ni cambios remotos.

---

# Contratos e incompatibilidades antes de implementar

Este documento propone decisiones para revisión. No describe funciones ya implementadas.

## Capacidades reales aprovechables

- `src/game/collection/deck-rules.ts`: `maxCopies` por carta; `unique` tiene prioridad y forzaría 1. Por eso ninguna de las treinta cartas debe marcarse Única. El régimen comercial de Ultras ya separa ese caso del presupuesto de Ultras de recompensa.
- `src/game/domain/cards/card.ts`: instancias por UID y efectos DRAW, SACRIFICE_HP, SUMMON, SHIELD, HEAL, estados y movimiento. El sacrificio actual redondea hacia abajo y no sirve tal cual para el mínimo de mitad del Escorpión.
- `src/game/domain/cards/play-card.ts`: búsqueda en mazo y recuperación de piezas de ritual desde descarte. No hay marca general de recuperación única. Eco del Altar debe pasar por el nuevo contrato global, conservando su resto de condiciones.
- `src/game/domain/cards/deck.ts` / `src/game/pvp/duel.ts`: robo, límite de mano, Deck-Out y vistas privadas ya publicados. Mill/discard/reordenar no deben llamar DRAW por conveniencia.
- `src/game/domain/summons/summons.ts`: capacidad efectiva y bonus de capacidad. No se encontró una procedencia persistente completa carta UID → unidad destruida que baste para una resurrección segura.
- `src/game/domain/statuses` y `src/game/data/rules.ts`: veneno existente de 1 al comienzo del turno del objetivo, sin acumulación y atravesando armadura, con el resto de mitigación vigente. Reutilizarlo durante cinco turnos, no crear un segundo veneno paralelo.
- `src/game/domain/transformations/transformations.ts`: cambios de forma, restauración y requisitos. La definición básica contiene armadura, no un contrato completo de daño/movilidad/mantenimiento abisal.
- `src/presentation/vfx`, `UnitView` y los atlas actuales: flujo de eventos, secuencias y recursos compartidos. Las animaciones nuevas consumen resultados confirmados; no calculan reglas ni RNG.
- `src/game/store/boxes.ts`: caja finita, selección desde existencias, dos Ultras mínimas, sin cambiar la economía existente.

## 1. Recuperación única por instancia

Propuesta: campo serializable `recoveredThisBattle` en la instancia, no en el cardId. Todo movimiento explícito desde descarte por recuperación pasa por una única función de dominio que valida UID, zona actual, propietario, elegibilidad y marca no consumida. Marca antes de mover y emite un evento único con identidad filtrada según destinatario.

La marca se conserva en mano, mazo, descarte, barajados y snapshots. No se elimina al limpiar `publicDiscard`: son propiedades distintas. Reconexión no la recalcula a partir del historial visual.

- Recuperación aleatoria: filtra primero y muestrea sin reemplazo. Menos de tres → todas las disponibles; cero → no activar Segunda Oportunidad.
- Selección: separar copias elegibles/no elegibles del mismo ID; no agruparlas como si todas fueran intercambiables. Oscurecer/desaturar solo las bloqueadas y mantener inspección, con el mensaje solicitado.
- Mano→mazo no consume esta marca. Tampoco se recupera la propia carta que está resolviéndose: todavía no pertenece al descarte.
- Interpretación para conservar Historia: el reciclaje automático con Fatiga Arcana no es una recuperación por carta; no consume ni borra la marca. La nueva restricción sigue impidiendo otra recuperación explícita de esa copia. Si se pretende limitar también el reciclaje automático, cambiaría Historia y requiere otra decisión.
- Las cartas consumidas por ritual siguen sus zonas actuales; exilio, altar y resolución no se convierten en descarte para obtener objetivos adicionales.

## 2. Invocación destruida y resurrección

Registrar UID de la carta fuente, propietario, unidad generada y motivo de retirada. Solo HP 0 habilita el caso «destruida» propuesto; retirada voluntaria, fin de duración y cartas de invocación que nunca crearon una unidad no lo habilitan.

No basta con encontrar una carta SUMMON en el descarte: hoy puede estar allí mientras su criatura sigue viva. Más Allá comprueba muerte real, capacidad, casilla y marca de recuperación en una sola resolución. Usa la misma carta original, no crea otra copia en colección o en batalla. La carta sale transitoriamente para resolver la invocación y vuelve marcada al descarte; unidad y carta son entidades distintas. No permanece simultáneamente en dos zonas de cartas.

La lista inicial de cinco criaturas normales es una propuesta conservadora, **no una exclusión original recuperada**. Las invocaciones mayores/rituales/dragones necesitan una lista editorial explícita de elegibilidad antes de cerrar esta carta.

## 3. Ruleta y pérdidas de HP

- RNG del servidor con selección uniforme de tres valores; bajo Mundo Oscuro propio, cinco valores equiprobables repartidos 1/3/1. Exactamente 20/60/20, sin aproximación mediante animación.
- Interpretación propuesta de «pierde HP»: pérdida directa de HP, no daño reducido por armadura/escudo. Sacrificios de invocación y mantenimiento también son pagos, no ataques. Esto necesita aprobación de balance; no se cambia el comportamiento de daños normales.
- Calavera prepara ambas pérdidas antes de resolver el resultado. Si ambos campeones mueren, debe ser empate real, no victoria por el orden de aplicación. El nuevo contrato necesita resultado explícito de empate y finalización/recompensas idempotentes. En Historia se conserva la prioridad existente de muerte del jugador.
- En PvP, «enemigo» es el campeón rival. En PvE se propone elegir un enemigo válido como contraparte al lanzar; debe especificarse alcance y compatibilidad del escenario, sin inventar una mano o mazo para NPC.
- El evento autoritativo contiene resultado y afectados. La presentación acelera/desacelera y se detiene en ese símbolo; cast e impacto usan la cola Premium y las barras HP, sin esperar confirmación de la animación para resolver reglas.

## 4. Sello: respuesta auténtica

El candidato incorpora un estado de activación pendiente en el mismo motor/DO. Las salas anteriores conservan su resolución inmediata mediante la versión de contenido fijada al crearlas.

**Contrato aprobado:** una oportunidad de respuesta de 5 segundos por cada activación rival, con anuncio, reserva del coste, botón «Pasar», vencimiento y resolución o negación. Se abre también cuando el rival no tiene Sello; no revela información de su mano. El servidor fija y conserva el plazo absoluto: reconectar no lo reinicia. Al vencer, continúa la resolución sin respuesta. No se habilita paso automático adicional en este contrato.

Persistir activación, respondiente, plazo y token de resolución. Reconectar no reabre ni extiende la ventana. Solo aceptar comandos permitidos durante ella; no permitir que el temporizador del turno y la respuesta resuelvan simultáneamente la carta.

- El Sello consume su energía y una carta propia elegida distinta de él. No inventa energía por responder fuera de turno.
- La carta negada no ejecuta efectos; conserva el gasto de energía anunciado y su ruta de descarte/exilio. Un sacrificio asociado al efecto de invocar no se paga si la invocación fue negada.
- Sin contranegación del Sello ni cadenas infinitas en esta versión.
- Los bots de duelos con cartas deben responder/pasar por el mismo mecanismo; los ataques de NPC no son activaciones de cartas.

## 5. Maldición Retorcida — anulación total y pérdida de HP

**Regla definitiva del usuario:** seleccionar aleatoriamente una instancia del mazo rival, mantener su identidad oculta y, cuando se intente activar, anular íntegramente su efecto original, resolver una pérdida de 5 HP al campeón que intentó usarla, consumir la maldición y enviar la carta a su zona de utilizada/anulada. No invertir ningún efecto ni crear adaptadores por categoría. Desaparece el anterior requisito de compatibilidad/inversión de familias; no se restringe la selección por tipo de carta.

La metadata de maldición pertenece al servidor y se omite incluso de la mano del dueño maldito. La instancia conserva su UID al robar, barajar o cambiar de zona. El rival y el propio dueño no reciben su identidad antes de la activación. Se revela la carta intentada al resolverse la anulación, como exige la presentación.

### Costes y zonas — política técnica propuesta

- Solo un intento de activación válido y confirmado dispara la maldición: verificar propietario, turno, instancia en mano y requisitos normales de admisión. Un paquete inválido no revela ni consume la maldición y no pierde HP. No ejecutar efectos originales para validar el intento.
- Cobrar el coste normal de energía exactamente una vez, con los descuentos aplicables según sus reglas existentes. La carta no se reembolsa por haber sido anulada. Esta política se documenta para revisión; no cambia costes de cartas ajenas.
- Ningún efecto original ocurre: no cura, roba, invoca, transforma, crea campo ni aplica sacrificios definidos como efectos de la carta. Los costes adicionales de activación diferenciados de los efectos deben quedar especificados antes de implementar; no se cobran dos veces por la interceptación.
- La pérdida de 5 HP es directa: no convertirla en daño absorbible por escudos, armadura o Inversión Arcana. Si resulta letal, finalizar por el flujo autoritativo normal una sola vez; no ejecutar después la carta original ni dejarla en mano.
- Enviar la instancia mediante el mismo criterio de zona que una carta utilizada/anulada: descarte habitual o retirada/exilio cuando sus reglas existentes lo exijan. No mandar automáticamente una Ultra Única al descarte ni crear una segunda copia. Las marcas de recuperación y otros metadatos independientes permanecen intactos.
- Propuesta conservadora contra acumulación: una maldición activa por UID; si vuelve a resultar elegida una instancia ya maldita, no se acumulan pérdidas de 5 HP. Consumir la marca no confiere inmunidad permanente a futuras maldiciones.

### Prioridad, persistencia e idempotencia

**Prioridad aprobada:** la maldición se intercepta antes de ejecutar el efecto original o abrir la ventana de respuesta. Una carta anulada por su propia maldición no abre una ventana para Sello ni produce una segunda negación. La activación de Maldición Retorcida como carta sí sigue la ventana normal de Sello antes de aplicarse.

Asociar anulación, cobro, consumo de la marca, pérdida de HP y movimiento de zona al mismo identificador de activación y transición autoritativa. Repetición, mensajes concurrentes y reconsulta devuelven el resultado ya confirmado; nunca vuelven a cobrar ni aplicar 5 HP. Reconectar no reconstruye una maldición a partir del VFX ni reinicia su consumo. No permitir comandos de turno que se intercalen dentro de esa resolución.

### Presentación Premium

Un evento específico de activación anulada por maldición debe identificar la carta intentada y su campeón afectado, sin emitir un cast exitoso que dispare la animación original. Secuencia: mostrar brevemente la carta → explosión de humo negro → desintegración → energía oscura hacia el campeón → pérdida de HP y barra animada. Usar Pixi y la cola/director Premium existentes; suprimir también la presentación Ultra original de la carta anulada. Omitir/reducir la secuencia no cambia el resultado. Eventos y ledger de presentación evitan repeticiones visuales al reconectar.

## 5A. La Parca — invocación neutral, lealtad y traición

### Contrato confirmado y propuesta de valores

Cualquier campeón puede incluirla; máximo dos copias por ID, propiedad real y sacrificio de HP. No es una marca de enemigo. Los valores son definitivos: energía 4, sacrificio de 4 HP dejando al menos 1, vida 12, daño 3, movimiento 2 y capacidad 0. Capacidad 0 permite su uso por campeones con capacidad base 0 sin cambiar sus reglas globales. No se inventa un límite de una Parca activa.

Validar energía, sacrificio, casilla y capacidad antes de una transición atómica; no pagar HP por una invocación inválida o por una carta cuyo efecto haya sido anulado. El sacrificio numérico no está aprobado. Propuesta de ciclo de vida: actúa desde la siguiente ronda y permanece hasta morir o retirarse, sujeto a revisión junto con esos valores.

### Prioridad de Mundo Oscuro propio

En cada acción autoritativa, consultar al campeón que realmente la invocó y al propietario efectivo del campo; no basta con que exista oscuridad visual.

1. **Mundo Oscuro de ese campeón activo:** lealtad completa, alcance 2. La traición nunca puede seleccionar al propietario, aunque `10 × HP actual ≤ HP máximo`. El chequeo del campo tiene prioridad sobre el umbral de HP.
2. **Sin ese campo propio:** alcance 1. Al comenzar la acción, si `10 × HP actual ≤ HP máximo`, priorizar al propietario: atacar si está en alcance y es un ataque legal; en otro caso acercarse por una ruta válida. Si el HP supera el 10%, conducta aliada normal.
3. Un campo enemigo no concede lealtad ni alcance extra. Al expirar o sustituirse el campo propio, el alcance vuelve a 1 y se retira inmediatamente la protección; en la siguiente acción se evalúa la traición. Si aparece de nuevo el campo propio antes de esa acción, se aplica el caso 1.

La sustitución se evalúa atómicamente sobre el campo resultante. Sustituir un Mundo Oscuro propio por otro Mundo Oscuro propio mantiene lealtad y alcance 2 sin un falso intervalo de traición; solo se actualiza la fuente del vínculo. Sustituirlo por Luz o por un Mundo Oscuro rival sí retira ambos beneficios.

Usar HP actual y máximo efectivos del servidor, con comparación entera, sin redondeos: 2/20 activa el umbral, 3/20 no; 1/18 lo activa y 2/18 no. Curación, expiración y reemplazo de campos actualizan el estado mostrado, pero no conceden acciones extra. El objetivo de la acción se decide una sola vez al comenzar; cualquier ataque aún no resuelto revalida el campo y su alcance para no ejecutar traición bajo campo propio ni conservar alcance 2 tras perderlo. Un ataque ya confirmado no se aplica de nuevo ni se deshace por una reconexión.

### IA y control

La Parca continúa perteneciendo al mismo dueño y conserva su facción; no se transfiere al rival. La excepción de objetivo propio se limita a su acción de traición y no modifica globalmente las relaciones aliado/enemigo. La misma lógica se usa para jugadores y bots. Las órdenes manuales de movimiento/ataque no pueden saltar la prioridad de traición ni reiniciar la acción; si existen órdenes aplicables, el servidor las rechaza o las somete al mismo plan obligatorio, nunca las usa para anularlo.

La persecución conserva presupuesto de movimiento, ocupación, obstáculos, inmovilizaciones y reglas de ruta. Alcance 2 no es un teletransporte ni permite golpear a través de paredes; usar las comprobaciones de ataque/visión del motor. Si no hay ruta o ataque legal, no inventar movimiento ni un objetivo rival alternativo para evadir la prioridad contra el propietario.

### Visual y snapshot

Sprite original encapuchado con hacha de la muerte, atlas coherente de idle, desplazamiento, ataque de alcance 1, ataque extendido de alcance 2, hit, muerte/desintegración y detección/rebelión. Sin figuras de prueba ni sprites de enemigos como arte final.

Bajo Mundo Oscuro propio: vínculo de energía oscura campo→Parca y aura aliada reconocible. Al expirar o sustituirse el campo, destruir el vínculo y volver a alcance 1 inmediatamente. Si en la siguiente evaluación se activa la traición, emitir transición de aura y rebelión breve; no reproducir rebelión solo porque desaparezca el campo si el propietario está por encima del umbral. Recuperar vida por encima del 10% restablece la conducta aliada en la siguiente acción y limpia el aviso correspondiente.

El snapshot conserva propietario, unidad, acción/consumo y campo efectivo. La reconexión reconstruye vínculo, aura y alcance desde el estado autoritativo; no reaplica sacrificio, ataques ni animaciones de rebelión ya consumidas. Los recursos se limpian al morir, retirar la unidad, sustituir el campo o salir del combate. Solo se reconstruye persistencia visual, no decisiones a partir de partículas.

### QA requerido antes de implementar como aprobado

- Por encima, exactamente y por debajo del 10%, con HP máximo distinto y curación posterior.
- Campo propio activo con HP crítico: permanece aliada y nunca ataca a su dueño; alcance 2.
- Campo rival, expiración y sustitución: pierde beneficio inmediatamente y reevalúa en la próxima acción.
- Reactivar campo propio antes del siguiente ataque impide traición; curación por encima del umbral restaura la conducta aliada.
- Obstáculos, casillas ocupadas, raíces, alcance 1/2 y persecución sin ruta.
- Órdenes manipuladas, acción repetida, snapshots y reconexión antes/después del cambio de campo o ataque.
- Dos clientes ven el mismo vínculo, cambio de aura, objetivo y HP; bots usan el mismo contrato.
- Sacrificio y ataque únicos; dos copias legales según ownership; pruebas de recuperación sin duplicación de instancias.

## 6. Campos y mantenimiento

Propuesta para revisión: Luz y Oscuridad ocupan un slot compartido entre esos dos campos; el nuevo sustituye al anterior sin acumular bonificaciones. Solo el propietario del campo recibe sus beneficios. No se cambia la duración ni se elimina Mundo Gélido u otros campos existentes por inferencia.

Seis turnos propios contando el de lanzamiento; expira antes del mantenimiento al comenzar el séptimo. El deterioro del Escorpión y el pago abisal consultan el campo efectivo en ese instante. No se escriben bonificaciones acumulativas cada turno ni se reaplican al reconectar.

Mundo de Luz: lista blanca HEAL y SHIELD de cartas propias; máximo +1 por objetivo/activación para cada una de esas dos magnitudes. No aumenta estadísticas de criaturas, recuperaciones, robos, duraciones, capacidad, energía ni PM. No aplica a regeneración pasiva por el mero hecho de ser positiva.

## 7. Compatibilidad PvE y privacidad

Los enemigos normales de Historia no tienen mano/mazo ni activaciones de cartas. Mano de las Sombras, Sepultura, Tributo, Maldición y Sello no tienen un objetivo de recursos equivalente en esos escenarios.

Propuesta conservadora: señalarlas como «requiere rival con cartas» y rechazar la activación sin coste en ese contexto. Funcionan en PvP y bots que usan mazo. No dotar silenciosamente de un nuevo mazo a los NPC de Historia ni hacer que pierdan por Deck-Out. Esta limitación debe revisarse como decisión de producto antes de cerrar las dos expansiones.

Los descartes rivales privados siguen sin mostrar identidades; una nueva carta no hace público todo el cementerio. Las elecciones de orden, mano y recuperación se envían únicamente al jugador autorizado. Los totales sí se sincronizan.

## 8. Plan histórico de VFX y publicación (conservado como procedencia)

Reutilizar director/colas Premium, Pixi, atlas, cambios de HP y eventos reales. Recursos compartidos precargados, secuencias de unidad coherentes, limpieza al morir/cerrar combate y reconstrucción persistente desde snapshot. No sustituirlos por CSS. CSS solo para legibilidad/selección de cartas no elegibles.

Cada carta: objetivo temático → cast → impacto → feedback. Residuos únicamente si son coherentes con las reglas; no inventar terreno con efecto de combate por decorar. Calavera, Escorpión, forma abisal, maldición, campos y recuperaciones tienen tratamiento específico. Las comunes usan secuencias breves, no cinemáticas largas obligatorias.

No hay cambios de código en esta entrega. Al aprobar contratos: núcleo de recuperación → Luz → Oscuridad/respuestas → arte/atlas → integración/QA. Pruebas de UID, concurrencia, ventanas y privacidad antes de dar un PASS funcional; secuencias completas antes de dar un PASS visual. PvP real de dos cuentas y bots; nunca pérdidas de RP en hacker994.

El futuro release necesitará versión de contenido y coordinación de partidas/rollback por los nuevos estados. No puede reutilizar una configuración histórica que apague PayPal. No se ha creado ni aplicado una migración, desplegado QA/producción ni modificado D1 remota.

## Estado histórico de implementación local (superado por el cierre de Fase 8)

Las aprobaciones de diseño están cerradas. Se comenzó implementación real en el motor existente: recuperación por instancia y Gracia/Eco, recuperación aleatoria, Inspiración Divina, Serpiente, Pacto, campos Luz/Oscuridad, Parca y anulación de Maldición. No se declaran completas las treinta cartas ni su presentación artística.

Decisiones conservadoras: Serpiente usa capacidad 1 y armadura 0. Pacto rechaza una segunda activación mientras ya está activo, sin restringir sus dos copias en el mazo. La Parca no tiene límite artificial de unidades activas y usa la acción automática existente de invocaciones. Mundo de Luz/Oscuro comparten ranura entre sí; no sustituyen Mundo Gélido.

El usuario autorizó preparar starters de 40 únicamente para cuentas nuevas. El constructor nuevo debe ser separado de los mínimos históricos usados al cargar colecciones; cambiar esos mínimos concedería copias accidentalmente. No se modifica ningún inventario existente.

Pendientes históricos, ya superados por la evidencia de Fase 8 y la aprobación final: completar cartas, ventana real de respuesta, arte/atlas originales, VFX confirmados, integración comercial solo en borrador, UI de todas las elecciones y QA PvP autenticado. Las simulaciones de motor no sustituyen ese QA ni una aprobación visual.


## Aprobación final23/11/2026
Hada5turnos propios (incluye lanzamiento). Protección y Vigilia serializan expiresAtCasterTurnStart=ID del lanzador; no decrementan al finalizar turno, se retiran al inicio del siguiente turno de su fuente incluso sobre otro aliado, antes del daño periódico. Consumo y mitigación intactos. Dos cajasAVAILABLE con50Cristales/4cartas/80slots, tres gratuitos y reinicio existente. Sin migraciones nuevas. Promo privada futura16000, cuenta restringida, máximo global1; no generada.


## Espíritu de la Redención — contrato adicional aprobado
Comando REDEMPTION_SUPPORT compartido por replay, PvE y DO PvP. Valida turno/propietario, readyRound, lastActedRound, estado de acción, aliado distinto del Espíritu, radio Manhattan2 y visión (interpretación conservadora), HP/carga y ausencia de escudo antes de modificar nada. No gasta energía/PM. Cancelar/Esperar son estado de presentación: sin comando ni consumo. Se integra con selección/previsualización existente del tablero y confirmación táctil. El panel enumera beneficio y sacrificio por aliado antes de seleccionar. No hay ventana obligatoria.
Curación: base=min(2,HPdelEspíritu,HPfaltante), sacrificio=base; Mundo de Luz propio añade1 al beneficio, limitado por HPmáximo, sin cobrar bonus. Con1HP puede entregar base1 (+1 si hay mundo y falta vida). No se cura a sí mismo ni recibe curaciones externas por healUnit. Escudo requiere2HP y objetivo sin escudo, concede2/3 y usa la expiración normal al inicio del turno propietario. Beneficio antes de sacrificio directo no mitigado y derrota al llegar0. lastActedRound serializado limita una acción por turno; la idempotencia de red existente evita reenvíos. Se excluye del AI automático de invocaciones; no persigue ni ataca.
La fuente no se añade a la whitelist existente de resurrección. No hay nuevo mecanismo de recuperación ni bucles. Un nuevo ejemplar puede invocarse después de morir el anterior, respetando cartas/energía/límite1.
Atlas propio6×4 celdas256,1536×1024conalpha: idle0–5, aparición6–11, apoyo12–17, golpe18–20, muerte21–23. Curar/Proteger usan evento confirmado, trayectoria dorada y HP/escudo existentes. Sacrificio final añade dispersión luminosa al ciclo de muerte. Luminosidad por HP sin desplazar acumulativamente la figura.
CajaLuz16cartas:80slots41/29/6/2/2; Espíritu2, BendiciónMenor7, EscudoAlba8, restoidéntico. Generador conserva la distribución previa como base y aplica exclusivamente esos tres cambios. Oscuridad y seis cajas previas intactas. Sin migraciones.
