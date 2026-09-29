# Plan del Bolt 4 — Release 0.5: Despacho y reasignación táctica

> Propuesta de la IA para aprobación del PO (AI-DLC: "la IA propone, el humano aprueba"). El PO respondió las
> decisiones el 29/09/2026 (sección 7) y el plan ya las incorpora. Falta su aprobación final para implementar.

## 1. Alcance según el Release Plan y la SRS

| Elemento | Contenido |
|---|---|
| Historias | **HU-4.2:** notificación Web Push o SMS (ubicación, ruta y contacto comunal); el foco pasa a "Asignado" con cronómetro inmutable. **HU-4.3:** reasignación táctica: una brigada "En Liquidación" a menos de 30 km de un foco crítico reactivado se sugiere y se despacha en 1 clic, con aviso por SMS. |
| Requisitos | **RF-10** (despacho en 1 clic y reasignación en campo con timestamp inmutable), **RF-11** (notificación dual: Web Push con respaldo SMS). También se tocan RF-08, RNF-02 y RS-03. |
| Casos de uso | CU-04 *Despachar brigada*, del módulo M4: CU-10 *Sugerir brigada* (ya existe), CU-11 *Asignar y despachar*, CU-12 *Notificar al jefe de brigada* y CU-13 *Reasignar brigada en liquidación* («extend»). |
| **DoD** | 1) La brigada asignada recibe **Web Push o SMS** con la ubicación y el contacto comunal. 2) Una brigada "En Liquidación" a menos de 30 km de un foco crítico **se sugiere y se despacha en 1 clic sin duplicar la asignación**. |
| Riesgo y mitigación | Doble despacho → **bloqueo optimista** sobre el estado de la brigada en la BD. |

**Ya existe y se reutiliza:**
- Sugerencia por cercanía (`GET /incidentes/:id/brigadas-sugeridas`).
- Despacho confirmado con sus guardas: Ley 602, contacto comunal, riesgo Alto/Medio y brigada Disponible, con un UPDATE condicional.
- `fecha_asignacion` y la llegada write-once.
- Pasarela SMS simulada (`SmsService.enviar`, con normalización a 160 caracteres y bitácora cifrada).
- `Usuario.telefono` cifrado.
- Vínculo jefe ↔ brigada y los 4 estados tácticos (Bolt 3).

**Lo que falta:**
- Hoy el despacho solo se hace por API: no hay botón en el panel.
- No se notifica a nadie.
- Una brigada "En Liquidación" nunca se sugiere.
- La entidad `Notificacion` del UML no existe.

## 2. Backend

### 2.1 Despacho en 1 clic sin duplicar (RF-10, riesgo del bolt)
- **Bloqueo optimista:** `Brigada` suma una columna de versión (`@VersionColumn`).
  - El panel y la sugerencia devuelven la versión de cada brigada.
  - El despacho la envía (`{ brigadaId, versionBrigada }`), y el UPDATE exige esa misma versión además del estado elegible.
  - Si otro coordinador la despachó o la brigada cambió de estado entre medio, la respuesta es **409** "la brigada cambió, actualice el panel".
- **Idempotencia del clic:** el cliente genera el UUID de la asignación (`{ id, brigadaId, versionBrigada }`), igual que los reportes.
  - Un doble clic, un reintento por red o dos pestañas no crean una segunda asignación: la API devuelve la orden ya creada (200).
- **Timestamp inmutable:** `fecha_asignacion` pasa a ser write-once con trigger, igual que la llegada. Es el cronómetro de HU-4.2.
- **"Ruta":** no hay motor de rutas (sin mapas en línea) y el MVP no lo incluye.
  - Se propone llenar `rutaSugerida` (atributo del UML) con **rumbo y distancia en línea recta** desde la brigada, más las coordenadas del foco. Ejemplo: "165 km al NE".
  - Decisión 7.3 del PO: aprobado.

### 2.2 Reactivación de focos (decisión 7.2 del PO)
Un **foco reactivado** es un foco que estaba controlado y vuelve a ser riesgoso o de alto impacto, lo que reordena
la prioridad.
- **Quién lo reactiva:** el **Coordinador**, con `POST /api/incidentes/:id/reactivacion` y
  `{ "justificacion": "…" }` de 15 a 500 caracteres (la misma regla que la reclasificación).
  - Solo desde **"En Liquidación"**; desde cualquier otro estado responde 409.
  - Los focos **Cerrados no se reabren**, porque su informe es inmutable (Bolt 5).
- **Efecto:** en una transacción con bloqueo de fila:
  - el foco vuelve a **"Nuevo"** con riesgo **Alto**, `origenRiesgo` Manual y la marca **"Reactivado"**
    (`reactivadoEn` y el contador `reactivaciones`) [inferencia de atributos];
  - queda en `historial_estado` con el nuevo `tipoEvento` **Reactivacion** (quién, cuándo, motivo y niveles);
  - la brigada que lo liquidaba no cambia de estado (sigue "En Liquidación") y queda como candidata a la
    reasignación (2.3).
- **Aviso (sin decidir solo, RS-03):** cuando llega un reporte nuevo a **menos de 2 km** de un foco
  "En Liquidación", la respuesta del reporte y la tarjeta del panel marcan ese foco como **"Posible reactivación"**.
  - Se reutiliza `distanciaKm` de `common/geo.ts` en la aplicación, porque las coordenadas están cifradas.
  - El sistema nunca cambia el estado por su cuenta: la reactivación siempre la confirma el coordinador.
- **Prioridad:** `ordenarTarjetas` (`despacho/panel.ts`) pone **primero los reactivados**, luego el orden por
  riesgo y, a igual riesgo, el reporte más antiguo.
- La carta municipal y el contacto comunal del foco siguen vigentes (relación 0..1): no se piden de nuevo.

### 2.3 Reasignación táctica (HU-4.3, CU-13, Acta ACTA-002 acuerdo 4)
- **Sugerencia:** para un foco **Alto** en "Nuevo", la sugerencia suma las brigadas **"En Liquidación" a menos de 30 km**, marcadas como `reasignacion: true` y con el foco que dejan.
  - Se muestran **primero**: el Acta quiere evitar enviar unidades desde la capital (300 km) si hay una cuadrilla vecina liberándose.
  - Las Disponibles siguen ordenadas por cercanía.
  - "Foco crítico" = foco **Alto en "Nuevo"**; los **reactivados** (2.2) encabezan la lista del panel. La
    brigada que liquidaba el mismo foco reactivado también se sugiere, a 0 km.
- **Despacho:** el mismo endpoint y el mismo clic. El UPDATE condicional acepta `Disponible` **o** `En_Liquidacion` (esta última solo a menos de 30 km de un foco Alto), siempre con la versión esperada.
  - La brigada pasa a "En Desplazamiento".
  - El foco anterior **se queda en "En Liquidación"** y conserva su asignación histórica; el cierre es del Bolt 5.
  - En el historial de ambos focos queda "Reasignación táctica: <brigada> de FOCO-A a FOCO-B".
  - Se audita en `evento_auditoria`.
- **RS-03:** nunca se reasigna sola; siempre la confirma el coordinador.

### 2.4 Notificación dual (RF-11, HU-4.2, CU-12)
- **Entidad `Notificacion`** (UML: `canal`, `contenido`, `estadoEnvio`; relación 1..* con `AsignacionDespacho`).
  - Estados: `Pendiente`, `Enviada`, `Fallida` y `Leida` [inferencia].
  - Contenido cifrado en reposo.
- **Web Push (canal 1):**
  - La app del jefe de brigada se suscribe (`POST /api/notificaciones/suscripcion`, con claves VAPID).
  - El envío implementa el estándar Web Push (VAPID + cifrado `aes128gcm`) **con `node:crypto`, sin librerías nuevas**, como se hizo con el cifrado y el SMS.
  - El service worker muestra la notificación, y al tocarla se abre "Mi brigada" con la orden.
- **SMS (canal 2, respaldo):**
  - Mensaje de ≤160 caracteres al `telefono` del jefe, por la pasarela actual (simulada mientras no haya proveedor).
  - Ejemplo: `DESPACHO F-ab12cd34 Alto -16.11530,-62.02580 165km NE. Ref: J.Perez 70012345 Corregidor`.
  - Cuándo se envía (decisión 7.1): si el jefe no tiene suscripción, si el push falla o si no se lee en 3 minutos.
- **Acuse de recibo:** al abrir la orden en la app, la notificación pasa a `Leida`. El panel muestra 📨 enviada, ✔ leída o ⚠ fallida en la tarjeta del foco.
- **Sin jefe o sin teléfono (decisión 7.4):** el despacho **se bloquea** con 422 "la brigada no tiene jefe con
  teléfono registrado", como las demás guardas. El panel desactiva DESPACHAR con ese motivo y la sugerencia marca
  esa brigada como no despachable. La semilla asigna jefe y teléfono a las 4 brigadas demo [inferencia de datos de
  ejemplo].
- **Asincronía:** la notificación se envía **después** de confirmar la transacción. Si el proveedor falla, el despacho no se revierte: la notificación queda `Fallida` y se reintenta una vez.

### 2.5 Auditoría
- Despacho, reasignación y cada intento de notificación (canal y resultado) quedan en `historial_estado` o en `evento_auditoria`, ambos append-only.

## 3. Frontend
- **Panel COED:** las tarjetas de "Nuevo" con riesgo Alto/Medio muestran la brigada sugerida y el botón **DESPACHAR**.
  - Un clic abre una confirmación con la brigada, la distancia, el contacto comunal y la ruta (RS-03: decide un humano; "1 clic" = una confirmación, sin formularios).
  - Si la sugerencia es una reasignación, se ve como **"Reasignar ~ Brigada 3 (12 km, en liquidación de FOCO-…)"**.
  - Si falta la carta o el contacto, el botón sale desactivado con el motivo.
  - Tras despachar, la tarjeta pasa a "Asignado" con su estado de notificación.
- **Reactivación:** en el detalle del foco (evaluación), el botón **REACTIVAR FOCO** pide una justificación de al
  menos 15 caracteres, con contador. Solo aparece si el foco está En Liquidación.
  - Las tarjetas muestran **"⟳ Reactivado"** (primero en su columna) y **"Posible reactivación"**.
- **Mi brigada (jefe):**
  - Pide permiso para notificaciones y se suscribe a Web Push.
  - Muestra la **orden de salida**: coordenadas, ruta, contacto comunal con botón para llamar y el cronómetro desde la asignación.
  - Agrega **CONFIRMAR LLEGADA** con GPS: el endpoint ya existe, falta la pantalla.
- **Service worker:** evento `push` y apertura de la orden al tocar la notificación.
- Sin frameworks, con el mismo JavaScript compatible con Android 5.

## 4. Pruebas (evidencia de la DoD)
| Nivel | Qué se prueba |
|---|---|
| Unitarias | Mensaje SMS de despacho ≤160 caracteres (GSM-7, contacto y coordenadas). Rumbo y distancia de la ruta. Regla de elegibilidad (Disponible, o En Liquidación a menos de 30 km de un foco Alto). Cifrado Web Push `aes128gcm` y firma VAPID contra los vectores de prueba del RFC 8291. |
| E2E contra PostgreSQL | **DoD 1:** al despachar se crea la `Notificacion`. Sin suscripción, el SMS sale por la pasarela simulada con coordenadas y contacto (se verifica en la bandeja). Con suscripción, el push llega a un **servicio de push falso local**. Un push fallido cae al SMS. **DoD 2:** una brigada En Liquidación a 12 km se sugiere primero para un foco Alto y a 40 km no. Se despacha y el foco anterior queda En Liquidación. **Reactivación:** desde En Liquidación pasa a Nuevo, Alto y primero en su columna, con historial; 409 desde otros estados o si está Cerrado; 400 con menos de 15 caracteres; 403 si no es Coordinador; un reporte a menos de 2 km marca "Posible reactivación" sin cambiar el estado; la brigada que lo liquidaba se sugiere para reasignarla. **Guarda de jefe:** 422 si la brigada no tiene jefe o el jefe no tiene teléfono. **Sin duplicar:** 10 despachos concurrentes de la misma brigada dan exactamente 1 asignación; la versión vieja da 409; reintentar con el mismo id da 200 con la misma orden. `fecha_asignacion` no se puede modificar. Los 64 e2e actuales siguen en verde. |
| Navegador (Playwright) | El coordinador despacha en 1 clic desde el panel y la tarjeta pasa a Asignado con "📨". El jefe (otro contexto) recibe la orden en Mi brigada, que queda "Leida", y confirma la llegada. Reactivación del foco por el coordinador y reasignación de la brigada en liquidación en 1 clic. Doble clic en DESPACHAR → una sola asignación. Capturas a 1366 y 360 px. |

## 5. Entregables
- Un PR hacia `main` con backend, frontend, pruebas y documentación (README, `GUIA_DESARROLLO.md` con las pruebas manuales del Bolt 4, `backend/CLAUDE.md`, `frontend/GEMINI.md` y el estado en el Release Plan).
- Configuración nueva: `VAPID_PUBLICA`, `VAPID_PRIVADA` y `VAPID_CONTACTO`. En desarrollo se generan solas; en producción son obligatorias. Web Push exige HTTPS en el VPS (ya anotado en `nginx.conf`).
- Cambio de esquema: tablas `notificacion` y `suscripcion_push`; columnas `brigada.version`,
  `incidente.reactivado_en` e `incidente.reactivaciones`; el valor `Reactivacion` en el enum `tipo_evento`; y
  `asignacion_despacho.id` generado por el cliente. No hace falta borrar la base.

## 6. Fuera de este bolt
- Bitácora de turno, % de control, cierre e informe consolidado en PDF (**Bolt 5**).
- Motor de rutas por caminos o mapas en línea (prohibidos por RF-01; el MVP no los incluye).
- Proveedor SMS real y su contrato: la pasarela sigue simulada hasta que el equipo lo contrate.
- Cancelar o deshacer un despacho: no está en la SRS. Se puede proponer en un bolt posterior si el PO lo pide.

## 7. Decisiones del PO (29/09/2026)
1. **SMS de respaldo:** Web Push primero; SMS si el jefe no tiene suscripción, si el push falla o si no se lee en
   3 minutos.
2. **Foco reactivado:** un foco que estaba controlado y vuelve a ser riesgoso o de alto impacto, lo que reordena
   la prioridad. Aclaraciones del PO:
   - lo reactiva el **coordinador** con justificación; el sistema solo **avisa** cuando llega un reporte a menos
     de 2 km;
   - solo se reactivan focos **En Liquidación**, que vuelven a **Nuevo** con riesgo Alto y la marca "Reactivado",
     primeros en su columna;
   - los Cerrados no se reabren.
   Ver 2.2.
3. **Ruta:** rumbo y distancia en línea recta, más las coordenadas del foco.
4. **Brigada sin jefe o sin teléfono:** se acepta la alternativa: **el despacho se bloquea** hasta que la brigada
   tenga un jefe con teléfono. Ver 2.4.
5. **Foco anterior al reasignar:** queda en "En Liquidación", sin brigada activa, hasta su cierre en el Bolt 5.
