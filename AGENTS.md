# Reglas Globales (AGENTS.md)

Reglas obligatorias para **cualquier agente de IA** (Claude, Gemini u otro) que trabaje en este repositorio.
Fuentes: PRD/SRS (Actividad 2), Álbum UML (Actividad 3), Release Plan y Acta ACTA-002-2026
(resumidos en `documentacion_base/`).

## 1. Proyecto
**Sistema de Apoyo a la Decisión para la Priorización de Brigadas ante Focos de Calor en la Chiquitanía (MVP).**
Objetivo de negocio: **reducir en un 30 % el tiempo de despacho** de brigadas forestales (reporte del foco →
confirmación de llegada), medido contra la línea base histórica de **180 min** (temporada 2024).

Equipo (AI Pod UPDS): Diego Valverde (Product Owner), Jorge Gutierrez (Arquitecto / QA),
Jhonny Pérez (Modelado de procesos y BD). Stakeholder primario: Eddy Chura (Bombero Forestal Departamental,
Gobernación de Santa Cruz).

## 2. Metodología: AI-DLC
- Principio rector: **"la IA propone, el humano aprueba"**. Ninguna decisión de alcance se toma sin el PO.
- El trabajo se ejecuta en **bolts** (ver `documentacion_base/Release_Plan.md`). Un bolt no empieza hasta que el
  anterior del que depende cierra su **Definition of Done** (DoD), anclada a los criterios Gherkin de la SRS.
- No introducir alcance que no esté en la SRS. Todo elemento no explícito se marca como **inferencia** para
  que el equipo lo valide.
- Flujo Git: trabajar en rama → Pull Request → revisión y aprobación del PO → merge a `main`.

## 3. Marco normativo (no negociable)
- **Ley N.º 602 (Gestión de Riesgos), subsidiariedad en 3 niveles:** Comunal → Municipal (UGR) → Departamental
  (Gobernación). La Gobernación actúa en 2.ª/3.ª línea y **solo despacha con una carta formal de solicitud
  municipal** (PDF/imagen liviana).
  - `Incidente` ↔ `CartaMunicipal` es **0..1**: el incidente se registra y mapea sin carta, pero **el despacho
    queda bloqueado** hasta que exista.
  - **Nunca** modelar un despacho civil directo tipo 911 (alucinación ya corregida).
- **Ley N.º 164 (TIC):** neutralidad tecnológica y protección de datos → cifrado en tránsito y reposo, acceso por
  rol (RNF-08). La Ley 164 **no** exige 2G/SMS; eso es una restricción operativa de campo.
- **Ley N.º 300 (Madre Tierra):** uso racional de recursos; no dilapidar combustible público (RS-03).

## 4. Restricciones técnicas duras
| Restricción | Valor | Req. |
|---|---|---|
| Arquitectura | **Offline-first** estricta: persistencia local atómica (SQLite/IndexedDB) + sincronización asíncrona, idempotente y con colas | RNF-01 |
| Red de campo | 2G intermitente; fallback **SMS plano ≤160 caracteres** | RNF-02 |
| Dispositivos | Android 5.0+, **≤1 GB RAM**; consumo de la app **≤120 MB RAM** | RS-01 |
| Sobriedad | Batería <2 % por ciclo de reporte; paquetes **<2 KB** en texto plano; sync de bitácora **<1 KB** | RS-02 |
| Cartografía | **Sin mapas interactivos en línea** ni motores cartográficos propietarios (lógica tipo Avenza Maps) | RF-01 |
| GPS | Coordenada cruda decimal, precisión ≤15 m (sin PostGIS en el MVP) | RF-01 |
| Fotografía | Opcional, comprimida ≤100 KB, con timestamp | RF-03 |
| Motor de riesgo | <5 s incluso con 50+ focos activos | RF-04, RNF-04 |
| Auditoría | Registro **inmutable (append-only)** con timestamps de todo el ciclo de vida | RNF-07 |
| Disponibilidad | Backend ≥99 % en temporada de incendios (mayo–octubre) | RNF-09 |
| VPS / servidor | Recursos reducidos: pools y memoria acotados (ver `backend/CLAUDE.md`) | — |

## 5. Reglas de dominio clave
- Ciclo del incidente: **Nuevo → Asignado → En atención → En Liquidación → Cerrado**.
- Riesgo: **Alto / Medio / Bajo**. "Alto" si el foco está a <5 km de una **comunidad habitada**; las estancias o
  predios privados **se excluyen** de la priorización. Justificación visible obligatoria
  ("Amenaza directa a vida humana comunitaria").
- Reclasificación manual: justificación **≥15 caracteres**, registrada en `HistorialEstado` (append-only).
- Estados de brigada (4): **Disponible, En Desplazamiento, En Combate Activo, En Liquidación**.
  Una brigada "En Liquidación" a <30 km de un foco crítico se sugiere para reasignación táctica.
- **Contacto comunal obligatorio y bloqueante** para el despacho (nombre y teléfono del referente).
- **RS-03:** prohibido el despacho automatizado a ciegas; siempre decide un humano.
- Cierre "Falso positivo" exige justificación obligatoria. El informe consolidado (PDF) es inmutable.
- Bitácora de turno: **checklist**, nunca texto libre (agua, combustible, herramientas, km de faja, % de control).

## 6. Fuera de alcance del MVP
Modelos predictivos complejos del fuego, gestión salarial, predicción meteorológica avanzada, ingesta satelital
automática (NASA FIRMS/VIIRS), inventario de insumos.

## 7. Reparto de agentes
| Carpeta | Agente | Archivo de reglas |
|---|---|---|
| `backend/` | Claude (Arquitecto / Backend) | `backend/CLAUDE.md` |
| `frontend/` | Gemini (Frontend / móvil). **Temporalmente Claude**, por decisión del PO (29/09/2026), hasta que Gemini se incorpore | `frontend/GEMINI.md` |
| `documentacion_base/` | Fuente de verdad (solo lectura para agentes, salvo pedido del PO) | — |
