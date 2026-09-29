# Release Plan — Fase de Construction (AI-DLC)

> Transcripción resumida del **Release Plan** (15/09/2026). Cubre los 24 requisitos (14 RF, 7 RNF, 3 RS) y las
> 14 historias de usuario de la SRS, sin introducir alcance nuevo. Cada bolt es un release incremental ejecutado
> en *Mob Construction*: **la IA propone el plan detallado del bolt y el equipo humano aprueba su alcance**.

## 1. Criterios de priorización
- **Valor E2E antes que profundidad:** el primer bolt ejercita el flujo completo de los 5 CU en versión mínima
  (walking skeleton) para exponer errores de integración entre módulos.
- **Corregir alucinaciones primero:** Ley 602, contacto comunal, bitácora y estados tácticos antes que refinamientos cosméticos.
- **Riesgo técnico temprano:** red y offline (RNF-01, RNF-02) se adelantan porque condicionan toda la arquitectura.
- **Sostenibilidad integrada:** cada RS va en el bolt de su caso de uso.

## 2. Dependencias
| Bolt / Release | Depende de | Motivo |
|---|---|---|
| Bolt 0 (0.1) | — | Valida la arquitectura de microsistema |
| Bolt 1 (0.2) | Bolt 0 | Extiende la captura (HU-1.1) del skeleton |
| Bolt 2 (0.3) | Bolt 0 | Refina el motor de riesgo (RF-04) mínimo |
| Bolt 3 (0.4) | Bolt 0, Bolt 2 | El filtro de trámite necesita panel y nivel de riesgo |
| Bolt 4 (0.5) | Bolt 3 | La reasignación exige los 4 estados de brigada |
| Bolt 5 (0.6) | Bolt 1, Bolt 4 | Bitácora e informe dependen del contacto comunal y del despacho |
| Release 1.0 | Bolt 0–5 | Consolidación y hardening para el piloto |

## 3. Visión general
| Release | Objetivo | Ventana | CU |
|---|---|---|---|
| 0.1 | Walking Skeleton: flujo E2E mínimo | 17–18 sep 2026 | CU1–CU5 (mínimo) |
| 0.2 | Captura resiliente y contacto comunal | 19–20 sep 2026 | CU1 completo |
| 0.3 | Motor de riesgo y gobernanza algorítmica | 21–22 sep 2026 | CU2 completo |
| 0.4 | Trámite municipal y estados tácticos | 23–24 sep 2026 | CU3 completo |
| 0.5 | Despacho y reasignación táctica | 25–26 sep 2026 | CU4 completo |
| 0.6 | Bitácora y cierre institucional | 27–28 sep 2026 | CU5 completo |
| 1.0 | MVP piloto operativo (consolidación) | 29–30 sep 2026 | CU1–CU5 hardening |

> Ventanas de 2 días por bolt (tabla 4.1 del PDF, confirmado por el PO). Las fechas son orientativas;
> lo que manda es el cierre de la DoD de cada bolt. El Release 1.0 debe estar antes de la temporada de
> incendios 2027 (mayo–octubre).

## 4. Detalle por bolt

### Bolt 0 — Release 0.1: Walking Skeleton
- **HU:** HU-1.1 (parcial: captura GPS), HU-2.1 (parcial: riesgo básico), HU-3.1 (parcial: panel mínimo), HU-4.1, HU-5.1, HU-5.3.
- **Requisitos:** RF-01, RF-04, RF-09, RF-14, RNF-01, RNF-04, RNF-07 (7).
- **DoD:** un foco reportado con GPS recorre **Nuevo → riesgo calculado → visible en panel → brigada sugerida →
  llegada confirmada → tiempo total calculado** sin intervención manual en la BD, y **ΔT se registra de forma inmutable**.
- **Riesgo / mitigación:** subestimar el motor de riesgo → una sola regla (distancia a comunidad); exclusión de
  predios y explicabilidad se difieren al Bolt 2.

### Bolt 1 — Release 0.2: Captura resiliente y contacto comunal
- **HU:** HU-1.1 (completa: foto ultracomprimida), HU-1.2, HU-1.3, HU-1.4.
- **Requisitos:** RF-02, RF-03, RNF-02, RNF-08, RS-01 (5).
- **DoD:** reporte sin datos se transmite por SMS <160 car.; el catálogo de contactos comunales bloquea el
  despacho si está vacío; RAM ≤120 MB en dispositivo de referencia de 1 GB.
- **Riesgo:** catálogo offline desactualizado → validarlo con Eddy Chura antes del cierre.

### Bolt 2 — Release 0.3: Motor de riesgo y gobernanza algorítmica
- **HU:** HU-2.1 (completa), HU-2.2. **Requisitos:** RF-05, RF-06, RS-03 (3).
- **DoD:** justificación "Amenaza directa a vida humana comunitaria" en cada foco Alto; estancias privadas
  excluidas; reclasificación bloqueada con justificación <15 caracteres.
- **Riesgo:** falsos negativos en zonas mixtas → probar con coordenadas reales de comunidades y estancias de Santa Cruz.

### Bolt 3 — Release 0.4: Trámite municipal y estados tácticos
- **HU:** HU-3.1 (completa). **Requisitos:** RF-07, RF-08, RNF-05 (3).
- **DoD:** Kanban discrimina focos con carta municipal digitalizada; muestra los 4 estados de brigada
  (Disponible, En Desplazamiento, En Combate Activo, En Liquidación); legible con 50+ incidentes simulados.
- **Riesgo:** la UGR no tiene proceso digital para la carta → adjunto manual (foto/PDF) como contingencia.

### Bolt 4 — Release 0.5: Despacho y reasignación táctica
- **HU:** HU-4.2, HU-4.3. **Requisitos:** RF-10, RF-11 (2).
- **DoD:** la brigada asignada recibe Web Push o SMS con ubicación y contacto comunal; una brigada "En
  Liquidación" a <30 km de un foco crítico se sugiere y despacha en 1 clic sin duplicar la asignación.
- **Riesgo:** doble despacho → **bloqueo optimista** sobre el estado de brigada en BD.

### Bolt 5 — Release 0.6: Bitácora y cierre institucional
- **HU:** HU-5.2, HU-5.4. **Requisitos:** RF-12, RF-13, RS-02 (3).
- **DoD:** checklist persiste localmente con timestamp y sincroniza <1 KB; informe consolidado en PDF inmutable
  en 1 clic; justificación obligatoria en cierres "Falso positivo".
- **Riesgo:** baja alfabetización digital → prueba de usabilidad con Eddy Chura; checklist con mínimos toques.

### Release 1.0 — MVP piloto operativo
- Sin HU nuevas: regresión completa de las 14. **Requisitos:** RNF-09 (1).
- **DoD:** disponibilidad ≥99 % durante el piloto; los 24 requisitos pasan su evidencia de prueba; línea base
  de campo para contrastar el 30 %.
- **Riesgo:** muestra insuficiente → extender el piloto o simular con datos históricos 2024.

## 5. Matriz de cobertura
| Release | Requisitos | # |
|---|---|---|
| 0.1 (Bolt 0) | RF-01, RF-04, RF-09, RF-14, RNF-01, RNF-04, RNF-07 | 7 |
| 0.2 (Bolt 1) | RF-02, RF-03, RNF-02, RNF-08, RS-01 | 5 |
| 0.3 (Bolt 2) | RF-05, RF-06, RS-03 | 3 |
| 0.4 (Bolt 3) | RF-07, RF-08, RNF-05 | 3 |
| 0.5 (Bolt 4) | RF-10, RF-11 | 2 |
| 0.6 (Bolt 5) | RF-12, RF-13, RS-02 | 3 |
| 1.0 (Piloto) | RNF-09 | 1 |
| **Total** | 14 RF + 7 RNF + 3 RS | **24** |

## 6. Estado de ejecución
| Bolt | Estado | Notas |
|---|---|---|
| Bolt 0 | 🟢 Cerrado (29/09/2026) | DoD verificada sobre `main` (`b8833cf`): infraestructura (PR #1), modelo alineado al UML + semilla (PR #3) y flujo E2E con auditoría append-only (PR #4). Evidencia: `npm run build` OK; `npm test` 9/9; `npm run test:e2e` 17/17 (RF-01, RF-04, RF-09, RF-14, RNF-01, RNF-04, RNF-07); recorrido manual por HTTP Nuevo → Alto → panel → sugerencia → carta → Asignado → En atención con ΔT = 90 min (ahorro 50 % vs. 180 min); la BD rechaza UPDATE sobre `historial_estado` y sobre `timestamp_confirmacion_llegada`. |
| Bolt 1 | 🟡 En revisión del PO | Backend + app web (PWA) del CU-01 por Claude (decisión del PO: sin Gemini por ahora). HU-1.1 (foto ≤100 KB cifrada), HU-1.2 (avistamiento a distancia), HU-1.3 (SMS `BRC1` ≤160 con pasarela simulada; sin proveedor contratado), HU-1.4 (catálogo comunal offline; despacho bloqueado sin referente), RNF-08 (usuarios con rol y cifrado AES-256-GCM en reposo), RS-01/RS-02. Pendiente de campo: medir RAM en el Android de 1 GB de referencia y validar el catálogo comunal con Eddy Chura (riesgo del bolt). |
| Bolt 2–5, 1.0 | ⚪ No iniciado | — |
