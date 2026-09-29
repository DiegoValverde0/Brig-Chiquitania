# Plan del Bolt 5 — Release 0.6: Bitácora y cierre institucional

> Propuesta de la IA para aprobación del PO (AI-DLC: "la IA propone, el humano aprueba"). Nada de esto se
> implementa hasta que el PO lo apruebe y resuelva las decisiones de la sección 7.

## 1. Alcance según el Release Plan y la SRS

| Elemento | Contenido |
|---|---|
| Historias | **HU-5.2:** bitácora por checklist offline (agua Suficiente/Crítica; combustible OK/Reserva; herramientas operativas; km de faja; % de control); persiste en el teléfono y encola una sincronización <1 KB. **HU-5.4:** informe consolidado en 1 clic: compila las bitácoras en un PDF inmutable; exige justificación si el cierre es "Falso positivo". |
| Requisitos | **RF-12** (bitácora de turno con checklist; reemplaza WhatsApp), **RF-13** (consolidación automática del informe técnico final), **RS-02** (paquetes <2 KB; bitácora <1 KB). También se tocan RF-14, RNF-01, RNF-07 y RS-03. |
| Casos de uso | CU-05 *Bitácora y cierre*, del módulo M5: CU-15 *Registrar bitácora por checklist* y CU-17 *Generar informe consolidado*. CU-14 (llegada) y CU-16 (ΔT) ya existen. FE-1: "Falso positivo" exige justificación. Post: incidente "Cerrado", informe inmutable. |
| **DoD** | 1) El checklist **persiste localmente con timestamp** y se sincroniza en **<1 KB**. 2) **Informe consolidado en PDF inmutable en 1 clic**. 3) **Justificación obligatoria** en cierres "Falso positivo". |
| Riesgo y mitigación | Baja alfabetización digital → **prueba de usabilidad con Eddy Chura**; checklist con los mínimos toques. |

**Ya existe y se reutiliza:**
- Cola offline-first de reportes (IndexedDB, UUID del teléfono, idempotencia).
- Canal SMS `BRC1` con pasarela simulada.
- Llegada con GPS y ΔT vs. 180 min (`tiempoDespacho`).
- Historial append-only y `evento_auditoria`.
- Almacén de archivos cifrados (fotos y cartas).
- "Mi brigada" y el detalle del foco del coordinador.
- `ResultadoCierre` (Controlado, Extendido, Falso_Positivo).

**Deuda del Bolt 0 que se corrige:** las entidades `Bitacora` (texto libre) e `InformeConsolidado` (resumen,
hectáreas) no siguen el UML y nunca se usaron (tablas vacías). Se reemplazan por las del diccionario de clases.
AGENTS.md: "Bitácora de turno: **checklist**, nunca texto libre".

## 2. Backend

### 2.1 Bitácora de turno (HU-5.2, RF-12, CU-15)
- **Entidad `Bitacora` (UML):**
  - `fecha` (timestamp del teléfono, nunca en el futuro);
  - `nivelAgua` (Suficiente | Critica) y `nivelCombustible` (OK | Reserva);
  - `herramientasOperativas` (sí/no);
  - `kmFajaMitigados` (0–500, un decimal) y `porcentajeControl` (0–100);
  - relación 0..* con `Incidente`, más la brigada y el usuario que la registró [inferencia].
  - Sin campos de texto libre.
- **`POST /api/incidentes/:id/bitacoras`** (Jefe de Brigada de la brigada asignada a ese foco):
  - **idempotente por UUID del teléfono** (201 nueva / 200 reintento), como los reportes;
  - solo mientras el foco está "En atención" o "En Liquidación" (después de la llegada y antes del cierre);
  - el `porcentajeControl` no puede bajar respecto de la última bitácora del foco [inferencia; ver 7.4].
- **Inmutable una vez sincronizada (UML):** trigger append-only, como `historial_estado`.
- **RS-02:** el JSON de una bitácora mide ~250 bytes. Una prueba verifica que el paquete real sea <1 KB.
- **Canal SMS de respaldo (decisión 7.5):** formato `BRC1 B <foco> <id> <agua S|C> <comb O|R> <herr 1|0> <km> <%> <hora>`,
  de unos 80 caracteres, procesado por el mismo webhook que los reportes.
- **Consulta:** `GET /api/incidentes/:id/bitacoras` (Coordinador y jefe de esa brigada). El panel muestra el último
  **% de control** en las tarjetas "En atención" y "En Liquidación" (pendiente anotado en el Bolt 3).

### 2.2 Cierre del incidente e informe consolidado (HU-5.4, RF-13, CU-17)
- **`POST /api/incidentes/:id/cierre`** (Coordinador; UML: `generarInformeConsolidado`). Cuerpo:
  `{ resultado: Controlado | Extendido | Falso_Positivo, justificacion? }`.
  - **FE-1 (DoD 3):** "Falso_Positivo" exige una justificación de 15 a 500 caracteres; si no, 400. Para los otros
    resultados la justificación es opcional.
  - Estados desde los que se cierra: ver decisión 7.2.
  - **En una transacción:**
    - el foco pasa a **"Cerrado"** con `resultadoCierre` e historial;
    - la brigada se libera según la decisión 7.3;
    - se genera el PDF y se guarda.
  - **1 clic:** la respuesta trae el enlace de descarga.
- **Entidad `InformeConsolidado` (UML), 0..1 por incidente:**
  - `fechaGeneracion`, `tiempoTotalDespacho` (ΔT en minutos; null si nunca hubo llegada);
  - `justificacionFalsoPositivo`;
  - `contenidoPDF` = ruta del archivo cifrado en el almacén, más su `sha256` y peso [inferencia].
- **Inmutable (RNF-07):** trigger que rechaza UPDATE y DELETE. Un segundo cierre responde 409. El PDF nunca se
  regenera; su SHA-256 se muestra para verificar la integridad.
- **Contenido del PDF**, en una o dos páginas, en español:
  - datos del foco y del reporte (GPS o distancia, comunidad, referente comunal);
  - riesgo con la explicación del motor y las reclasificaciones con su justificación;
  - carta municipal (estado y fecha de emisión);
  - despacho y reasignaciones (brigadas, horas, ruta);
  - llegada, **ΔT y % de ahorro vs. 180 min**;
  - **tabla de todas las bitácoras**, con evolución del % de control y km de faja;
  - notificaciones (canal y estado);
  - resultado del cierre y su justificación;
  - SHA-256 del documento y fecha de generación.
- **Generador de PDF propio** (decisión 7.1): PDF 1.4 de texto con fuente Helvetica estándar y codificación
  WinAnsi (tildes y ñ), sin librerías, con salto de página. Mismo criterio que el cifrado y Web Push: sin
  dependencias.
- **Descarga:** `GET /api/incidentes/:id/informe` (metadatos) y `GET /api/incidentes/:id/informe.pdf` (descifrado).
  Acceso: ver decisión 7.6.
- **`GET /api/informes`:** lista de focos cerrados con su resultado, ΔT y fecha (para consultar después del cierre,
  porque los cerrados salen del panel).

### 2.3 Auditoría y KPI
- Cierre, bitácora e informe quedan en el historial y en `evento_auditoria`.
- Los cierres "Falso positivo" quedan listados con su justificación (RS-03: "auditoría de falsas alarmas").
- El resumen de `/api/informes` trae el **ΔT promedio y el % de focos que cumplen la meta del 30 %** sobre los
  cerrados, como insumo para la línea base de campo de la Release 1.0 [inferencia].

## 3. Frontend
- **"Mi brigada" → Bitácora de turno** (jefe; offline-first):
  - checklist de **pocos toques y botones grandes**:
    - Agua: **Suficiente / Crítica**;
    - Combustible: **OK / Reserva**;
    - Herramientas: **Operativas / Con fallas**;
    - km de faja con botones **−/+** (paso 0,5);
    - % de control en pasos de 10 con controles segmentados, más ajuste fino;
  - se precarga con los valores de la bitácora anterior: solo se cambia lo que varió;
  - **GUARDAR BITÁCORA:** primero se guarda en IndexedDB con su hora; luego se sincroniza sola al volver la señal y
    muestra "En cola / Enviada";
  - sin datos, muestra el SMS `BRC1 B` de ≤160 caracteres, como los reportes;
  - la lista de bitácoras del turno queda visible en el teléfono.
- **Detalle del foco (coordinador) → "Cerrar incidente":**
  - resultado segmentado (Controlado / Extendido / Falso positivo);
  - justificación obligatoria con contador si es Falso positivo; el botón queda desactivado hasta cumplir 15
    caracteres;
  - resumen de las bitácoras, ΔT y % de control;
  - **CERRAR Y GENERAR INFORME** (con confirmación) descarga el PDF.
- **Pestaña o lista "Informes":** focos cerrados con descarga del PDF y su SHA-256.
- **Panel:** % de control en las tarjetas "En atención" y "En Liquidación".
- Todo en el JavaScript compatible con Android 5 y con las reglas visuales de `frontend/GEMINI.md`.

## 4. Pruebas (evidencia de la DoD)
| Nivel | Qué se prueba |
|---|---|
| Unitarias | Generador de PDF: estructura válida (`%PDF-1.4`, xref, trailer, `%%EOF`), tildes y ñ, salto de página, texto largo. Validación del checklist (rangos, enums, sin texto libre, % que no baja). Codec `BRC1 B` ≤160 e ida y vuelta. Armado del contenido del informe. |
| E2E contra PostgreSQL | **DoD 1:** bitácora con UUID: reintento = 200 sin duplicar; el payload real mide <1 KB; UPDATE/DELETE rechazados; solo el jefe de esa brigada y solo En atención / En Liquidación; por SMS simulado también. **DoD 2:** cierre en 1 clic → foco Cerrado, brigada liberada (7.3), informe con SHA-256; el PDF descargado empieza con `%PDF`, contiene el ΔT y las bitácoras; segundo cierre 409; UPDATE/DELETE del informe rechazados; el SHA-256 coincide. **DoD 3:** Falso positivo sin justificación o con 14 caracteres → 400; con 15 → 201 y queda en el informe y en la auditoría. Los 80 e2e actuales siguen en verde. |
| Navegador (Playwright) | El jefe llena la bitácora **sin conexión** (en cola, sobrevive a recargar) y se sincroniza sola al volver la señal. El coordinador cierra con "Falso positivo" (botón bloqueado con 14 caracteres) y con "Controlado", y descarga el PDF (se verifica `%PDF` y el texto). Capturas a 360 y 1366 px. |
| Campo (riesgo del bolt) | Prueba de usabilidad del checklist con Eddy Chura: tiempo por bitácora y número de toques. |

## 5. Entregables
- Un PR hacia `main` con backend, frontend, pruebas y documentación (README, `GUIA_DESARROLLO.md` con las pruebas
  manuales del Bolt 5, `backend/CLAUDE.md`, `frontend/GEMINI.md` y el estado en el Release Plan).
- **Cambio de esquema:** `bitacora` e `informe_consolidado` se reemplazan por las del UML (estaban vacías, sin
  pérdida de datos) y se agrega el valor `Cierre` en `tipo_evento` si hace falta. No hace falta borrar la base.

## 6. Fuera de este bolt
- Inventario de insumos, gestión salarial y predicción del fuego (fuera del MVP, AGENTS §6).
- Firma digital del informe con certificado institucional (release posterior). En el MVP la integridad se prueba con
  el SHA-256 y la inmutabilidad en la BD.
- Reabrir un foco cerrado (decisión 7.2 del Bolt 4: los cerrados no se reabren).
- Regresión completa de las 14 HU y piloto (**Release 1.0**).

## 7. Decisiones que necesita tomar el PO
1. **Cómo se genera el PDF.**
   - **Recomendado:** generador propio mínimo (PDF de texto, sin librerías; liviano para el VPS y sin dependencias
     nuevas).
   - Alternativa: una librería como `pdfkit` (más formato, pero ~2 MB y otra dependencia).
2. **Desde qué estados se cierra.**
   - **Recomendado:** "Controlado" y "Extendido" desde **En atención o En Liquidación** (hubo llegada); "Falso
     positivo" desde **cualquier estado activo** (incluso Nuevo, si se descarta sin despachar), siempre con
     justificación.
   - Pregunta: ¿qué significa exactamente "Extendido" para el COED? Se propone "el foco superó la capacidad
     departamental y se escala" [inferencia].
3. **Brigada al cerrar.**
   - **Recomendado:** si la brigada sigue ligada a ese foco, pasa a **Disponible** automáticamente al cerrar.
   - Alternativa: seguir liberándola a mano.
4. **% de control que baja.**
   - **Recomendado:** se acepta que baje (un rebrote puede reducirlo), pero se marca en el informe.
   - Alternativa: rechazarlo.
5. **Bitácora por SMS.**
   - **Recomendado:** sí, con el formato `BRC1 B` (≈80 caracteres), porque el campo es 2G.
   - Alternativa: solo por datos, con la cola offline.
6. **Quién descarga el informe.**
   - **Recomendado:** Coordinador y Responsable UGR (la municipalidad que pidió la ayuda, Ley 602).
   - Alternativa: solo el Coordinador.
