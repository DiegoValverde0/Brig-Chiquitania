# Backend Skill (CLAUDE.md)

Reglas específicas para el agente Arquitecto / Backend. Complementa (no reemplaza) `/AGENTS.md`.
Modelo de referencia: `documentacion_base/Modelos_UML.md`. Alcance por bolt: `documentacion_base/Release_Plan.md`.

## Stack
- Node.js 22 + **NestJS 11** + TypeScript (strict).
- **TypeORM 0.3** + **PostgreSQL 16** (driver `pg`). Coordenadas como `double precision` (sin PostGIS en el MVP).
- `@nestjs/config` para variables de entorno (`.env.example`).
- Docker: `backend/Dockerfile` multietapa (deps → build → runtime `node:22-alpine`, usuario no root) y
  `docker-compose.yml` en la raíz (`db` + `api` + `web` con nginx para la app de `frontend/app`).
- Sin dependencias nuevas de runtime: cifrado con `node:crypto`, validación manual, SMS por puerto propio y Web Push
  (VAPID + `aes128gcm`) implementado con `node:crypto` (Bolt 4, verificado contra el vector del RFC 8291).

## Estructura
```
backend/src/
├── main.ts / configurar-app.ts  # prefijo /api, límites de cuerpo (JSON 16 KB, binarios ≤1 MB), estáticos opcionales
├── app.module.ts           # ConfigModule + TypeORM (autoLoadEntities)
├── health.controller.ts    # GET /api/health (SELECT 1, público)
├── seed.ts / semilla.ts    # semilla idempotente (usuarios demo solo fuera de producción)
├── crear-usuario.ts        # alta por consola (primer coordinador en producción)
├── generar-vapid.ts        # claves VAPID de Web Push para el .env del VPS (Bolt 4)
├── common/                 # entidad-base, validacion, geo, cifrado (AES-256-GCM), filtro de errores de cuerpo,
│                           # almacén de archivos cifrados (fotos, cartas, informes), generador de PDF propio (pdf.ts)
└── core/
    ├── reporte/      (M1)  reporte GPS/distancia, evidencia fotográfica, catálogo comunal
    ├── triage/       (M2)  incidente, carta municipal (adjuntar/validar/rechazar), motor de riesgo, evaluación
    ├── despacho/     (M3 / M4)  panel COED, elegibilidad y despacho en 1 clic, reasignación táctica, estados
    │                            tácticos, notificaciones al jefe (push → SMS de respaldo)
    ├── operaciones/  (M4 / M5)  llegada, ΔT, bitácora de turno, cierre e informe PDF, historial y auditoría
    ├── seguridad/    (MT-2)  usuarios, roles, guard global
    └── sync/         (MT-1)  canal SMS: codec BRC1, pasarela (puerto + simulada), webhook, bandeja;
                              canal Web Push (claves VAPID, suscripciones, envío cifrado)
```
Un `@Module` por paquete UML `core.*`; cada módulo registra sus entidades con `TypeOrmModule.forFeature` y
exporta `TypeOrmModule`.

## Convenciones
- Todas las entidades extienden `EntidadBase` (id **UUID**: los clientes offline generan IDs sin colisión).
- Tablas y columnas en `snake_case` (`@Entity('incidente')`, `@Column({ name: 'nivel_riesgo' })`);
  propiedades TypeScript en `camelCase`, nombres de dominio en español.
- Relaciones tipadas con `Relation<T>` (evita problemas de import circular con `emitDecoratorMetadata`).
- Columnas nullable: declarar siempre `type` explícito (`string | null` se emite como `Object`).
- Enums como enum nativo de PostgreSQL (`type: 'enum'`) en `core/<paquete>/enums/`.
- Datos de auditoría (`HistorialEstado`, timestamps del despacho/llegada, informe): **append-only**; nunca
  exponer UPDATE/DELETE sobre ellos (RNF-07).
- Sincronización (`core.sync`): endpoints **idempotentes** (reintentos sin duplicar), payloads <2 KB (<1 KB
  para bitácora). Pensar siempre en el cliente sin red.
- Evitar dependencias pesadas; cada librería nueva requiere justificación frente a los límites de memoria.
- `synchronize: true` solo en desarrollo (`DB_SYNCHRONIZE`); antes del piloto se pasa a migraciones.
- **Acceso (RNF-08):** guard global (`seguridad/autenticacion.guard.ts`). Toda ruta nueva exige token; se marca
  `@Publico()` solo si tiene otra autenticación (webhook) o es monitoreo. Restringir con `@Roles(...)` y leer el
  usuario con `@UsuarioActual()`; pasar su id a `HistorialEstadoService.registrarCambio` (el "quién").
- **Cifrado (RNF-08):** datos personales o de ubicación del reporte con los transformers `textoCifrado` /
  `numeroCifrado` (`common/cifrado.ts`) en columnas `text`; nunca filtrar ni ordenar por ellas en SQL (las
  distancias se calculan en la aplicación). Escribir con `save`/`insert` de entidades (con `update` parcial el
  transformer también aplica, pero validar largos antes de cifrar). Archivos: `cifrarBytes` antes de escribir.
- **SMS:** todo mensaje saliente pasa por `SmsService.enviar` (normaliza a GSM-7, ≤160, y lo registra). Un
  proveedor real es otra subclase de `PasarelaSms` registrada en `crearPasarelaSms`.
- El codec SMS y los cálculos geográficos tienen copia en `frontend/app/js/`; las pruebas unitarias verifican
  que coincidan. Cambiar ambos lados a la vez.

## Límites de recursos (VPS)
- PostgreSQL: `shared_buffers=128MB`, `max_connections=30`, `mem_limit 384m`.
- API: pool TypeORM `max: 5`, `NODE_OPTIONS=--max-old-space-size=256`, `mem_limit 320m`.

## Comandos
```bash
docker compose up -d --build          # todo en contenedores
docker compose up -d db               # solo BD
cd backend && cp .env.example .env && npm ci && npm run start:dev
npm run build                         # verificación de tipos / compilación
curl localhost:3000/api/health        # {"status":"ok","db":"up"}
npm test                              # unitarias (sin BD)
npm run test:e2e                      # flujo E2E contra PostgreSQL (BD chiquitania_test, se recrea)
node scripts/flujo-e2e.mjs            # mismo flujo por API (Node, sin bash) contra una API en marcha con semilla
node dist/crear-usuario "Nombre" Coordinador   # alta por consola; imprime el token una vez
```

## Flujo E2E del Bolt 0 (endpoints en README raíz)
- Validación manual de payloads (`common/validacion.ts`), sin class-validator, por memoria.
- Transiciones de estado siempre en una transacción que inserta en `historial_estado` vía
  `HistorialEstadoService` (única vía de escritura).
- Guardas de despacho: riesgo Alto/Medio, `CartaMunicipal.habilitaDespacho()` (adjunta y no rechazada: Ley 602),
  `ContactoComunal` no vacío, incidente en "Nuevo", brigada elegible (`despacho/elegibilidad.ts`: Disponible, o
  En Liquidación a <30 km de un foco Alto) y con jefe con teléfono (Bolt 4). UPDATE condicional por estado y
  `version` (bloqueo optimista) contra el doble despacho; `id` del cliente para reintentos idempotentes.
- Toda actualización del estado de una brigada sube `version` (`version: () => 'version + 1'`).
- Motor de riesgo (`MotorRiesgoService`, `motor-v2` desde el Bolt 2): comunidad habitada <5 km ⇒ Alto (texto
  exacto "Amenaza directa a vida humana comunitaria"), 5–15 km ⇒ Medio (umbral aprobado por el PO), ≥15 km ⇒ Bajo.
  Los `PredioPrivado` (estancias) solo se listan como excluidos; nunca elevan el nivel. Devuelve `factores`
  (versión, regla, umbrales, comunidad, predios excluidos, ms) que se guardan en `incidente.factores_riesgo`.
  Función pura: cualquier cambio de reglas sube `VERSION_MOTOR` y pasa por revisión del PO.
- Fechas de reporte y llegada: opcionales desde el cliente (captura offline), nunca en el futuro.
- Ojo con TypeORM: `select` parcial sobre una columna embebida (`coordenadas: true`) devuelve el objeto vacío;
  cargar la entidad completa.

## Estado del modelo implementado vs. UML oficial
Alineado en el Bolt 0 (PR A del plan aprobado por el PO el 28/09/2026):
- Enums `EstadoIncidente`, `NivelRiesgo`, `EstadoBrigada` (renombrado desde `EstadoOperativo`), `TipoReporte` y
  `ResultadoCierre` con los valores del UML. Se eliminó `EstadoAsignacion` (no existe en el UML).
- `Coordenada` es un valor **embebido** (`@Column(() => Coordenada, { prefix: false })`): columnas `latitud`,
  `longitud`, `precision_metros` en `incidente`, `comunidad` y `brigada`; ya no tiene tabla propia.
- `Incidente`, `Comunidad` (nueva) ◆ `ContactoComunal`, `CartaMunicipal`, `Brigada`, `AsignacionDespacho` y
  `HistorialEstado` (nueva) siguen el diccionario de clases.
- `AuditoriaInmutableService` instala triggers en PostgreSQL al arrancar: `historial_estado` rechaza
  UPDATE/DELETE/TRUNCATE; `incidente.fecha_reporte` y `asignacion_despacho.timestamp_confirmacion_llegada`
  son write-once (RNF-07).
- Inferencias: ids UUID también en `Comunidad` y `Brigada` (el UML dice `int`) por el cliente offline;
  `HistorialEstado.estadoAnterior` agregado para reconstruir el ciclo.

Bolt 1 (captura resiliente):
- `EvidenciaFotografica` (UML) 0..1 con `Incidente`: metadatos en BD, archivo cifrado en `EVIDENCIAS_DIR`;
  además `tipoMime` y `sha256` (idempotencia del reenvío) [inferencia].
- `Usuario` con `rol` en una sola tabla (el UML lo modela abstracto con 4 subclases, inferencia del equipo);
  token de acceso guardado como SHA-256. `HistorialEstado.usuario` registra quién hizo cada cambio.
- `Incidente`: `rumbo` y `distanciaEstimadaKm` para el avistamiento a distancia [inferencia de atributos];
  latitud/longitud cifradas (`CoordenadaCifrada`); las coordenadas de catálogo (comunidades, brigadas) siguen en claro.
- `ContactoComunal`: nombre y teléfono cifrados. `MensajeSms` (nueva, `core.sync`): bitácora de SMS con número
  y texto cifrados.

Bolt 2 (motor de riesgo y gobernanza algorítmica):
- `Incidente`: `origenRiesgo` (Motor | Manual) y `factoresRiesgo` (jsonb, RF-05). `justificacionRiesgo` guarda
  siempre la explicación del motor; la justificación humana vive en el historial.
- `HistorialEstado`: `tipoEvento` (CambioEstado | Reclasificacion), `nivelAnterior`, `nivelNuevo`. Reclasificar
  (`EvaluacionService.reclasificar`) usa `HistorialEstadoService.registrarReclasificacion`, con bloqueo de fila;
  justificación de 15 a 500 caracteres (tras quitar espacios), solo Coordinador, nunca sobre un incidente Cerrado.
- `PredioPrivado` (nueva, `core.reporte`, [inferencia]): catálogo de estancias, en claro como las comunidades.

Bolt 3 (trámite municipal y estados tácticos):
- `CartaMunicipal`: `archivoDigital` es la ruta del archivo cifrado en `EVIDENCIAS_DIR` (vía `AlmacenArchivosService`);
  suma `tipoMime`, `pesoKB`, `sha256` (idempotencia del reenvío) y `motivoRechazo`. Sin `sha256` = referencia en
  texto anterior al Bolt 3 (no se puede validar; la UGR adjunta el archivo). PDF/JPEG/PNG/WebP ≤1 MB (`PESO_MAXIMO_CARTA`);
  "Recibida" ya habilita el despacho y "Rechazada" lo bloquea (decisión del PO). Solo se reemplaza una carta
  rechazada; el motivo de rechazo exige ≥15 caracteres.
- `Brigada.jefe` (Usuario, 1–1, "JefeBrigada lidera Brigada" del UML). Estados tácticos a mano (`estado-tactico.ts`,
  función pura): el jefe de esa brigada reporta En Liquidación desde En Combate Activo (y su foco pasa de
  En atención a En Liquidación, en el historial); el coordinador libera (Disponible) desde En Liquidación. 403 si el
  rol o la brigada no corresponden, 409 si la transición no es válida.
- `EventoAuditoria` (nueva, `core.operaciones`, [inferencia]): tabla append-only (triggers como `historial_estado`)
  para eventos que no son del ciclo del incidente: carta adjuntada/reemplazada/validada/rechazada y cambio táctico de
  brigada. Única vía de escritura: `AuditoriaService.registrar` dentro de la transacción del cambio.
- `GET /api/panel`: filtros en `despacho/panel.ts` (funciones puras, en memoria porque las coordenadas están
  cifradas); orden por riesgo y antigüedad; contadores por columna. 60 focos responden en <1 s (prueba e2e).

Bolt 4 (despacho y reasignación táctica):
- `Brigada.version` (bloqueo optimista). `AsignacionDespacho`: `id` del cliente (idempotencia), `rutaSugerida` =
  distancia y rumbo en línea recta + coordenadas (`rutaEnLineaRecta` en `common/geo.ts`, decisión 7.3), y
  `fecha_asignacion` inmutable por trigger (cronómetro de HU-4.2).
- `Notificacion` (UML, 1..* por asignación): `canal` (WebPush | SMS), `contenido` cifrado, `estadoEnvio`
  (Pendiente | Enviada | Fallida | Leida) [+ `detalle`, `enviadaEn`, `leidaEn`, inferencia]. `NotificacionesService`
  envía después del commit (nunca revierte el despacho): push; SMS si no hay suscripción, si falla o si no se lee en
  `SMS_RESPALDO_MIN` (barrido cada 30 s). SMS de despacho ≤160 en `mensaje-despacho.ts`.
- `SuscripcionPush` (`core.sync`, [inferencia]): endpoint cifrado + hash único; en producción solo servicios de push
  conocidos por https (anti-SSRF). Claves `VAPID_*` obligatorias en producción; en desarrollo `almacen/vapid-dev.json`.
- `Incidente.reactivadoEn` / `reactivaciones` y `TipoEventoHistorial.Reactivacion` (decisión 7.2): solo el
  Coordinador, solo desde En Liquidación → Nuevo, Alto; los reactivados encabezan su columna. "Posible
  reactivación" (reporte Nuevo posterior a <2 km) es solo un aviso.
- Reasignación: el foco anterior sigue En Liquidación (decisión 7.5), con historial en ambos focos y
  `evento_auditoria` `ReasignacionTactica`. `PUT /api/brigadas/:id/jefe` asigna el jefe (decisión 7.4).

Bolt 5 (bitácora y cierre institucional):
- `Bitacora` (UML, 0..* por Incidente): `fecha`, `nivelAgua` (Suficiente | Critica), `nivelCombustible` (OK | Reserva),
  `herramientasOperativas`, `kmFajaMitigados`, `porcentajeControl` [+ `controlRetrocede`, `canal`, brigada y usuario:
  inferencia]. Id del teléfono (idempotente), append-only por trigger, sin `actualizado_en`. `leerBitacora`
  (`operaciones/bitacora.ts`, función pura) rechaza cualquier campo que no sea del checklist (nunca texto libre).
  Solo el jefe de la brigada asignada y solo En atención / En Liquidación. También por SMS `BRC1 B` (codec y app).
- `InformeConsolidado` (UML, 0..1): `contenidoPDF` = ruta del PDF cifrado, `sha256`, `pesoKB`, `tiempoTotalDespacho`
  (null sin llegada), `justificacionFalsoPositivo`, `resultado`; append-only por trigger. `CierreService.cerrar` hace
  todo en una transacción (estado Cerrado + historial, libera la brigada que sigue ligada al foco, compila con
  `informe.ts` y genera el PDF con `common/pdf.ts`). Reglas del PO: Controlado/Extendido tras la llegada; Falso
  positivo desde cualquier estado activo con justificación ≥15. "Extendido" = supera la capacidad departamental
  [inferencia a confirmar con el COED].
- Dentro de una transacción, las consultas van en serie (nunca `Promise.all` con el mismo `em`: `pg` lo depreca).

Pendiente para bolts posteriores:

| Tema | UML / SRS oficial | Implementado | Bolt |
|---|---|---|---|
| Bioma como factor de riesgo | RTM original: "distancia a población y bioma" | Diferido por el PO (sin datos de bioma) | — |
| Migraciones | Esquema versionado antes del piloto | `synchronize` | 1.0 |

Datos semilla (comunidades con contacto y brigadas, coordenadas aproximadas y contactos ficticios):
`npm run build && npm run seed` (en Docker: `docker compose exec api node dist/seed`). Es idempotente.

