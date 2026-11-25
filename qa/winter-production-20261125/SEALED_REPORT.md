# Winter Dominion — transición y recuperación cerradas localmente

**READY FOR CONSOLIDATED AUTHORIZATION — NO PUBLICADO.**

La solución requiere la migración aditiva0035 y una publicación preparatoria compatible. El documento autorizado por el propietario exige una única autorización consolidada antes de ejecutarlas. No se ha hecho commit, push, deploy, migración remota ni fixture productiva en esta intervención.

## Diseño seleccionado

1. Cohorte global sellada en D1 (`tactics_story_legacy_cohort`): jugador, campaña, campeón, run/encuentro exacto, versión `pre-winter-b0e18cc8`, snapshot privado, cierre irreversible y digest del proof consumido. Incluye usuarios que aún no se reconectan y no tiene caducidad.
2. Admisiones actuales (`tactics_story_admissions`): versión y encuentro elegidos exclusivamente por el servidor. Todo encuentro nuevo usa `winter-dominion-1`.
3. Fence permanente: ambos almacenamientos históricos de campaña rechazan INSERT/UPDATE/DELETE ordinarios. Sólo se admiten escrituras con un ticket de JSON exacto creado y consumido dentro de la MISMA transacción `db.batch`. El Worker anterior no sabe crear tickets; no basta con copiar un token antiguo, porque ya no existe al terminar la transacción. Se conserva el borrado de cuenta legítimo mediante cascada.
4. Fase PREPARING→SEALED→ACTIVE: todos los fences se instalan antes de capturar la cohorte. Una interrupción parcial deja el proceso cerrado; repetir0035 no amplía ni reabre la cohorte. La pausa preparatoria mejora la experiencia; la seguridad la garantiza D1, incluso con peticiones antiguas en vuelo.
5. Primer triunfo: replay legado aislado; cierre, digest, progreso y recompensas en una transacción. Se conservan la revisión de campaña y un CAS de cierre independiente, necesario incluso para una cuenta cuyo Mage sólo exista en la tabla histórica. Peticiones simultáneas retornan el resultado verificado sin repetir la recompensa.
6. Recuperación: conservar servidor/dominio/esquema Winter y sus registros; usar Pages visualmente compatible o roll-forward compatible. No restaurar el Worker anterior ni rebobinar D1.

Los timestamps sólo conservan la precedencia ya publicada entre la fila Mage histórica y su copia. NO deciden elegibilidad antes/después del corte. Ni fechas, versiones ni IDs inventados por el cliente pueden insertar miembros.

## SQL exacto y alcance

`server/migrations/0035_tactics_story_transition.sql` es el SQL completo revisado. Cuatro tablas nuevas, triggers de barrera/inmutabilidad y captura mediante SELECT de filas existentes. No ALTER/DROP/DELETE de datos históricos ni DML económico. Se protege la reejecución con IF NOT EXISTS y fase autoritativa; el fichero único será aplicado y registrado por Wrangler con un directorio de migraciones que sólo contenga0035.

La activación separada, tras comprobar Worker/Pages finales, es:

```sql
UPDATE tactics_winter_transition SET phase='ACTIVE' WHERE id=1 AND phase='SEALED';
```

El hash exacto del SQL y todos los cambios adicionales están en TRANSITION_MANIFEST.json. Los71 hashes originales coinciden tanto en el candidato original como en la copia de release; no hay solapamiento de esos71 archivos con los22 archivos adicionales/reconciliados. Los informes y pruebas QA adicionales quedan separados de los artefactos publicados.

## Resultados verificables

| Validación | Resultado | Evidencia |
|---|---|---|
| Carrera original, handler anterior real, cuerpo tardío después del sellado | PASS; escritura rechazada, sin encuentro nuevo ni elegibilidad | tests/winter-late-admission.test.ts; LATE_ADMISSION_RED.log conserva el FAIL previo |
| Offline pendiente, reintento, cierre, reutilización, versiones falsas, duplicados y concurrencia | PASS | tests/winter-campaign-transition.test.ts (18casos) |
| Peticiones antiguas concurrentes, transición/reinicio, migración repetida, tickets consumidos y cascada legítima | PASS | tests/winter-story-fence.test.ts (7casos) |
| Regresión de mundos/campaña usando el escritor protegido | PASS8/8 | tests/campaign-worlds-server.test.ts |
| Total dirigido anterior | **34PASS** | SEALED_CRITICAL_FINAL.log |
| Recuperación de ownership3/2/2 y mazos Winter, dos generaciones de cajas, snapshots, cohorte/cierre/versiones, saldos/recibos/historial sintéticos | **6PASS** | SEALED_RECOVERY_FINAL.log |
| Worker autenticado y binding D1 real de Miniflare/workerd local | PASS: dos victorias concurrentes200/200, una recompensa, cierre1, tickets0, reejecución sin reapertura | MINIFLARE_SEALED_RESULT.json / MINIFLARE_SEALED_FINAL.log |
| Worker preparatorio fijado a la base | PASS: Story503, salud200, exports DO/scheduled conservados; no se ejecutaron pagos | PREPARATION_RESULT.json / PREPARATION_TEST.log |
| TypeScript + build final | PASS | SEALED_BUILD.log |
| Lint del alcance | PASS | SEALED_LINT.log |
| Worker final dry-run | PASS; configuración exclusivamente local, no utilizable en producción | SEALED_DRY_RUN.log |
| Build de Pages compatible | PASS | SEALED_RECOVERY_BUILD.log |
| Smoke productivo del nuevo release | **NOT RUN — no desplegado** | Requiere autorización consolidada |
| Nueva auditoría visual/gameplay Winter | **NOT RUN intencionalmente**; se reutiliza certificación previa y71 hashes intactos | Original conservado |

Todas las D1, cuentas, saldo y receipts de las pruebas nuevas son locales/ficticios. No confundir Miniflare con Cloudflare QA remoto ni con producción. No se repitió la auditoría artística.

## Fallos históricos y fixtures

Se contrastaron cuatro suites complementarias contra el candidato ORIGINAL inalterado:23PASS/10FAIL. Incluyen cinco fallos cloud históricos, cuatro expectativas históricas de campeones/contratos y una fixture archivada ausente. No se ocultaron ni cambiaron sus expectativas.

La primera ejecución integrada añadió ocho fallos por escrituras SQL de fixtures incompatibles con el fence. Se corrigió sólo su preparación: los mundos usan saveCampaignStep; las pruebas de datos anteriores a la migración siembran ANTES del sellado. La prueba de compatibilidad del antiguo Worker se delimita expresamente a antes del sellado y verifica después la captura efectiva. Las expectativas no se rebajaron. Reejecución: mundos8/8; campeones3PASS/4FAIL, los mismos cuatro fallos de baseline. El caso nuevo que exige rechazar al Worker antiguo después del sellado pasa de forma independiente.

Logs: UNCHANGED_CANDIDATE_COMPARISON.log, SEALED_REGRESSION_FINAL.log (diagnóstico inicial) y SEALED_REGRESSION_ADAPTED.log (fixtures corregidas). No sumar estas ejecuciones como si fueran una única batería. Los fallos ya documentados en QA Winter anterior permanecen documentados; no se ha intentado ocultarlos.

## Producción preservada

Consulta de solo lectura: PRODUCTION_UNCHANGED_READ.json.

- Commit b0e18cc85604891e0fdedc44dab7d8447287174c.
- Pages3756b30c-5d8d-4f5c-8fb0-0184374e4b10.
- Worker deploymenta1826a72-4943-4998-9c4e-5c07b9db3259; versione825c116-9c69-4f3e-92fc-3c27984287ed.
- Live, Checkout, conciliación y compras reales1; Sandbox0; bots1; mantenimiento0; drenaje0; cron `*/5 * * * *`.
- Las cuatro tablas de transición todavía NO existen en producción.
- La autorización de tres copias y nuevo mazo QA está recibida y NO aplicada todavía. No hubo compras, canjes ni concesiones productivas.

## Pendiente único para ejecutar este procedimiento

Autorización consolidada de: Worker preparatorio compatible con pausa temporal de Historia/drenaje de nuevas partidas, migración0035, activación de su control tras artefactos finales y continuación del release Worker/Pages/smoke ya autorizado. El procedimiento exacto y la recuperación están en SEALED_PUBLICATION.md. Si el preflight detecta cambios productivos, salas incompatibles todavía activas u otra condición crítica, se detiene sin saltar controles.

No se implementó Smart Deck Builder, Forja Arcana, balance, nuevos VFX ni cambios comerciales.
