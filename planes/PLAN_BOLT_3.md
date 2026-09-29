# Plan del Bolt 3 — Release 0.4: Trámite municipal y estados tácticos

> Propuesta de la IA para aprobación del PO (AI-DLC: "la IA propone, el humano aprueba"). Nada de esto se
> implementa hasta que el PO lo apruebe y resuelva las decisiones de la sección 7.

## 1. Alcance según el Release Plan y la SRS

| Elemento | Contenido |
|---|---|
| Historia | **HU-3.1 (completa):** como coordinador del COED de la Gobernación, filtrar los incidentes por trámite municipal formal y ver el estado táctico de las cuadrillas, para priorizar solo los focos legalmente habilitados para el despacho departamental. |
| Requisitos que cierran la DoD | **RF-07** (panel Kanban con filtro de trámite y carta municipal formal), **RF-08** (4 estados de brigada, incluido "En Liquidación"), **RNF-05** (el Kanban se mantiene operable y legible con 50+ incidentes) |
| Casos de uso | CU-07 *Visualizar panel Kanban*, CU-08 *Filtrar por carta municipal formal* («include», Ley 602) y CU-09 *Visualizar estados operativos de brigada* («include») del módulo M3. Actor secundario: **Responsable UGR Municipal**, que carga la carta. |
| Pantalla | Wireframe web "Panel Kanban de Emergencias" (Actividad 3, Figura 9): columnas **Nuevo / Asignado / En atención / En Liquidación**, filtro "Con Carta Municipal", mapa con agrupamiento (*clustering*) y leyenda de brigadas (Disponible, En Desplazamiento, En Combate, En Liquidación). |
| **DoD** | 1) El Kanban **discrimina los focos con carta municipal digitalizada adjunta**. 2) Muestra los **4 estados de brigada**. 3) Permanece **legible con 50 o más incidentes simulados**. |
| Riesgo y mitigación | La UGR municipal aún no tiene un proceso digital para emitir la carta → **adjunto manual (foto o PDF) como contingencia**, mientras se gestiona la integración institucional. |

**Ya existe y se reutiliza:**
- `GET /api/panel` (incidentes por estado y brigadas);
- `CartaMunicipal` 0..1 con su guarda de despacho (Ley 602);
- el enum `EstadoBrigada` con los 4 estados;
- el almacén de archivos cifrados de las fotos (Bolt 1);
- la PWA con pestañas por rol (Bolt 2).

**Hoy la carta es solo una referencia en texto (`archivoDigital`)**: no se adjunta ningún archivo. Tampoco
existe ninguna vía para que una brigada pase a "En Liquidación".

## 2. Backend

### 2.1 Carta municipal digitalizada (RF-07, Ley 602, contingencia del riesgo)
- **Adjuntar el archivo real:** `POST /api/incidentes/:id/carta-municipal` pasa a recibir el **archivo binario**.
  - Formatos: PDF, JPEG, PNG o WebP; el tipo se verifica por su firma de bytes, como las fotos.
  - Cabecera `x-fecha-emision` (AAAA-MM-DD).
  - Tamaño máximo propuesto: 1 MB (ver 7.3).
  - El archivo se guarda **cifrado** en el mismo almacén que las fotos, generalizado a un servicio común `AlmacenArchivosService`.
  - La entidad suma `tipoMime`, `pesoKB` y `sha256`: reenviar el mismo archivo no es un error y la carta sigue siendo 0..1.
  - `archivoDigital` pasa a ser la ruta interna del archivo cifrado (atributo del UML).
- **Quién la carga:**
  - el **Responsable UGR** (flujo normal);
  - el **Coordinador** como contingencia, cuando la carta llega por otro medio (foto por WhatsApp, papel escaneado).
- **Verificación (CU-08, `validar()` del UML):** `POST /api/incidentes/:id/carta-municipal/verificacion`, solo para el Coordinador.
  - Cuerpo: `{ "resultado": "Validada" | "Rechazada", "motivo": "…" }`; el motivo es obligatorio si se rechaza.
  - Queda registrado en el historial append-only.
  - Qué estado de trámite habilita el despacho: ver decisión 7.2.
- **Consulta:** `GET /api/incidentes/:id/carta-municipal/archivo` (Coordinador y UGR) devuelve el documento descifrado.

### 2.2 Estados tácticos de brigada (RF-08)
- **Vínculo Jefe de Brigada ↔ Brigada:** el UML define "JefeBrigada lidera Brigada, 1–1". Se agrega `Brigada.jefe` (Usuario) y la semilla vincula al jefe demo con la Brigada Departamental 3.
- **Reporte del estado táctico:** `POST /api/brigadas/:id/estado`.
  - El **Jefe de Brigada de esa brigada** marca **En Liquidación / Por Finalizar** cuando está en "En Combate Activo" (Acta ACTA-002, acuerdo 4).
  - El **Coordinador** puede **liberarla** (pasa a Disponible) cuando termina.
  - Las demás transiciones siguen saliendo del despacho y de la llegada (Bolts 0 y 4).
  - Las transiciones inválidas responden 409.
  - Todo cambio de estado de brigada queda auditado (ver 2.4).
- **Ciclo del incidente:** cuando la brigada de un incidente pasa a En Liquidación, el incidente pasa de "En atención" a **"En Liquidación"** y queda en el historial. Es la regla del PRD (Nuevo → Asignado → En atención → En Liquidación → Cerrado); el disparador propuesto es una inferencia (ver 7.4).
- La **reasignación táctica** a menos de 30 km **no** entra en este bolt; es del Bolt 4 (HU-4.3).

### 2.3 Panel del COED (HU-3.1, RF-07, RNF-05)
- `GET /api/panel` se amplía **sin romper** a quienes ya lo usan:
  - **Filtros:** `?carta=con|sin|por_validar`, `?riesgo=Alto,Medio` y `?comunidad=…`.
  - **Tarjetas:** estado del trámite (sin carta / por validar / validada / rechazada), comunidad, riesgo y su origen, tiempo desde el reporte, y aviso de falta de contacto comunal.
  - **Contadores por columna:** total y cuántos tienen carta.
  - **Brigadas:** estado operativo, ubicación, jefe y foco asignado.
  - **Orden:** por riesgo y antigüedad.
- **Rendimiento (RNF-05):** una sola consulta con los *joins* necesarios. El descifrado de coordenadas es O(n); con 200 incidentes la respuesta debe quedar por debajo de 1 s, medido en una prueba.

### 2.4 Auditoría
- Cada carga, verificación y rechazo de carta, y cada cambio táctico de brigada, se registra en tablas append-only con quién y cuándo.
- Se propone una tabla `evento_auditoria` con los triggers de inmutabilidad existentes, porque estos eventos no siempre son del ciclo de vida del incidente.

## 3. Frontend
- **Pestaña "Panel COED" (solo Coordinador), según la Figura 9:**
  - Barra de filtros: *Con carta municipal* / *Sin carta* / *Por validar*, más riesgo y búsqueda por comunidad.
  - **4 columnas Kanban** con su contador. Cada tarjeta muestra el foco, su riesgo por color, la comunidad y la insignia de carta (**[Con carta] / [Sin carta] / [Por validar]**). En la columna En Liquidación se ve la brigada y su "% control" cuando exista (Bolt 5).
  - **Legibilidad con 50+ focos (RNF-05):** tarjetas compactas, desplazamiento independiente por columna, "ver más" a partir de 15 por columna y actualización automática cada 30 s sin perder el filtro ni el desplazamiento.
  - **Mapa esquemático con agrupamiento:** focos por color de riesgo y brigadas con los símbolos de la leyenda (* Disponible, ^ En Desplazamiento, # En Combate, ~ En Liquidación). Tecnología: ver decisión 7.1.
  - **Lista de brigadas** con los 4 estados y su conteo.
  - Al tocar una tarjeta se abre el detalle. Ahí se reutiliza la evaluación del Bolt 2, más la carta (ver, **Validar** o **Rechazar** con motivo). El despacho queda para el Bolt 4, aunque las guardas actuales se mantienen.
- **Pestaña "Cartas municipales" (UGR y, como contingencia, Coordinador):**
  - lista de focos activos sin carta o con carta rechazada;
  - adjuntar PDF o foto con la fecha de emisión, con vista previa del peso;
  - si la foto supera el límite, se comprime en el navegador con el mismo compresor del Bolt 1.
- **Jefe de Brigada:** botón **"Reportar: En Liquidación / Por finalizar"** en su vista, solo cuando su brigada está En Combate Activo.
- Todo sigue sin frameworks y con el JavaScript compatible del Bolt 1. El panel es para el COED (web), pero también debe usarse desde un teléfono.

## 4. Pruebas (evidencia de la DoD)
| Nivel | Qué se prueba |
|---|---|
| Unitarias | Reglas de transición de estado de brigada; detección del tipo de archivo de la carta (PDF, imágenes, archivos falsos); armado y filtros del panel. |
| E2E contra PostgreSQL | **DoD 1:** con focos con y sin carta, `?carta=con` devuelve solo los que tienen carta adjunta y `?carta=sin` el resto. La carta se sube, se guarda cifrada y se recupera intacta. Solo UGR y Coordinador la cargan; 0..1 con reenvío idempotente; tamaño, tipo e incidente inexistente se validan. La verificación y el rechazo con motivo quedan auditados, y la carta rechazada bloquea el despacho. **DoD 2:** el panel muestra las 4 brigadas en los 4 estados; el Jefe de Brigada marca su brigada En Liquidación (403 si no es su brigada, 409 si no está En Combate) y el incidente pasa a En Liquidación; el Coordinador la libera. **DoD 3 / RNF-05:** con 60 incidentes simulados el panel responde en menos de 1 s y los contadores coinciden. Además, los 45 e2e actuales siguen en verde. |
| Navegador (Playwright) | Con **60 incidentes simulados**: las 4 columnas se ven sin desbordar la página, los filtros de carta cambian las tarjetas y contadores, y los 4 estados de brigada aparecen en la lista y en el mapa. Se toman capturas a 1366 px (COED) y 360 px (teléfono). La UGR adjunta una foto de carta y la tarjeta pasa a [Por validar]; el coordinador la valida y pasa a [Con carta]. |

## 5. Entregables
- Un PR hacia `main` con backend, frontend, pruebas y documentación (`README.md`, `GUIA_DESARROLLO.md` con las pruebas manuales del Bolt 3, `backend/CLAUDE.md`, `frontend/GEMINI.md` y el estado en el Release Plan).
- Cambio de esquema: `carta_municipal` suma columnas, `brigada` suma `jefe_id` y se crea `evento_auditoria`. Las cartas del Bolt 0, que solo tenían una referencia en texto, quedan marcadas como **"referencia sin archivo"**. **No** hará falta borrar la base.

## 6. Fuera de este bolt
- Despacho en 1 clic desde el panel, notificación Web Push/SMS y reasignación a menos de 30 km (**Bolt 4**).
- Bitácora, % de control e informe consolidado (**Bolt 5**).
- Integración institucional con la UGR (emisión digital de la carta por el municipio): release posterior, según la mitigación del riesgo.
- Modelo de municipios (una UGR solo ve sus focos): no está en la SRS. Por ahora toda UGR ve todos los focos (ver decisión 7.5).

## 7. Decisiones que necesita tomar el PO
1. **Mapa del panel.** El wireframe pide un "mapa con clustering", pero las reglas prohíben motores cartográficos propietarios y mapas en línea (esto último pensado para campo).
   - **Recomendado:** mapa **esquemático propio en SVG** (contorno aproximado de la Chiquitanía, comunidades, focos y brigadas, con agrupamiento por cuadrícula). No usa teselas ni librerías ni red, y funciona sin conexión.
   - Alternativa: Leaflet con teselas de OpenStreetMap. Da más contexto, pero agrega una librería y depende de internet.
2. **Qué habilita el despacho.**
   - **Recomendado:** la carta **Recibida** (adjuntada) ya habilita el despacho, que es lo acordado en el Acta: "prerrequisito legal para habilitar el botón de despacho en un solo clic". El coordinador puede **rechazarla** con motivo y eso lo bloquea.
   - Alternativa: exigir además que el coordinador la valide antes de despachar. Es más estricto, pero agrega un paso en plena emergencia.
3. **Tamaño máximo de la carta.** Se propone **1 MB** ("PDF o imagen liviana", Acta), con compresión automática si es una foto.
4. **Incidente "En Liquidación".** Se propone que el incidente pase a En Liquidación cuando su brigada reporta En Liquidación [inferencia]. ¿Se acepta, o prefieren que lo marque el coordinador a mano?
5. **Alcance de la UGR.** Sin un modelo de municipios, cualquier usuario UGR ve y adjunta cartas de cualquier foco. ¿Se acepta para el MVP, o hay que modelar municipios (sería alcance nuevo)?
