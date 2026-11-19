# Procedimiento preparado — no ejecutado

1. Base fab307dc0d7f6257a13aa9a5ac02b551c6d6fa94. Verificar de nuevo deployments/bindings reales al recibir autorización; no usar directamente server/wrangler.toml (plantilla histórica de mantenimiento1).
2. Revisar el manifiesto actualizado y trabajar únicamente con archivos PayPal del worktree aislado. Mantener los demás candidatos y cambios de combate intactos.
3. production-off.prepared.json contiene un snapshot de variables no secretas del Worker productivo observado, con Sandbox/Live/checkout/reconciliación/REAL_MONEY en0 y cron preparado. Conserva bots1, mantenimiento0 y drenaje0. Volver a contrastar bindings y secretos al publicar; no contiene credenciales. Añadir VITE_PAYPAL_LIVE_ENABLED=0 y VITE_PAYPAL_SANDBOX_ENABLED=0 al build.
4. Obtener checkpoint Time Travel D1 antes de DDL. Revisar solo0034, usar directorio aislado only-0034 y comprobar que no se aplicó ya. Migración aditiva:2 tablas,4 índices; no cambia0033 ni wallets/ledger, ni otras tablas. No ejecutar otras migraciones. QA ya la aplicó en D1d0b148c2-c62b-47f7-b0ac-fe299940f6f2. Producción no.
5. Con autorización expresa futura: commit/push del alcance, aplicar únicamente0034 productiva, publicar Worker y Pages compatibles con todos los pagos OFF. Comparar esquema, economía y bindings antes/después. No configurar secretos mediante mecanismos que desplieguen accidentalmente una versión sin revisión.
6. Smoke sin compras: catálogo Live available:false, órdenes/capturas/webhook deshabilitados, autenticación, tienda/inventario/nav y combate. Ningún saldo, grant, receipt o compra manual.
7. Registrar deployments y rollback de Pages/Worker. Antes de aceptar pagos, el baseline fab307d es recuperación compatible dejando0034 aditiva. Después de aceptar pagos, conservar backend compatible de conciliación y cerrar únicamente nuevas ventas; nunca borrar tablas ni revertir wallets.

## Acciones humanas mínimas antes de activar

- Iniciar sesión en PayPal Developer con la cuenta comercial del titular. Completar personalmente identidad, CAPTCHA/2FA y cualquier aceptación contractual; no compartir secretos.
- Confirmar país, estado de verificación y recepción internacional USD en la cuenta Business. Crear/revisar la app REST RPG-GO Tactics Live sin confundir creación de app con verificación comercial.
- Obtener aprobación comercial de PayPal aplicable a moneda virtual: la política CO menciona dinero virtual en juegos entre actividades de aprobación previa. Consultar al equipo de ventas/compliance de PayPal y conservar confirmación para este producto. No se ha enviado ninguna solicitud en nombre del usuario.
- Provisionar de forma segura los secretos PAYPAL_LIVE_CLIENT_ID/CLIENT_SECRET/WEBHOOK_ID/MERCHANT_ID (backend exclusivamente); confirmar merchant con la cuenta autorizada. OAuth real aún no realizado por falta de sesión/credenciales autorizadas disponibles.
- Registrar webhook HTTPS https://rpggo-tactics-api.fabiansiza994.workers.dev/api/tactics/store/paypal/live/webhook en la misma app Live. Eventos: PAYMENT.CAPTURE.COMPLETED/PENDING/DECLINED, PAYMENT.CAPTURE.REFUNDED/REVERSED, CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED. La URL productiva actual todavía no sirve el adaptador Live local. Registrar y certificar tras publicación OFF autorizada, sin desactivar controles para aceptar mocks.
- Habilitar procesador, conciliación y checkout solo mediante aprobación posterior y controles múltiples documentados en ACTIVATION.md. La primera compra autorizada de USD4.99 debe producir exactamente350Cristales, un ledger, receipt/order persistente y webhook verificable; refresh/reconsulta no duplica.

## Evidencia vs simulación

La prueba de OAuth puede hacerse sin comprar una vez disponibles credenciales. Los mocks locales no prueban autenticidad Live. El simulador oficial de webhooks no es una transacción real y sus eventos no pueden verificarse con el postback verify-webhook-signature que utiliza este motor; no debilitar el verificador para aceptarlos. Una captura y entrega auténticas se certificarán con la primera compra controlada, o con un evento auténtico previo de la misma app si existe y el titular autoriza su reenvío.
