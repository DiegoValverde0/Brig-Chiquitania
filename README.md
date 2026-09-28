# Brig-Chiquitania

Sistema de Apoyo a la Decisión para la Priorización de Brigadas ante Focos de Calor en la Chiquitanía (MVP).
Reglas del proyecto: [`AGENTS.md`](AGENTS.md). Backend: [`backend/CLAUDE.md`](backend/CLAUDE.md).
Documentación de referencia: [`documentacion_base/`](documentacion_base/).

## Walking Skeleton (Bolt 0 / Release 0.1)

```bash
docker compose up -d --build                  # PostgreSQL 16 + API en http://localhost:3000/api
docker compose exec api node dist/seed        # comunidades, contactos y brigadas de ejemplo
sh backend/scripts/flujo-e2e.sh               # recorre el flujo completo con curl
```

El script recorre la DoD del Bolt 0: reporte GPS → **Nuevo** con riesgo calculado → panel → brigada sugerida →
carta municipal (Ley 602) → despacho confirmado por un humano → llegada → **ΔT** y % de ahorro frente a 180 min,
con el historial append-only.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/api/incidentes` | Reporte GPS idempotente por UUID del cliente (201 nuevo / 200 reintento) |
| `GET` | `/api/panel` | Incidentes activos por estado y brigadas con su estado |
| `POST` | `/api/incidentes/:id/carta-municipal` | Registro de la carta municipal (0..1) |
| `GET` | `/api/incidentes/:id/brigadas-sugeridas` | Brigadas Disponibles por cercanía (solo riesgo Alto/Medio) |
| `POST` | `/api/incidentes/:id/asignaciones` | Despacho confirmado (exige carta y contacto comunal) |
| `POST` | `/api/asignaciones/:id/llegada` | Confirmación de llegada (write-once) |
| `GET` | `/api/incidentes/:id/tiempo-despacho` | ΔT, % de ahorro y cumplimiento de la meta del 30 % |
| `GET` | `/api/incidentes/:id/historial` | Historial de estados (append-only) |

Pruebas (desde `backend/`): `npm test` (unitarias) y `npm run test:e2e` (requiere PostgreSQL; crea y vacía la BD
`chiquitania_test`).
