# Plan del Bolt 2 — Release 0.3: Motor de riesgo y gobernanza algorítmica

> Propuesta de la IA para aprobación del PO (AI-DLC: "la IA propone, el humano aprueba"). Nada de esto se
> implementa hasta que el PO lo apruebe y resuelva las decisiones de la sección 6.

## 1. Alcance según el Release Plan y la SRS

| Elemento | Contenido |
|---|---|
| Historias | **HU-2.1 (completa)**: motor de riesgo que prioriza la vida humana comunitaria y excluye estancias privadas, con justificación visible. **HU-2.2**: reclasificación manual con justificación obligatoria y trazable. |
| Requisitos que cierran la DoD | **RF-05** (explicabilidad algorítmica), **RF-06** (reclasificación con justificación), **RS-03** (sin despacho a ciegas; justificación obligatoria) |
| Casos de uso | CU-05 *Calcular nivel de riesgo automático* y CU-06 *Reclasificar riesgo manualmente* («extend») del módulo M2 (`core.triage`) |
| Pantalla | Wireframe web "Evaluación de riesgo" (Actividad 3, Figura 8), para el Coordinador de Despacho |
| **DoD** | 1) Todo foco de prioridad **Alta** muestra la justificación "Amenaza directa a vida humana comunitaria". 2) Las **estancias privadas quedan excluidas** de la priorización automática. 3) Se **bloquea** toda reclasificación con justificación de **menos de 15 caracteres**. |
| Riesgo y mitigación | Falsos negativos en zonas de uso mixto → probar el motor con coordenadas **reales** de comunidades y estancias de Santa Cruz. |

Ya existe desde el Bolt 0 y se reutiliza: `MotorRiesgoService` (regla única <5 km ⇒ Alto), el catálogo de
comunidades, `HistorialEstado` append-only con usuario, el guard de roles y la app web (PWA).

## 2. Backend

### 2.1 Motor de riesgo completo (HU-2.1, RF-04, RF-05, RNF-04)
Archivo: `backend/src/core/triage/motor-riesgo.service.ts` (función pura, sin acceso a BD).

- **Reglas, en orden, sobre la comunidad habitada más cercana:**
  | Distancia a la comunidad habitada más cercana | Nivel | Justificación |
  |---|---|---|
  | < 5 km | **Alto** | `Amenaza directa a vida humana comunitaria: <comunidad> a <d> km` (texto exacto de la SRS) |
  | 5 a < 15 km *(umbral propuesto, ver 6.1)* | **Medio** | `Comunidad habitada en el área de influencia: <comunidad> a <d> km` |
  | ≥ 15 km o sin comunidades | **Bajo** | `Sin comunidad habitada a menos de 15 km (más cercana: …)` |
- **Estancias y predios privados (exclusión explícita):** nuevo catálogo `PredioPrivado`. El motor lo evalúa
  **solo para explicar la exclusión**: un foco cerca de una estancia pero lejos de comunidades **no sube de
  prioridad**, y la justificación lo dice ("Estancia <nombre> a <d> km: excluida de la priorización automática").
  Nunca se usa para elevar el nivel.
- **Explicabilidad (RF-05):** el motor devuelve, además del nivel, los **factores evaluados**, que se guardan en
  el incidente como JSON (`factores_riesgo`):
  - versión de las reglas (p. ej. `motor-v2`);
  - regla aplicada y umbrales vigentes;
  - comunidad más cercana y su distancia;
  - estancias cercanas excluidas;
  - tiempo de cálculo en ms (evidencia de RNF-04).
- Umbrales en constantes documentadas (no en BD), para que cualquier cambio pase por revisión.

### 2.2 Catálogo de predios privados (inferencia de modelo)
- Entidad nueva `PredioPrivado` en `core.reporte`: `nombre`, `coordenadas` (embebidas, en claro como el resto
  del catálogo), `tipo` (`Estancia`).
  - **[inferencia]** El UML no la tiene como clase, pero la SRS exige excluir estancias explícitamente; sin un
    catálogo de ellas la exclusión no es verificable.
- Endpoints (Coordinador):
  - `GET /api/predios-privados`
  - `POST /api/predios-privados`
- La semilla trae algunas estancias **ficticias** cerca de las comunidades de ejemplo, solo para probar. Las
  reales se cargan con datos del PO y de Eddy Chura (mitigación del riesgo del bolt).

### 2.3 Reclasificación manual (HU-2.2, RF-06, RS-03)
- `POST /api/incidentes/:id/reclasificacion` (solo **Coordinador**), con cuerpo
  `{ "nivelRiesgo": "Alto|Medio|Bajo", "justificacion": "…" }`.
- **Validaciones:**
  - justificación de **15 a 500 caracteres**, sin contar espacios al inicio ni al final (400 si no cumple);
  - el nivel debe ser distinto del actual;
  - el incidente no puede estar "Cerrado".
- **Transacción con bloqueo de fila:**
  1. actualiza `nivelRiesgo` y marca `origenRiesgo = Manual`;
  2. conserva intactos la justificación y los factores del algoritmo, para seguir mostrando ambos;
  3. inserta la entrada de auditoría.
- **Auditoría append-only (RNF-07):** `HistorialEstado` suma `tipoEvento` (`CambioEstado` | `Reclasificacion`),
  `nivelAnterior` y `nivelNuevo`. Registra **quién, cuándo y el motivo**, como exige la HU-2.2. Los triggers
  actuales ya impiden editar o borrar estas entradas.
- **Efecto en el despacho (RS-03):** bajar de Alto a Bajo bloquea el despacho departamental; subir de Bajo a
  Medio o Alto lo habilita, siempre por decisión humana justificada. Las guardas del Bolt 0 (carta municipal,
  contacto comunal) siguen igual.

### 2.4 Consulta para la pantalla de evaluación
- `GET /api/incidentes/:id/evaluacion` (Coordinador) devuelve:
  - nivel actual y su origen (Motor o Manual);
  - justificación algorítmica y factores;
  - comunidad más cercana y distancia;
  - estancias excluidas;
  - historial de reclasificaciones con quién, cuándo y motivo.
- Para la lista de focos se reutiliza `GET /api/panel`, que ya existe. El tablero Kanban completo es del Bolt 3.

## 3. Frontend (app web del coordinador, Figura 8)
- La misma PWA, con vista según rol: el **Coordinador** ve una pestaña **"Evaluación de riesgo"**; el
  guardaparque sigue viendo solo "Reportar".
- **Lista de focos activos**, ordenada por riesgo, con una insignia de color (Alto/Medio/Bajo) y la marca
  "Reclasificado" cuando corresponde.
- **Detalle del foco:**
  - riesgo calculado;
  - distancia a la comunidad;
  - justificación del algoritmo;
  - factores evaluados, incluidas las estancias excluidas.
- **"Reclasificar manualmente":**
  - opciones Alto/Medio/Bajo;
  - texto de justificación con contador `n/15 car.`;
  - el botón **Guardar** queda **desactivado** hasta llegar a 15 caracteres y elegir un nivel distinto (la API
    valida lo mismo);
  - debajo, el historial de reclasificaciones.
- Mismas restricciones que el Bolt 1: sin frameworks, JavaScript compatible con navegadores antiguos y
  diseño adaptable (el wireframe es web, pero debe usarse también desde un teléfono).

## 4. Pruebas (evidencia de la DoD)
| Nivel | Qué se prueba |
|---|---|
| Unitarias del motor | Alto a <5 km con el texto exacto; Medio en la franja propuesta; Bajo lejos o sin catálogo; foco junto a una estancia y lejos de comunidades que **no** sube de nivel y menciona la exclusión; comunidad y estancia cercanas a la vez (prevalece la comunidad); factores completos; RNF-04 con 50+ focos y catálogo grande. |
| E2E contra PostgreSQL | DoD 1: todo incidente Alto trae la justificación exacta. DoD 2: foco en una estancia no queda Alto. DoD 3: reclasificación con 14 caracteres → 400; con 15 → 200. Solo el Coordinador puede reclasificar (403 para el resto). El historial registra quién, cuándo, motivo y niveles, y la BD rechaza editarlo. Reclasificar de Bajo a Alto habilita el despacho; de Alto a Bajo lo bloquea. Las 34 pruebas e2e actuales siguen en verde. |
| Navegador (Playwright) | El Coordinador entra, ve la lista, abre un foco, el botón Guardar sigue desactivado con 14 caracteres, guarda con 15 o más, y el nuevo nivel y el historial se muestran. El guardaparque no ve la pestaña. |
| Riesgo del bolt | Una prueba con un conjunto de coordenadas reales de comunidades y estancias, en cuanto el PO las entregue (hasta entonces, con datos de ejemplo marcados como tales). |

## 5. Entregables y documentación
- Un PR hacia `main` con backend, frontend, pruebas y la actualización de `backend/CLAUDE.md`,
  `frontend/GEMINI.md`, `README.md`, `GUIA_DESARROLLO.md` (pruebas manuales del Bolt 2) y el estado en
  `documentacion_base/Release_Plan.md`.
- Cambio de esquema: columnas nuevas y tabla `predio_privado`, todas compatibles con los datos existentes (se
  agregan como nulas). **No** hará falta borrar la base.

## 6. Decisiones que necesita tomar el PO
1. **Umbral de "Medio".** La SRS solo define Alto (<5 km). Se propone **Medio entre 5 y 15 km** de una
   comunidad habitada y Bajo de 15 km en adelante [inferencia]. ¿Se acepta o se prefiere otro valor?
2. **Bioma como factor.** La matriz de trazabilidad original menciona "distancia a población y **bioma**" como
   variables visibles (RF-05), pero no hay datos de bioma en el alcance. Se propone **diferirlo** y mostrar solo
   los factores que el sistema realmente evalúa. ¿Se acepta?
3. **Datos reales para la mitigación del riesgo.** Para probar contra falsos negativos hace falta una lista de
   comunidades y estancias reales de la Chiquitanía (nombre y coordenadas). ¿El equipo la puede conseguir con
   Eddy Chura? Mientras tanto se usan datos de ejemplo.
4. **Cierre del Bolt 1.** Según el AI-DLC, un bolt no empieza hasta que su dependencia cierra la DoD. El Bolt 2
   depende del **Bolt 0 (cerrado)**, no del Bolt 1, así que puede empezar aunque el Bolt 1 siga esperando sus
   tareas de campo.
