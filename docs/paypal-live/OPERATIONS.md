# Operación PayPal Live

El mismo Worker dispone de scheduled(), sin nuevos servicios. La configuración preparada incluye cron cada5min, lotes de10, reintentos exponenciales hasta1h. PAYPAL_LIVE_RECONCILIATION_ENABLED=0 por defecto: no consulta DB ni PayPal. Activarlo solo con credenciales Live verificadas y autorización posterior; no necesita activar checkout. No crea ni captura órdenes: solo GET al proveedor y reconciliación autoritativa con ledger único.

## Qué revisar

Cloudflare Observability: filtrar event=paypal-live-reconciliation. Se emiten únicamente checked/failed/review y operations.review/retryAttention/unlinkedEvents. No se registran cuerpos, cabeceras, tokens, clientes ni secretos. failed>0 señala fallo de esta ejecución; retryAttention>0 significa tres o más fallos persistentes. El estado persistente permite reintentar aunque el Worker se reinicie. No se creó una integración de correo/alertas externa.

Consulta operativa de solo lectura, mediante acceso administrativo existente de Cloudflare/D1, nunca un endpoint público:

```sql
SELECT id,status,created_at,last_checked_at,next_check_at,reconcile_attempts,review_reason
FROM tactics_paypal_live_orders
WHERE status='REVIEW' OR reconcile_attempts>=3
ORDER BY created_at;
```

Eventos sin orden vinculada: comparar paypal_order_id/capture_id de tactics_paypal_live_events con tactics_paypal_live_orders. La tarea reporta el número de eventos huérfanos para que una notificación no quede ignorada silenciosamente. No relacionar ni inventar IDs manualmente.

## Procedimiento REVIEW

1. Abrir un caso interno con el ID local, hora, estado y motivo; no compartir credenciales ni datos de pagador en evidencias.
2. Consultar el historial de eventos, order/capture ID y transacción paypal-live:<id> en el ledger mediante herramientas administrativas autorizadas de solo lectura.
3. Contrastar en la cuenta PayPal autorizada el merchant, USD/importe y captura final, además de reembolso parcial/completo, reverso o disputa. REVIEW no equivale necesariamente a fraude ni a reembolso ejecutado.
4. CREATE_UNLINKED: respuesta de creación perdida o proveedor inaccesible. No crear una segunda orden ni adivinar un capture ID. Buscar el intento idempotente y contrastarlo con PayPal; escalar al responsable. No acreditar por un screenshot o callback.
5. LEDGER_PROVIDER_MISMATCH: detener ventas si puede afectar integridad; preservar todas las evidencias. Nunca insertar otro grant para corregir una discrepancia sin resolución técnica y autorización explícita.
6. Reembolso/disputa: responder por el flujo autorizado de PayPal. No existe reembolso automático ni débito automático de Cristales; no modificar saldos ni retirar ownership. La decisión comercial y cualquier futura compensación requieren aprobación del titular.
7. Resolver el caso en el registro operativo. No resetear REVIEW mediante SQL manual. Una liberación de fondos o reparación del estado necesita un procedimiento específico validado/autorizado; este release no añade una acción administrativa de modificación financiera.

Un fallo de red se reintenta automáticamente y no convierte el pago en declinado ni lo elimina. Los pagos ya acreditados se revisan de nuevo cada24h; no se acreditan de nuevo. No se garantiza descubrir una disputa no entregada por PayPal solo con el Order GET: webhooks y revisión del portal comercial son parte obligatoria de operación.

## Cierre de ventas y recuperación

Poner PAYPAL_LIVE_CHECKOUT_ENABLED=0 y REAL_MONEY_PURCHASES_ENABLED=0, ocultar UI. Mantener procesamiento y conciliación compatible para capturas ya aceptadas. No revertir a fab307d mientras existan órdenes Live sin resolver, porque esa versión no procesa el namespace Live. Conservar las tablas0034 y el ledger; rollback de aplicación no es rollback de datos.
