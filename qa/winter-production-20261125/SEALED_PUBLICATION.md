# Publicación consolidada propuesta — Winter Dominion

Estado: preparada LOCALMENTE. NO ejecutar sin la autorización consolidada de migración0035 y Worker preparatorio. No usar master ni modificar ramas existentes.

## Artefactos y fuente

- Base verificada: b0e18cc85604891e0fdedc44dab7d8447287174c.
- Candidato: `output/winter-dominion-release-20261125`.
- Original inalterado: `output/winter-dominion-20261124`;71/71 hashes también coinciden dentro del candidato de release.
- Incremento: `TRANSITION_MANIFEST.json`. Sólo esos archivos adicionales/reconciliados y los71 originales; excluir credenciales, sesiones, cuentas locales, vídeos, logs, bundles QA y configuraciones de prueba.
- Reconstruir desde el commit exacto en una rama nueva `codex/winter-dominion-sealed-20261125`. El workspace principal y candidatos ajenos permanecen intactos. No force-push.
- Worker preparatorio: `node tools/build-winter-campaign-legacy.mjs --preparation` produce `qa/winter-production-20261125/preparation-worker.mjs` desde la base Git fijada. Mantiene motor/DO/cron anteriores; pausa únicamente POST de Historia con503 para conservar proofs durante la actualización. La barrera de D1 aporta la garantía, no la pausa ni una espera fija.
- Worker final: reconstruir `server/src/index.ts`; nunca reutilizar bundles anteriores al último guard de cierre/cohorte.
- Pages final: build desde el mismo commit, con flags públicos efectivos Live ON, Sandbox OFF, Ultra global. No usar `.env.production` histórico sin sobrescribir sus valores públicos revisados.
- Recuperación: `output/winter-dominion-compatible-recovery-20261125`, mismo servidor/dominio/migración/registro/current content; degradación visual compatible exclusivamente.

## Configuración efectiva y respaldo

Releer versiones, rutas, bindings, secretos por nombre (nunca valores), compatibilidad y cron del Worker productivo; proyecto/branch de Pages y control Ultra. Comparar contra PRODUCTION_UNCHANGED_READ.json. Si hay cambios imprevistos, detenerse antes de cualquier escritura.

Referencias anteriores verificadas:
- Pages3756b30c-5d8d-4f5c-8fb0-0184374e4b10.
- Worker deploymenta1826a72-4943-4998-9c4e-5c07b9db3259; versione825c116-9c69-4f3e-92fc-3c27984287ed.
- Cron `*/5 * * * *`.

Generar una configuración operativa EXCLUSIVAMENTE a partir de esos bindings/valores efectivos. Conservar todos los secretos existentes, Merchant ID, URLs de pagos, rutas, scheduled, DB, PVP_ROOMS y SOCIAL_HUBS. Mantener PayPal Live/Checkout/conciliación/compras reales1, Sandbox0, bots1, mantenimiento0. Sólo el drenaje cambia temporalmente1 y vuelve0. `worker-dry.json` es exclusivamente local, con pagos OFF y sin DB productiva; NUNCA usarlo para un despliegue real.

Antes de DDL, obtener bookmark Time Travel y un respaldo de recuperación revisado; guardar sólo referencias no sensibles en evidencias. No exportar credenciales ni tablas de autenticación al repositorio. Time Travel es respaldo de emergencia, NO el rollback normal: restaurarlo destruiría cambios posteriores. No ejecutarlo automáticamente.

## Orden exacto

1. Revalidar manifiestos y artefactos, pruebas afectadas, producción efectiva y rama. Crear commit/push del alcance revisado. Reconstruir preparación, Worker final, Pages final y Pages compatible desde ese commit, verificando hashes.
2. Publicar al100% el Worker preparatorio fijado a b0e18, con configuración efectiva y CONTENT_RELEASE_DRAIN=1. Bots permanecen1 y mantenimiento0; las salas existentes conservan su motor y pueden terminar/reconectar. Confirmar salud, autenticación, rutas de pagos y cron, sin iniciar órdenes ni cobros. StoryPOST503 es intencional y preserva el proof local.
3. Drenar las salas incompatibles hasta demostrar mediante el registro autoritativo y el estado de DO que ninguna partida anterior permanece activa. No interrumpirlas, borrar salas ni usar un tiempo de espera como prueba. Si no finalizan, conservar el preparatorio y detener el avance; no aplicar un motor incompatible. Verificar también ausencia de una escaramuza anterior válida pendiente antes del cambio global de reglas.
4. Aplicar EXCLUSIVAMENTE0035, con su SHA certificado. Preparar un directorio de migraciones que contenga únicamente ese archivo y una copia temporal de la configuración efectiva cuyo `migrations_dir` apunte a ese directorio. No modificar el binding de DB ni ejecutar archivos0001–0034.

Comandos previstos desde el checkout de release (la configuración efectiva se generará y comprobará tras autorización):

```sh
mkdir -p qa/winter-production-20261125/single-0035
cp server/migrations/0035_tactics_story_transition.sql qa/winter-production-20261125/single-0035/
server/node_modules/.bin/wrangler d1 migrations list rpggo-auth --remote --config "$WINTER_EFFECTIVE_CONFIG"
# Continuar sólo si el único archivo pendiente mostrado es0035 y su hash coincide.
server/node_modules/.bin/wrangler d1 migrations apply rpggo-auth --remote --config "$WINTER_EFFECTIVE_CONFIG"
```

La configuración de ese paso tiene `migrations_dir` absoluto a `single-0035`; no usar `server/wrangler.toml`. Wrangler registra la ejecución en su historial habitual. Si0035 ya está aplicada, verificar esquema, triggers y estado y no volver a capturar una cohorte.

5. Verificar faseSEALED, los seis triggers de escritura de ambas tablas y las restricciones de cohorte; comparar membresía contra las filas efectivas capturadas, comprobar admisiones y tickets0. No activar si faltan entradas o hay incoherencias. El SQL exacto está en `server/migrations/0035_tactics_story_transition.sql`. Una ejecución incompleta queda cerrada y se reanuda repitiendo ese mismo archivo, sin alterar originales ni inferir miembros por fecha.
6. Desplegar Worker final al100%, todavía SEALED y drain1; luego Pages final. No crear nuevas clases DO, bindings, rutas ni secretos. Verificar hash/artifact, contentRelease y cliente correcto antes de abrir Story. Los clientes anteriores reciben la exigencia normal de actualizar; las notificaciones públicas de pago y la conciliación no se deshabilitan.
7. Activar el registro mediante ESTA única sentencia de control, separada de la migración y sólo después de verificar los artefactos finales:

```sql
UPDATE tactics_winter_transition SET phase='ACTIVE' WHERE id=1 AND phase='SEALED';
```

Leer de nuevo y exigir ACTIVE. Esta sentencia no cambia saldos, inventarios, rewards ni contratos; sólo abre escrituras Story del motor nuevo. Ningún valor enviado por el cliente interviene. Reabrir matchmaking con CONTENT_RELEASE_DRAIN=0 preservando el mismo Worker/código/configuración efectiva. Volver a confirmar bots1/mantenimiento0/drenaje0.

8. Smoke autenticado con QA_a/b: admisión nueva Winter, reintento legado si existe un encuentro elegible, sincronización/reconexión, normalidad de PvP/bots, interfaz y VFX Winter, editor/40cartas, caja actual y nuevas generaciones por lectura, Mercado, disponibilidad/configuración PayPal sin órdenes/capturas/canjes. Las tres copias QA y nuevo mazo ya autorizados son una excepción separada: verificar ownership y añadir sólo las ausentes, exactamente una de cada carta; crear un mazo nuevo legal por API sin tocar los anteriores. No comprar ni generar códigos.
9. Revisar excepciones,500, assets, DO, PayPal/bots/cron, datos previos y movimientos legítimos. Un intento tardío rechazado por el handler antiguo produce su500 genérico y debe identificarse como rechazo esperado de la barrera, no ignorar otros500. Registrar IDs finales y resultados reales; no declarar release PASS con smoke pendiente.

## Recuperación compatible

- Antes de0035: puede restaurarse el Worker/Pages baseline tras proteger partidas; todavía no existe la barrera nueva.
- Desde0035: NUNCA restaurar Worker anterior, quitar triggers, reabrir la cohorte o rebobinar D1.
- Si falla el frontend: publicar Pages compatible, conservando Worker Winter y sus datos/versiones. El servidor no cambia reglas.
- Si falla la transición del servidor: pausar Story con phaseSEALED y nuevas partidas con drain1, preservar resultados/ledgers; desplegar un Worker compatible revisado desde la misma fuente Winter. No usar el Worker anterior sobre salas/datos nuevos. Drenar antes de cualquier cambio de reglas del motor. La copia compatible conserva exactamente el servidor actual; es recuperación visual, no una promesa de reparar cualquier defecto de backend.
- Mantener PayPal, webhooks, conciliación y economía operativos con sus flags efectivos. Si no hay recuperación compatible certificada, mantener el área afectada cerrada y reportar el bloqueo; nunca improvisar cambios de datos.

## Siguiente transición

Las nuevas admisiones ya guardan versión autoritativa. Reutilizar el fence; revisar una transición explícita si cambian reglas incompatibles, preservando sólo el motor inmediatamente necesario. No cambiar simplemente la versión de las partidas abiertas ni volver a inferirla por updated_at. No hay expiración de la cohorte actual.

Referencias oficiales: [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [migraciones](https://developers.cloudflare.com/d1/reference/migrations/), [Time Travel y carácter destructivo de restore](https://developers.cloudflare.com/d1/reference/time-travel/).
