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
historial append-only (`sh backend/scripts/flujo-e2e.sh` lo recorre con curl).

**Bolt 1 — Captura resiliente y contacto comunal:**
- App web instalable (PWA) sin mapas ni frameworks: GPS ≤15 m o avistamiento a distancia (comunidad + rumbo +
  km), foto comprimida en el teléfono a ≤100 KB y contacto comunal autocompletado desde el catálogo offline.
- Offline-first: el reporte se guarda primero en el teléfono (IndexedDB) y se sincroniza solo al volver la señal,
  sin duplicarse (UUID generado en el teléfono). La app abre sin red (service worker).
- Canal SMS de contingencia: formato `BRC1` de ≤160 caracteres, webhook para el proveedor y **pasarela simulada**
  mientras no haya proveedor contratado.
- Seguridad (RNF-08): usuarios con rol y token; cifrado AES-256-GCM en reposo de la ubicación del foco, los
  datos del referente comunal, los SMS y las fotos.

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
| `GET` | `/api/panel` | Coordinador | Incidentes activos por estado y brigadas |
| `POST` | `/api/incidentes/:id/carta-municipal` | UGR, Coordinador | Registro de la carta municipal (0..1) |
| `GET` | `/api/incidentes/:id/brigadas-sugeridas` | Coordinador | Brigadas Disponibles por cercanía (solo riesgo Alto/Medio) |
| `POST` | `/api/incidentes/:id/asignaciones` | Coordinador | Despacho confirmado (exige carta y contacto comunal) |
| `POST` | `/api/asignaciones/:id/llegada` | Jefe de Brigada, Coordinador | Confirmación de llegada (write-once) |
| `GET` | `/api/incidentes/:id/tiempo-despacho` | Coordinador | ΔT, % de ahorro y cumplimiento de la meta del 30 % |
| `GET` | `/api/incidentes/:id/historial` | Coordinador | Historial append-only: quién, cuándo y motivo |

Formato SMS (`BRC1`, texto plano ≤160 caracteres):
`BRC1 G <id> <lat> <lon> <precisión m> <hora>` o `BRC1 D <id> <comunidad> <N|S|E|O> <km> <hora>`
(ids en base64url de 22 caracteres, hora en segundos Unix base 36). Detalle en
`backend/src/core/sync/sms/codec-sms.ts`.

## Pruebas

- `backend/`: `npm test` (unitarias) y `npm run test:e2e` (requiere PostgreSQL; crea y vacía la BD `chiquitania_test`).
- `frontend/pruebas/`: `npm ci && APP=http://localhost:8080 npm test` recorre la app en Chromium (sin conexión,
  cola, SMS simulado y memoria). Requiere Chromium (`CHROMIUM=/ruta/al/binario`).
