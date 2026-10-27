/** Canonical landing routes. These documents remain editorial drafts pending approval. */
export const LEGAL_DRAFT_URLS = {
  terms: 'https://rpg-go-tactics.com/terms',
  privacy: 'https://rpg-go-tactics.com/privacy',
  refunds: 'https://rpg-go-tactics.com/refunds',
  delivery: 'https://rpg-go-tactics.com/delivery',
} as const;

/** Editorial documents: approval and effective date are deliberately pending. */
export const legalPages: Record<string, { title: string; sections: [string, string][] }> = {
  "terms": {
    "title": "Términos de uso y condiciones de compra",
    "sections": [
      [
        "Responsable y alcance",
        "RPG GO Tactics es un videojuego de estrategia táctica con cartas, campeones y modalidades de juego, comercializado en Colombia por Fabian Mauricio Siza Paladines, persona natural. Sitio oficial: https://rpg-go-tactics.com/. La identificación tributaria, dirección y datos comerciales adicionales están pendientes de verificación y aprobación."
      ],
      [
        "Aceptación y documentos relacionados",
        "Estos términos regulan cuentas, uso del juego y productos ofrecidos. Solo compradores de 18 años o más pueden realizar compras con dinero real. Antes de cada pedido deben declarar mayoría de edad y aceptar las condiciones correspondientes. No se solicita declaración de edad para iniciar sesión o jugar; esta restricción comercial no modifica el acceso al juego, las recompensas ni la progresión. La simple navegación no sustituye una autorización de datos ni una aceptación de compra exigible. Antes de habilitar cobros reales debe aprobarse e implementarse la aceptación informada de las condiciones de cada operación. Consulta también /privacy, /delivery y /refunds."
      ],
      [
        "Cuenta y acceso",
        "El registro utiliza un nombre de usuario y contraseña. El sistema existente ofrece recuperación mediante código; conserva tus credenciales y código de forma segura. No los compartas en soporte. No se promete recuperación por correo. Las solicitudes sobre una cuenta requieren verificar la identidad antes de revelar información o efectuar cambios."
      ],
      [
        "Funcionamiento y disponibilidad",
        "El juego ofrece experiencias tácticas según los modos y contenidos habilitados para cada cuenta. Puede requerir mantenimiento y conexión a servicios externos. No se garantiza disponibilidad ininterrumpida. Las incidencias de compras deben atenderse sin confundir mantenimiento con pérdida de derechos del consumidor."
      ],
      [
        "Contenidos digitales",
        "Se distinguen moneda virtual, cartas y objetos de juego, cosméticos y contenidos gratuitos. Los contenidos premium, skins o pases solo se ofrecen cuando existan en el catálogo activo; no se anuncia aquí ningún pase comercial inexistente. Cada oferta informa su contenido y requisitos de propiedad o adquisición."
      ],
      [
        "Cristales Arcanos",
        "Son moneda virtual interna para adquirir ofertas elegibles de la Tienda Arcana. No son dinero real, no generan intereses ni son una inversión. Comprarlos no concede propiedad sobre el código, las imágenes, las marcas o la infraestructura. Este documento no establece nuevas reglas de transferencia, caducidad o pérdida de saldo; las funciones de regalos existentes no implican conversión en dinero ni un mercado entre usuarios."
      ],
      [
        "Información antes del pago",
        "Los paquetes de cristales de pago utilizan pesos colombianos (COP) y los medios habilitados por ePayco. Antes de confirmar se debe conocer producto, cantidad, precio total, cuenta de destino, condiciones de entrega y derechos de reclamación. Los precios y paquetes proceden del catálogo activo; esta página no fija precios ni modifica el saldo. Los pagos permanecen en pruebas y la revisión comercial aún no ha concluido."
      ],
      [
        "Confirmación y entrega",
        "ePayco procesa el pago. El backend comprueba la autenticidad de la confirmación, la transacción, el pedido, importe y moneda antes de acreditar una única vez. Regresar del checkout no acredita cristales. El procedimiento y estados se describen en /delivery."
      ],
      [
        "Reclamaciones y derechos",
        "Consulta /refunds para productos no recibidos, duplicados, operaciones no autorizadas, retracto o reversión cuando procedan. No se excluyen globalmente los reembolsos de contenidos digitales ni se limita ningún derecho imperativo mediante estos términos."
      ],
      [
        "Uso permitido",
        "No suplantes a otras personas ni manipules pagos, cuentas o servicios. No uses fraude, automatización abusiva o acceso no autorizado. Estas condiciones no añaden sanciones automáticas al juego ni autorizan decisiones ilimitadas sobre compras o datos."
      ],
      [
        "Cambios y suspensión del servicio",
        "Los ajustes operativos o de contenido deben informarse de forma adecuada según su alcance. No se atribuye al responsable una facultad irrestricta de eliminar derechos o desconocer obligaciones sobre productos adquiridos. La política comercial de modificaciones significativas permanece pendiente de revisión."
      ],
      [
        "Soporte público",
        "El formulario /contact permite solicitar atención sin iniciar sesión, con categoría Tienda y motivos de pago o reembolso. Primera respuesta en un máximo de dos días hábiles: es atención inicial, no una promesa de resolución en ese plazo. Los plazos legales aplicables conservan su vigencia."
      ],
      [
        "Ley aplicable",
        "Se toma como referencia la legislación colombiana y se preservan los derechos imperativos del consumidor. Las interpretaciones específicas sobre moneda virtual y ejecución de servicios deben revisarse jurídicamente antes de aprobación."
      ],
      [
        "Pendiente de aprobación",
        "Vigencia pendiente de aprobación formal. Faltan datos comerciales exigibles, revisión jurídica, condiciones de aceptación de compra y verificación operativa del canal público. Este texto sigue siendo un borrador y no habilita cobros reales."
      ]
    ]
  },
  "delivery": {
    "title": "Política de entrega de productos digitales",
    "sections": [
      [
        "Entrega exclusivamente digital",
        "Los productos se reciben dentro de RPG GO Tactics; no hay envío físico. Los paquetes de cristales son distintos de las ofertas de cartas o cosméticos adquiridas con moneda interna. No se garantiza disponibilidad de productos que no figuren en el catálogo activo."
      ],
      [
        "Cuenta de destino",
        "El pedido de pago se crea para la cuenta autenticada, identificada por el servidor; el cliente no decide el beneficiario mediante un identificador arbitrario. Comprueba la sesión y el paquete antes de confirmar. Nunca compartas contraseñas para resolver un error de destino."
      ],
      [
        "Proceso técnico de entrega",
        "El jugador selecciona el paquete y confirma la compra en el checkout habilitado; ePayco procesa la transacción. El backend recibe la notificación y verifica firma, identidad, pedido, importe, moneda y condiciones de la operación. Solo entonces acredita los cristales y registra el movimiento en el ledger. Las notificaciones repetidas no deben volver a acreditar el mismo pedido."
      ],
      [
        "Estados reales",
        "El sistema registra CREATED (creado), PENDING (pendiente), PAID (pago validado pendiente de acreditación), FULFILLED (acreditado), FAILED (fallido), CANCELLED (cancelado), EXPIRED (vencido), REFUNDED (reembolsado) y DISPUTED (en disputa). La interfaz los resume como verificando, pendiente, aprobado, rechazado, fallido o en revisión. Aprobado en pantalla corresponde a una operación acreditada; una incidencia puede requerir revisión sin crear un estado ficticio."
      ],
      [
        "Tiempo de acreditación",
        "La acreditación se realiza automáticamente una vez que la transacción es confirmada y validada por el sistema. No se promete un máximo operativo en minutos u horas. Los derechos y plazos legales que correspondan no quedan desplazados por esta descripción técnica."
      ],
      [
        "Pago aprobado sin saldo",
        "Usa /contact, categoría Tienda o Pagos. Indica correo de contacto, referencia si la conoces, fecha aproximada y una descripción del problema. No repitas una compra para intentar corregirla sin revisar primero su estado. No envíes números completos de tarjeta, credenciales ni códigos de recuperación."
      ],
      [
        "Duplicados y dos cobros diferentes",
        "Varias notificaciones de una transacción no deben generar varias entregas. Dos cargos reales distintos deben investigarse como operaciones separadas; la idempotencia no resuelve por sí sola un doble cobro."
      ],
      [
        "Historial y consulta",
        "El juego dispone de historial de compras para la cuenta autenticada, con fecha, paquete, importe, cristales, referencia y resultado. Si no puedes acceder, solicita atención pública; una referencia no prueba por sí sola titularidad y no permite consultar operaciones ajenas."
      ],
      [
        "Contacto y documentos",
        "Consulta /contact para soporte sin sesión, /terms para condiciones y /refunds para reclamaciones. La primera respuesta comercial se ofrece en un máximo de dos días hábiles, sin sustituir plazos legales ni prometer resolución inmediata."
      ],
      [
        "Pendiente de aprobación",
        "Fecha de vigencia pendiente. Deben aprobarse los datos comerciales, verificarse la operación del soporte y revisar jurídicamente las condiciones de entrega. No se activa el modo comercial de pagos con este documento."
      ]
    ]
  },
  "refunds": {
    "title": "Política de reembolsos, retracto y reversión de pagos",
    "sections": [
      [
        "Alcance",
        "Esta política en revisión comprende compras digitales de RPG GO Tactics. Se reciben solicitudes por contenido no recibido, cobros duplicados, operaciones no autorizadas, errores de procesamiento, retracto y otros derechos aplicables. No declara que toda compra digital sea irrembolsable."
      ],
      [
        "Derecho de retracto",
        "El artículo 47 de la Ley 1480 contempla el retracto en determinadas ventas a distancia: su ejercicio tiene un término general de cinco días hábiles desde la entrega del bien o celebración del contrato de servicios, según corresponda. Existen excepciones legales, entre ellas servicios iniciados con acuerdo del consumidor. No se presume que acreditar o consumir cristales constituye por sí solo renuncia o exclusión. La aplicación a moneda virtual requiere revisión jurídica del caso."
      ],
      [
        "Devolución derivada del retracto",
        "La normativa de comercio electrónico fue modificada por la Ley 2439 de 2024. El texto consolidado prevé devolución dentro de quince días calendario cuando se cumplen los requisitos correspondientes. Debe revisarse el alcance aplicable y la documentación necesaria sin trasladar al comprador requisitos abusivos. No se promete ni impone un plazo comercial contrario al régimen vigente."
      ],
      [
        "Reversión del pago",
        "El artículo 51 regula supuestos como fraude, operación no solicitada, producto no recibido, defectuoso o distinto. Dentro del término legal de cinco días hábiles desde el conocimiento o hecho aplicable, corresponde reclamar al proveedor y notificar al emisor del instrumento de pago, con devolución cuando proceda. La reversión legal y una devolución comercial son procedimientos distintos. El Decreto 587 de 2016 delimita su ámbito territorial y trámite; su aplicación concreta requiere revisión."
      ],
      [
        "Cómo solicitar atención",
        "Envía /contact sin iniciar sesión. Selecciona Reembolsos y explica el motivo, añade correo y referencia si la conoces. Si desconoces la referencia, describe la operación sin datos completos de tarjetas ni contraseñas. No se exige evidencia adjunta: no hay un almacenamiento de archivos habilitado para este formulario. Conserva el identificador recibido."
      ],
      [
        "Verificación y primera respuesta",
        "Primera respuesta en un máximo de dos días hábiles. No equivale a resolución o devolución en ese plazo y no sustituye términos legales. La investigación y el procesamiento pueden involucrar al comprador, ePayco o la entidad financiera. Se verificará identidad antes de revelar información o modificar una cuenta."
      ],
      [
        "Contenido utilizado y fraude",
        "El uso del contenido puede ser relevante para valorar la solicitud, pero no elimina automáticamente garantías o derechos. La investigación se limita a los datos necesarios; las notificaciones duplicadas de un pago y los cargos distintos se revisan por separado. No se habilita una devolución automática ni una sanción a través de este texto."
      ],
      [
        "Transparencia",
        "Consulta /terms y /delivery. Puedes acudir a la autoridad de protección al consumidor en https://www.sic.gov.co/. La recepción por soporte no sustituye actuaciones que debas realizar ante el emisor de pago o la autoridad dentro del término legal."
      ],
      [
        "Pendiente de aprobación",
        "Vigencia pendiente. Revisión jurídica específica: retracto de cristales y contenido consumido, aceptación del inicio de servicio, restituciones, aplicación territorial de reversión, requisitos y plazos vigentes. Deben aprobarse procedimiento interno, datos del responsable y capacidad operativa antes de pagos reales."
      ]
    ]
  },
  "privacy": {
    "title": "Política de tratamiento de datos personales",
    "sections": [
      [
        "Responsable y alcance",
        "Fabian Mauricio Siza Paladines, persona natural que comercializa RPG GO Tactics en Colombia, se identifica como responsable sujeto a verificar el alcance de sus operaciones. Sitio: https://rpg-go-tactics.com/. Identificación y domicilio adicionales están pendientes de aprobación. Referencias: Ley 1581 de 2012, Decreto 1074 de 2015 y orientaciones de la SIC."
      ],
      [
        "Cuenta y autenticación",
        "El sistema utiliza nombre de usuario, identificador, hash y sal de contraseña, código de recuperación protegido y sesiones con vencimiento. No existe un correo obligatorio en el registro auditado; el formulario público sí solicita un correo para responder. No envíes contraseñas ni códigos en solicitudes de soporte."
      ],
      [
        "Perfil, actividad y funciones sociales",
        "Se conservan progreso por campeón, mazos, colecciones, desbloqueos, cosméticos y datos de partidas necesarios para validación. Las funciones conectadas incluyen amigos, mensajes 1:1, invitaciones y chat de partida, además de historial PvP. Las finalidades son prestar las funciones solicitadas, restaurar progreso, verificar resultados y evitar duplicaciones."
      ],
      [
        "Compras y transacciones",
        "Se registran pedidos, paquetes, importes, moneda, estados, referencias de proveedor, adquisiciones, regalos y movimientos de cristales. Al crear un pedido se guarda la declaración de mayoría de edad y aceptación contractual con versión, fecha del servidor, cuenta e identificador único de operación; no se recoge fecha de nacimiento, documento ni fotografía para este control. ePayco recibe los datos que requiera su checkout. El servidor procesa la confirmación y los identificadores necesarios para validar y conciliar; no solicites ni envíes tarjetas completas por soporte. Debe revisarse el inventario de campos remitidos por el proveedor y su conservación."
      ],
      [
        "Soporte público y reportes",
        "El reporte interno relaciona al usuario autenticado con descripción, categoría y contexto técnico permitido, como pantalla, versión, encuentro y dispositivo. El formulario público guarda correo, categoría/motivo, descripción, referencia opcional, autorización y número aleatorio. Usa huellas criptográficas de IP y correo para limitar abuso; no almacena la IP en claro en el reporte público. La información proporcionada libremente puede contener datos personales: limita su contenido a lo necesario."
      ],
      [
        "Finalidades y autorización",
        "Se diferencian gestión de cuentas, prestación del juego, compras y entrega, prevención de fraude, seguridad y atención al usuario. El formulario solicita autorización expresa para tramitar la solicitud y responder; no exige consentimiento publicitario. No se implementan campañas de marketing en esta tarea. Las bases y avisos del registro y de cada integración requieren revisión; navegar no equivale a una autorización general."
      ],
      [
        "Proveedores e información internacional",
        "Cloudflare presta alojamiento de Pages, Workers, D1, Durable Objects y verificación Turnstile. Los servicios de autenticación existentes pertenecen a la infraestructura RPG-GO alojada en Cloudflare. ePayco procesa los pagos cuando está habilitado. Estos proveedores pueden procesar datos fuera de Colombia; no se afirma residencia exclusivamente colombiana. Deben verificarse contratos, ubicaciones, roles y condiciones de transmisión o transferencia internacional antes de aprobación."
      ],
      [
        "Almacenamiento local y seguimiento",
        "El navegador conserva sesión, preferencias y progreso en almacenamiento local. Se utilizan conexiones autenticadas para el juego y funciones sociales. No se identificó una integración de publicidad ni un SDK de analítica en el código de la landing auditado; esto no certifica la configuración externa de Cloudflare o ePayco. Turnstile y checkout pueden requerir tecnologías propias. Queda pendiente revisar esas configuraciones y decidir avisos/consentimientos exigibles; no se afirma que no existan cookies."
      ],
      [
        "Derechos del titular",
        "Puedes conocer, acceder, actualizar y rectificar datos, solicitar prueba de autorización e información sobre su uso y presentar quejas ante la SIC. La supresión o revocación procede según el régimen aplicable y obligaciones de conservación; no implica borrar automáticamente registros necesarios por una obligación legal. No se revelan datos de cuentas o transacciones sin verificar identidad."
      ],
      [
        "Consultas y reclamos",
        "Usa /contact, categoría Privacidad y datos personales, sin sesión. Identifica el derecho que solicitas sin adjuntar documentos sensibles inicialmente. La Ley 1581 distingue consultas, normalmente diez días hábiles con extensión motivada hasta cinco, y reclamos, quince días hábiles con extensión motivada hasta ocho. Las reglas de solicitud incompleta y reclamo en trámite deben aplicarse según la ley. Los dos días hábiles de primera atención comercial no sustituyen estos términos."
      ],
      [
        "Conservación",
        "No existe un calendario técnico integral de retención y eliminación aprobado en el repositorio auditado. Deben definirse criterios por sesiones, mensajes, reportes, facturación, pagos y respaldos conforme a finalidad y obligaciones legales, junto con procesos efectivos de eliminación. No se inventa aquí una duración ni se promete borrado automático que no esté implementado."
      ],
      [
        "Seguridad y acceso",
        "Se utilizan verificaciones de sesión, consultas parametrizadas, validación de datos, controles de acceso y comprobaciones de confirmaciones de pago. El formulario público añade límites de tamaño y frecuencia, verificación antispam y no expone consultas públicas de tickets. No se declaran certificaciones ni seguridad absoluta. La gestión administrativa y las respuestas requieren personal autorizado y verificación de identidad."
      ],
      [
        "Menores de edad",
        "El registro y el acceso al juego no solicitan fecha de nacimiento ni documentos y no verifican edad ni autorización parental. Las compras con dinero real se restringen a mayores de 18 años mediante declaración expresa y aceptación por operación; esto no verifica la identidad ni la edad de forma independiente, y no se exige para jugar o recibir contenido gratuito. Falta definir público objetivo, tratamiento de datos y participación en compras de menores con revisión de los requisitos legales correspondientes. No se presenta esta política como evidencia de un control que no existe."
      ],
      [
        "Pendiente de aprobación",
        "Vigencia pendiente de aprobación formal. Revisar identidad y datos del responsable, inventario completo, proveedores, transferencias, retención, menores, autorización de registro y avisos de tecnologías externas. El formulario es un canal funcional en preparación; debe verificarse su operación antes de anunciarlo como disponible."
      ]
    ]
  }
};
