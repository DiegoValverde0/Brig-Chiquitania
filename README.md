# Brig-Chiquitania

Sistema de Apoyo a la Decisión para la Priorización de Brigadas ante Focos de Calor en la Chiquitanía (MVP).
Reglas del proyecto: [`AGENTS.md`](AGENTS.md). Backend: [`backend/CLAUDE.md`](backend/CLAUDE.md).
App web: [`frontend/GEMINI.md`](frontend/GEMINI.md). Documentación de referencia: [`documentacion_base/`](documentacion_base/).

## Puesta en marcha

Guía paso a paso para desarrollo con Docker y para ejecutar todas las pruebas:
[`GUIA_DESARROLLO.md`](GUIA_DESARROLLO.md).

```bash
docker compose up -d --build                  # PostgreSQL 16 + API (:3000/api) + app web con nginx (:8080)
docker compose exec api node dist/seed        # comunidades, contactos, brigadas y usuarios demo
```

- App de reporte (CU-01): <http://localhost:8080>. Códigos de acceso demo (solo desarrollo):
  `demo-guardaparque`, `demo-coordinador`, `demo-jefe-brigada`, `demo-ugr`.
- La geolocalización del navegador solo funciona en `localhost` o con **HTTPS**: en el VPS hay que terminar TLS
  delante del contenedor `web`.
- Producción: definir en un `.env` junto a `docker-compose.yml` `NODE_ENV=production`, `CLAVE_CIFRADO`
  (`openssl rand -base64 32`), `SMS_WEBHOOK_SECRETO` y `DB_PASSWORD`. La semilla no crea usuarios demo en
  producción; el primer coordinador se crea con
  `docker compose exec api node dist/crear-usuario "Nombre" Coordinador` (el token se muestra una sola vez).

Desarrollo sin Docker para la API: `docker compose up -d db`, luego en `backend/`:
`cp .env.example .env && npm ci && npm run build && npm run seed && npm run start:dev` (con `FRONTEND_DIR` la
API también sirve la app en <http://localhost:3000>).

## Qué incluye

**Bolt 0 — Walking Skeleton:** reporte GPS → **Nuevo** con riesgo calculado → panel → brigada sugerida → carta
municipal (Ley 602) → despacho confirmado por un humano → llegada → **ΔT** y % de ahorro frente a 180 min, con
historial append-only (`node backend/scripts/flujo-e2e.mjs` lo recorre por API).

**Bolt 1 — Captura resiliente y contacto comunal:**
- App web instalable (PWA) sin mapas ni frameworks: GPS ≤15 m o avistamiento a distancia (comunidad + rumbo +
  km), foto comprimida en el teléfono a ≤100 KB y contacto comunal autocompletado desde el catálogo offline.
- Offline-first: el reporte se guarda primero en el teléfono (IndexedDB) y se sincroniza solo al volver la señal,
  sin duplicarse (UUID generado en el teléfono). La app abre sin red (service worker).
- Canal SMS de contingencia: formato `BRC1` de ≤160 caracteres, webhook para el proveedor y **pasarela simulada**
  mientras no haya proveedor contratado.
- Seguridad (RNF-08): usuarios con rol y token; cifrado AES-256-GCM en reposo de la ubicación del foco, los
  datos del referente comunal, los SMS y las fotos.

**Bolt 2 — Motor de riesgo y gobernanza algorítmica:**
- Motor explicable: Alto (<5 km de una comunidad habitada, "Amenaza directa a vida humana comunitaria"), Medio
  (5–15 km) o Bajo, con los factores evaluados guardados en cada incidente. Las estancias privadas se excluyen
  explícitamente de la priorización.
- Reclasificación manual por el coordinador con justificación obligatoria (≥15 caracteres), registrada en el
  historial append-only con quién, cuándo, motivo y niveles.
- Pestaña "Evaluación de riesgo" en la app para el coordinador (wireframe de la Figura 8).

**Bolt 3 — Trámite municipal y estados tácticos:**
- Carta municipal digitalizada (Ley 602): la UGR adjunta el PDF o la foto (≤1 MB, cifrada en reposo); queda
  "por validar" y ya habilita el despacho. El coordinador la valida o la rechaza con motivo (≥15 caracteres), y
  el rechazo bloquea el despacho hasta que la UGR adjunte otra. Todo queda en `evento_auditoria` (append-only).
- Panel COED (Figura 9): Kanban de 4 columnas con contadores, filtros por carta (con / sin / por validar),
  riesgo y comunidad, "ver más" desde 15 tarjetas, actualización cada 30 s, y mapa esquemático en SVG propio
  (sin teselas) con focos agrupados y brigadas.
- Estados tácticos de brigada (4): el jefe reporta "En Liquidación / Por finalizar" (su foco pasa a
  En Liquidación) y el coordinador libera la brigada (Disponible).

**Bolt 4 — Despacho y reasignación táctica:**
- Despacho en 1 clic desde el panel (con confirmación humana, RS-03): el UUID del clic hace idempotente el
  reintento y la versión de la brigada (bloqueo optimista) impide el doble despacho.
- Aviso al jefe de brigada: Web Push (VAPID + `aes128gcm`, sin librerías) y SMS de respaldo ≤160 caracteres si no
  tiene notificaciones, si el push falla o si no abre la orden en 3 minutos. Coordenadas, ruta en línea recta y
  contacto comunal. El panel muestra 📨 enviado, ✔ leído o ⚠ fallido.
- Reactivación de focos: el coordinador devuelve a "Nuevo" (riesgo Alto, primero en su columna) un foco controlado
  que vuelve a ser riesgoso; un reporte nuevo a menos de 2 km lo sugiere.
- Reasignación táctica: una brigada "En Liquidación" a menos de 30 km de un foco Alto se sugiere primero y se
  despacha en 1 clic. Sin jefe con teléfono no se despacha.
- "Mi brigada": orden de salida con cronómetro, botón para llamar al referente y confirmación de llegada por GPS.

**Bolt 5 — Bitácora y cierre institucional:**
- Bitácora de turno por checklist (agua, combustible, herramientas, km de faja, % de control; nunca texto libre):
  se guarda primero en el teléfono y se sincroniza sola en <1 KB, sin duplicarse; también por SMS (`BRC1 B`).
  Inmutable una vez guardada.
- Cierre en 1 clic (Controlado / Extendido / Falso positivo con justificación obligatoria): el foco pasa a Cerrado,
  la brigada queda Disponible y se genera el **Informe Técnico Consolidado** en PDF inmutable (generador propio, sin
  librerías) con el ciclo completo, el ΔT y todas las bitácoras. Lista de informes con el resumen del KPI.

## API

Todas las rutas exigen `Authorization: Bearer <token>` salvo `/api/health` y el webhook SMS.

| Método | Ruta | Rol | Uso |
|---|---|---|---|
| `GET` | `/api/sesion` | cualquiera | Quién es el usuario del token |
| `POST` | `/api/usuarios` | Coordinador | Alta de usuario; devuelve el token una sola vez |
| `POST` | `/api/incidentes` | cualquiera | Reporte GPS o a distancia, idempotente por UUID (201 nuevo / 200 reintento) |
| `GET` | `/api/incidentes/:id` | cualquiera | Estado del reporte, riesgo y contacto comunal |
| `POST` | `/api/incidentes/:id/evidencia` | cualquiera | Foto ≤100 KB como binario (`image/jpeg`, `png`, `webp`); cabecera opcional `x-capturada-en` |
| `GET` | `/api/incidentes/:id/evidencia` | Coordinador | Foto descifrada |
| `GET` | `/api/catalogo/comunidades` | cualquiera | Catálogo offline de comunidades y referentes (con `version`) |
| `POST` | `/api/comunidades` | Coordinador | Alta de comunidad habitada |
| `PUT` | `/api/comunidades/:id/contacto` | Coordinador | Crea o corrige el referente comunal |
| `POST` | `/api/sms/entrante` | webhook (`x-sms-secreto`) | Entrada de SMS del proveedor |
| `POST` | `/api/sms/simulador` | cualquiera | Simula el SMS que enviaría el teléfono |
| `GET` | `/api/sms/configuracion` | cualquiera | Número de la central y pasarela activa |
| `GET` | `/api/sms/mensajes` | Coordinador | Bandeja de SMS entrantes y salientes |
| `GET` | `/api/panel` | Coordinador | Kanban: incidentes activos por columna, contadores y brigadas; filtros `?carta=con\|sin\|por_validar`, `?riesgo=Alto,Medio`, `?comunidad=` |
| `GET` | `/api/brigadas` | Coordinador | Brigadas con estado táctico, jefe y foco asignado |
| `GET` | `/api/brigadas/mia` | Jefe de Brigada | La brigada que lidera el usuario y su orden de salida vigente |
| `PUT` | `/api/brigadas/:id/jefe` | Coordinador | Asigna el jefe de la brigada `{usuarioId}` (sin jefe con teléfono no se despacha) |
| `POST` | `/api/brigadas/:id/estado` | Jefe de Brigada, Coordinador | `{estado: "En_Liquidacion"}` (jefe de esa brigada, desde En Combate) o `{estado: "Disponible"}` (coordinador, desde En Liquidación) |
| `GET` | `/api/incidentes/:id/evaluacion` | Coordinador | Riesgo vigente, origen, justificación y factores del motor, reclasificaciones |
| `POST` | `/api/incidentes/:id/reclasificacion` | Coordinador | Reclasificación manual `{nivelRiesgo, justificacion}` (≥15 caracteres) |
| `GET` / `POST` | `/api/predios-privados` | Coordinador | Catálogo de estancias excluidas de la priorización |
| `POST` | `/api/incidentes/:id/carta-municipal` | UGR, Coordinador | Carta municipal como binario (PDF, JPEG, PNG o WebP ≤1 MB) con cabecera `x-fecha-emision: AAAA-MM-DD`; 0..1 (201 nueva / 200 reenvío; reemplaza solo una rechazada) |
| `GET` | `/api/incidentes/:id/carta-municipal` | UGR, Coordinador | Estado del trámite (sin carta / por validar / validada / rechazada) |
| `GET` | `/api/incidentes/:id/carta-municipal/archivo` | UGR, Coordinador | Documento descifrado |
| `POST` | `/api/incidentes/:id/carta-municipal/verificacion` | Coordinador | `{resultado: "Validada" \| "Rechazada", motivo}` (motivo ≥15 caracteres al rechazar) |
| `GET` | `/api/cartas/pendientes` | UGR, Coordinador | Focos activos sin carta o con carta rechazada |
| `GET` | `/api/incidentes/:id/brigadas-sugeridas` | Coordinador | Candidatas (solo riesgo Alto/Medio): primero las En Liquidación a <30 km de un foco Alto (reasignación), luego las Disponibles por cercanía; con `version` y `despachable` |
| `POST` | `/api/incidentes/:id/asignaciones` | Coordinador | Despacho en 1 clic `{id?, brigadaId, versionBrigada?}`: 201 nuevo / 200 reintento del mismo `id` / 409 si la brigada cambió. Exige carta no rechazada, contacto comunal y jefe con teléfono. Avisa al jefe (push o SMS) |
| `POST` | `/api/incidentes/:id/reactivacion` | Coordinador | Reactiva un foco En Liquidación `{justificacion}` (≥15): vuelve a Nuevo, riesgo Alto |
| `POST` | `/api/asignaciones/:id/leida` | Jefe de Brigada (de esa brigada) | Acuse de recibo de la orden (evita el SMS de respaldo) |
| `GET` | `/api/notificaciones/clave-publica` | cualquiera | Clave VAPID para suscribir el navegador |
| `POST` / `DELETE` | `/api/notificaciones/suscripcion` | Jefe de Brigada | Suscripción Web Push del navegador (`PushSubscription`) |
| `POST` | `/api/asignaciones/:id/llegada` | Jefe de Brigada, Coordinador | Confirmación de llegada (write-once) |
| `GET` | `/api/incidentes/:id/tiempo-despacho` | Coordinador | ΔT, % de ahorro y cumplimiento de la meta del 30 % |
| `GET` | `/api/incidentes/:id/historial` | Coordinador | Historial append-only: quién, cuándo y motivo |
| `POST` | `/api/incidentes/:id/bitacoras` | Jefe de Brigada (de la brigada asignada) | Bitácora de turno por checklist, idempotente por `id` (201 / 200); entre la llegada y el cierre |
| `GET` | `/api/incidentes/:id/bitacoras` | Coordinador, Jefe de Brigada | Bitácoras del foco en orden |
| `POST` | `/api/incidentes/:id/cierre` | Coordinador | Cierre `{resultado: Controlado \| Extendido \| Falso_Positivo, justificacion}` (≥15 en Falso positivo); genera el informe |
| `GET` | `/api/incidentes/:id/informe` | Coordinador, UGR | Metadatos del informe (resultado, ΔT, SHA-256) |
| `GET` | `/api/incidentes/:id/informe/pdf` | Coordinador, UGR | Informe consolidado en PDF (descifrado; cabecera `X-Informe-SHA256`) |
| `GET` | `/api/informes` | Coordinador, UGR | Focos cerrados con su informe y el resumen del KPI (ΔT promedio, % que cumple la meta) |

Formato SMS (`BRC1`, texto plano ≤160 caracteres):
`BRC1 G <id> <lat> <lon> <precisión m> <hora>`, `BRC1 D <id> <comunidad> <N|S|E|O> <km> <hora>` o, para la
bitácora de turno, `BRC1 B <foco> <id> <agua S|C> <combustible O|R> <herramientas 1|0> <km> <% control> <hora>`
(ids en base64url de 22 caracteres, hora en segundos Unix base 36). Detalle en
`backend/src/core/sync/sms/codec-sms.ts`.

## Pruebas

- **Todo junto, con evidencias:** `node scripts/evidencias.mjs` (Windows, macOS o Linux; solo Node 22 y Docker) corre
  unitarias, e2e, flujo por API, inmutabilidad RNF-07 y navegador, y deja `evidencias/RESUMEN.md` (GUIA §4.1).
- `backend/`: `npm test` (unitarias) y `npm run test:e2e` (requiere PostgreSQL; crea y vacía la BD `chiquitania_test`).
- `frontend/pruebas/`: `npm ci && APP=http://localhost:8080 npm test` recorre la app en Chromium (sin conexión,
  cola, SMS simulado, evaluación de riesgo, panel COED con 60 focos, cartas y estados de brigada, despacho en
  1 clic, orden de salida, reactivación y reasignación, bitácora sin conexión, cierre con informe PDF, memoria).
  Usa el Chrome instalado (u otra ruta con `CHROMIUM=/ruta/al/binario`) y una BD recién sembrada (`npm run seed` deja las brigadas
  Disponibles).
