# Backend Skill (CLAUDE.md)

Reglas específicas para el agente Arquitecto / Backend. Complementa (no reemplaza) `/AGENTS.md`.
Modelo de referencia: `documentacion_base/Modelos_UML.md`. Alcance por bolt: `documentacion_base/Release_Plan.md`.

## Stack
- Node.js 22 + **NestJS 11** + TypeScript (strict).
- **TypeORM 0.3** + **PostgreSQL 16** (driver `pg`). Coordenadas como `double precision` (sin PostGIS en el MVP).
- `@nestjs/config` para variables de entorno (`.env.example`).
- Docker: `backend/Dockerfile` multietapa (deps → build → runtime `node:22-alpine`, usuario no root) y
  `docker-compose.yml` en la raíz (`db` + `api`).

## Estructura
```
backend/src/
├── main.ts                 # prefijo global /api
├── app.module.ts           # ConfigModule + TypeORM (autoLoadEntities)
├── health.controller.ts    # GET /api/health (SELECT 1)
├── common/entidad-base.ts  # id UUID, creado_en, actualizado_en
└── core/
    ├── reporte/      (M1)       entities/, enums/
    ├── triage/       (M2)
    ├── despacho/     (M3 / M4)
    ├── operaciones/  (M4 / M5)
    └── sync/         (MT-1, transversal)
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
```

## Estado del modelo implementado vs. UML oficial (pendiente de alinear)
El Walking Skeleton (PR #1) se creó antes de recibir el diccionario de clases. Diferencias a corregir,
**previa aprobación del PO**:

| Tema | UML / SRS oficial | Implementado |
|---|---|---|
| `EstadoIncidente` | Nuevo, Asignado, En atención, En Liquidación, Cerrado | Reportado, En_Triage, Validado, Despachado, Controlado, Cerrado |
| `NivelRiesgo` | Alto, Medio, Bajo | BAJO, MEDIO, ALTO, CRITICO |
| `EstadoBrigada` | Disponible, En Desplazamiento, En Combate Activo, En Liquidación | Disponible, En_Ruta, En_Operacion, En_Liquidacion, Fuera_De_Servicio |
| `Incidente` | + tipoReporte, justificacionRiesgo, fechaReporte, resultadoCierre; 0..1 Comunidad; 0..1 EvidenciaFotografica; 1 Coordenada (composición) | nivelRiesgo, estado, descripcion, coordenada, reportante |
| `ContactoComunal` | nombreAutoridad, telefono, cargo; compuesto por `Comunidad` (1–1) | nombre, telefono, comunidad (texto) |
| `CartaMunicipal` | + fechaEmision; estadoTramite | archivoDigital, estadoTramite (enum) |
| `Brigada` | + ubicacionActual (Coordenada) | nombre, estadoOperativo |
| `AsignacionDespacho` | fechaAsignacion, rutaSugerida, timestampConfirmacionLlegada | fechaAsignacion, estado |
| `Bitacora` | fecha, nivelAgua, nivelCombustible, herramientasOperativas, kmFajaMitigados, porcentajeControl; 0..* por Incidente | fechaHora, descripcion (texto libre) ligada a AsignacionDespacho |
| `InformeConsolidado` | fechaGeneracion, contenidoPDF, tiempoTotalDespacho, justificacionFalsoPositivo; 0..1 por Incidente | resumen, fechaCierre, hectareasAfectadas; ligado a AsignacionDespacho |
| Clases faltantes | Comunidad, EvidenciaFotografica, Notificacion, HistorialEstado, Usuario (+4 roles, inferencia) | — |

Además, la DoD del Bolt 0 exige el **flujo E2E mínimo** (reporte GPS → riesgo → panel → brigada sugerida →
llegada → ΔT inmutable); hoy solo existe la infraestructura.
