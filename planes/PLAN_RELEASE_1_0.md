# Plan de la Release 1.0 — MVP piloto operativo

> Propuesta de la IA para aprobación del PO (AI-DLC: "la IA propone, el humano aprueba"). Nada de esto se
> implementa hasta que el PO lo apruebe y resuelva las decisiones de la sección 8.

## 1. Alcance según el Release Plan

| Elemento | Contenido |
|---|---|
| Historias | **Ninguna nueva:** regresión completa de las 14 HU. |
| Requisito | **RNF-09:** backend disponible ≥99 % en temporada de incendios (mayo–octubre); se mide con monitoreo de uptime. |
| **DoD** | 1) **Disponibilidad ≥99 %** durante el piloto. 2) **Los 24 requisitos pasan su evidencia de prueba** (14 RF + 7 RNF + 3 RS). 3) **Línea base de campo** para contrastar la meta del 30 % frente a los 180 min de 2024. |
| Riesgo y mitigación | Muestra insuficiente → extender el piloto o simular con datos históricos de 2024. |

**Punto de partida (29/09/2026):**
- Bolts 0 a 5 fusionados en `main`.
- 76 pruebas unitarias, 94 e2e y 18 pasos de navegador en verde.
- La imagen Docker ya fue validada en local por el PO.

**Lo que falta para un piloto real** lo dejaron anotado los bolts anteriores: es de dos tipos, **de ingeniería**
(migraciones, HTTPS, respaldos, monitoreo, CI, proveedor SMS) y **de campo** (teléfono de 1 GB, 2G real,
usabilidad, datos reales).

## 2. Regresión y evidencia de los 24 requisitos (DoD 2)
- **Matriz de evidencia** `documentacion_base/Matriz_Evidencia.md`: para cada uno de los 24 requisitos (y las 14 HU),
  la prueba automatizada que lo cubre y la evidencia de campo que pide la matriz de trazabilidad de la SRS
  ("Evidencia QA").
  - Los requisitos que solo se prueban en campo quedan marcados como tales: RS-01 en el emulador y el teléfono
    de 1 GB, RS-02 con el perfilador de batería, RNF-02 con un módem GSM y señal degradada, RNF-09 con el
    monitoreo.
- **`npm run regresion`** (script nuevo): corre unitarias, e2e y navegador, y genera
  `documentacion_base/Informe_Regresion.md` con el estado ✅/❌ de cada requisito.
  - Toma las IDs (RF-xx, RNF-xx, RS-xx, HU-x.x) que ya están en los nombres de las pruebas; se completan las que
    falten.
  - El informe lleva la fecha y el commit, y es el anexo de evidencia del proyecto.
- **Pruebas que faltan** para cerrar huecos de la matriz:
  - **RF-01:** captura en ≤2 s;
  - **RNF-01:** corte de enlace prolongado con varias entradas en cola, reportes y bitácoras;
  - **RS-02:** paquetes reales <2 KB en todos los endpoints de campo;
  - **RNF-08:** checklist de seguridad automatizado (rutas sin token → 401, matriz rol × ruta, campos cifrados en
    la BD).
- **Integración continua:** workflow de GitHub Actions en cada PR:
  - unitarias;
  - e2e con un servicio PostgreSQL;
  - navegador con Chromium;
  - `docker build` de la imagen.
  - Un PR en rojo no se fusiona.

## 3. Preparación para producción (VPS)
- **Migraciones:** migración inicial de TypeORM desde el esquema actual (triggers de auditoría incluidos).
  - En producción, `DB_SYNCHRONIZE=false` y `migration:run` al arrancar el contenedor.
  - También se elimina la advertencia de `pg` de la semilla, que venía del `synchronize` (Bolt 4).
- **HTTPS (RNF-08, "cifrado en tránsito"):** TLS con certificado de Let's Encrypt y renovación automática, delante del
  servicio `web` (ver decisión 8.2).
  - Sin HTTPS no funcionan la geolocalización ni Web Push en los teléfonos.
- **Respaldos:**
  - `pg_dump` diario más el almacén de archivos cifrados, con retención de 14 días, copiados fuera del VPS;
  - **restauración probada** en una prueba (una copia que nunca se restauró no es un respaldo);
  - custodia documentada de `CLAVE_CIFRADO` y de las claves VAPID: sin ellas los datos no se descifran.
- **Endurecimiento:**
  - límite de intentos con token inválido (freno a la fuerza bruta) [inferencia];
  - cabeceras de seguridad y límites de tamaño revisados;
  - `npm audit` sin vulnerabilidades altas;
  - usuarios demo imposibles en producción (ya es así; se agrega una prueba);
  - logs con rotación dentro de los límites de memoria del VPS.
- **Disponibilidad (RNF-09):**
  - `healthcheck` del contenedor `api` en `docker-compose`, reinicio automático, arranque ordenado (la API espera
    a la BD);
  - endpoint `/api/health` ampliado con versión y tiempo en marcha.

## 4. Monitoreo y disponibilidad (DoD 1)
- **Monitor externo** de `/api/health` cada 1 a 5 minutos (ver decisión 8.3), con alerta por correo o
  Telegram al equipo.
- **Informe mensual de disponibilidad** con la fórmula de RNF-09: minutos arriba / minutos totales ≥ 99 %.
  - En un mes, el 99 % admite unas 7 horas caídas en total.
  - Las ventanas de mantenimiento anunciadas se registran aparte, pero cuentan igual.
- **Runbook de incidentes:**
  - qué revisar (contenedores, disco, memoria, certificado);
  - cómo restaurar un respaldo;
  - a quién avisar;
  - cómo seguir operando si cae el backend: los teléfonos guardan en cola y existe el canal SMS.

## 5. Canal SMS real (RNF-02 y RF-11)
La pasarela sigue simulada desde el Bolt 1. Para la evidencia de RNF-02 ("módem GSM con señal degradada") hace
falta un canal real. Se implementa una subclase de `PasarelaSms` para la opción elegida (decisión 8.4), con:
- webhook de entrada;
- reintentos;
- pruebas con el servidor falso, como en Web Push.

## 6. Piloto y línea base de campo (DoD 3)
- **Datos reales antes del piloto:**
  - catálogo de comunidades y referentes validado con Eddy Chura (pendiente del Bolt 1);
  - estancias reales (Bolt 2);
  - brigadas, jefes y teléfonos reales, cargados con `crear-usuario` y `PUT /brigadas/:id/jefe`.
- **Capacitación:**
  - manual corto por rol (guardaparque, jefe de brigada, UGR, coordinador), imprimible y en español llano;
  - una sesión práctica por rol.
- **Pruebas de campo pendientes de los bolts:**
  - RAM y batería en el Android de 1 GB (RS-01, RS-02);
  - usabilidad del checklist con Eddy Chura (Bolt 5): tiempo y toques por bitácora;
  - proceso real de la carta con una UGR (Bolt 3);
  - Web Push en un teléfono real con HTTPS (Bolt 4);
  - confirmar qué significa "Extendido" con el COED (Bolt 5).
- **Línea base:**
  - el KPI sale de `GET /api/informes` (ΔT por incidente cerrado con llegada), con exportación a CSV;
  - el informe de cierre del piloto compara el ΔT medio y la mediana contra los 180 min, e indica el % de
    incidentes que cumplen la meta del 30 % y el tamaño de la muestra.
- **Si la muestra no alcanza (riesgo):** se amplía el piloto o se hace un **ejercicio de simulación** con el COED,
  que reproduce incidentes históricos de 2024 en un entorno de ensayo (decisión 8.5). Los resultados simulados se
  informan **separados** de los reales; nunca se mezclan.

## 7. Entregables
- PR(s) hacia `main`:
  - **R1 (ingeniería):** migraciones, CI, HTTPS, respaldos, endurecimiento, monitoreo y `npm run regresion`.
  - **R2 (canal SMS real):** según la decisión 8.4.
- Documentos:
  - `Matriz_Evidencia.md` e `Informe_Regresion.md`;
  - runbook de operación (despliegue, respaldo y restauración, rotación de claves, incidentes);
  - manuales por rol;
  - informe de disponibilidad;
  - informe de línea base del piloto.
- Release Plan: Release 1.0 en 🟡 durante el piloto y 🟢 al cumplir las tres condiciones de la DoD, con aprobación
  del PO.

## 8. Decisiones que necesita tomar el PO
1. **Ventana del piloto.** La temporada termina en octubre y hoy es 29/09/2026.
   - **Recomendado:** un **piloto técnico controlado en octubre de 2026** (con el COED y una o dos brigadas), más la
     simulación con datos de 2024 para validar la medición. El piloto completo, con la medición de RNF-09 en toda la
     temporada, iría en **mayo–octubre de 2027**.
   - Alternativa: esperar a mayo de 2027 para todo.
2. **VPS y dominio.** Hacen falta un VPS de 1–2 GB y un dominio (o subdominio de la Gobernación) para HTTPS.
   ¿Quién lo provee y cuál es el dominio? Recomendación técnica: nginx con certificado de Let's Encrypt
   (sin costo).
3. **Monitoreo de disponibilidad.**
   - **Recomendado:** un servicio externo gratuito (p. ej. UptimeRobot) que solo consulta `/api/health` (no ve
     datos), más el informe mensual.
   - Alternativa: monitoreo propio en otro servidor.
4. **Canal SMS para el piloto.**
   - **Recomendado:** un **teléfono Android como pasarela SMS** (app de gateway con API HTTP): barato, 2G real y sin
     contrato.
   - Alternativas: un proveedor comercial (contrato con operador) o seguir con el simulado (RNF-02 quedaría sin
     evidencia de campo).
5. **Muestra mínima para la línea base.**
   - **Recomendado:** al menos **20 incidentes cerrados con llegada** en el piloto real. Si no se alcanza, se
     completa con el ejercicio de simulación de 2024, informado aparte.
   - ¿El equipo tiene acceso a los registros de despacho de 2024 (horas de reporte y llegada)?
6. **Datos reales y responsables.** ¿Quién entrega el catálogo validado de comunidades, referentes, estancias,
   brigadas y jefes, y para qué fecha? Propuesta: Eddy Chura con Jhonny Pérez, antes del inicio del piloto.
