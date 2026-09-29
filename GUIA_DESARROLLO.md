# Guía de despliegue en desarrollo y pruebas

Pasos para levantar el MVP en una máquina de desarrollo con Docker, cargar datos de ejemplo y verificar todo
lo construido hasta el **Bolt 5** (Walking Skeleton, captura resiliente y contacto comunal, motor de riesgo y
gobernanza algorítmica, trámite municipal y estados tácticos, despacho y reasignación táctica, bitácora y cierre
institucional).

> Todos los comandos se ejecutan desde la raíz del repositorio, salvo que se indique otra carpeta.
> En Windows, usar PowerShell. Los scripts del proyecto son de Node (`.mjs`): no hace falta bash, WSL ni Git Bash.
> Los `curl` de ejemplo están escritos para Bash; en PowerShell escribir `curl.exe`.

---

## 1. Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Git | cualquiera reciente | clonar el repositorio |
| Docker Desktop / Docker Engine con **Compose v2** | 24+ | levantar PostgreSQL, la API y la app web |
| Node.js | **22** | solo para ejecutar las pruebas automatizadas fuera de Docker |
| Google Chrome o Chromium | reciente | usar la app y ejecutar la prueba del navegador |

Puertos libres: **5432** (PostgreSQL), **3000** (API) y **8080** (app web).

```bash
git clone https://github.com/DiegoValverde0/Brig-Chiquitania.git
cd Brig-Chiquitania
git pull origin main
```

---

## 2. Levantar el entorno

### 2.1 Primera vez (o después de actualizar desde el Bolt 0)

El Bolt 1 cambió columnas a formato cifrado. Si ya existía una base de datos del Bolt 0, hay que borrarla
(solo contiene datos de prueba):

```bash
docker compose down -v          # detiene los contenedores y BORRA los volúmenes (BD y fotos)
```

### 2.2 Construir y arrancar

```bash
docker compose up -d --build
docker compose ps               # db (healthy), api y web deben figurar "running"/"Up"
```

| Servicio | Contenedor | URL |
|---|---|---|
| PostgreSQL 16 | `chiquitania_db` | `localhost:5432` (usuario `chiquitania`, clave `chiquitania_dev`, BD `chiquitania_db`) |
| API NestJS | `chiquitania_api` | <http://localhost:3000/api> |
| App web (nginx) | `chiquitania_web` | <http://localhost:8080> |

Comprobar que la API responde y alcanza la base de datos:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","db":"up"}
```

### 2.3 Cargar datos de ejemplo (semilla)

```bash
docker compose exec api node dist/seed
```

Crea (es idempotente, se puede ejecutar varias veces):
- 7 comunidades de la Chiquitanía con su referente comunal (datos ficticios, coordenadas aproximadas).
- 4 brigadas (dos en Santa Cruz de la Sierra, una en San Ignacio de Velasco y una en San José de Chiquitos), todas
  **Disponibles** y cada una con su jefe demo con teléfono (sin jefe con teléfono no se despacha, Bolt 4).
- 2 estancias **ficticias** para probar la exclusión de predios privados del motor de riesgo (Bolt 2).
- 7 usuarios demo. **Sus códigos son públicos: solo para desarrollo.**

| Rol | Código de acceso |
|---|---|
| Guardaparque / Comunario | `demo-guardaparque` |
| Coordinador de Despacho (COED) | `demo-coordinador` |
| Jefe de Brigada (Brigada Departamental 3) | `demo-jefe-brigada` |
| Jefes de las brigadas 1, 2 y 4 | `demo-jefe-1`, `demo-jefe-2`, `demo-jefe-4` |
| Responsable UGR Municipal | `demo-ugr` |

### 2.4 Comandos útiles

```bash
docker compose logs -f api                      # ver el log de la API
docker compose restart api                      # reiniciar la API
docker compose exec db psql -U chiquitania -d chiquitania_db   # consola SQL
docker compose stop                             # detener (conserva los datos)
docker compose down                             # detener y borrar contenedores (conserva los volúmenes)
docker compose down -v                          # detener y BORRAR todo, incluidos datos y fotos
```

Crear un usuario adicional (se muestra su código una sola vez):

```bash
docker compose exec api node dist/crear-usuario "Nombre Apellido" Guardaparque +59170011122
# roles: Guardaparque | Coordinador | JefeBrigada | ResponsableUGR
```

---

## 3. Pruebas manuales en la app web

Abrir <http://localhost:8080> en Chrome.

### 3.1 Reporte con GPS (HU-1.1)

1. Ingresar con `demo-guardaparque`.
2. La computadora rara vez tiene GPS con precisión ≤15 m. Para simularlo:
   Chrome → `F12` → menú ⋮ → **More tools → Sensors** → *Location*: **Other…** con
   latitud `-16.1153` y longitud `-62.0258` (unos 2 km de Concepción).
3. Pulsar **📍 Capturar coordenadas GPS**. Debe aparecer `✔ Lat… Lon… (±… m)` y, debajo, el
   **contacto comunal autocompletado** (Concepción).
   - Si Chrome reporta una precisión mayor a 15 m, la app no acepta la lectura (así lo exige RF-01). En ese
     caso, usar el reporte a distancia (3.2).
4. Opcional: **📷 Adjuntar foto** con cualquier imagen. Se comprime a ≤100 KB en el propio navegador.
5. **ENVIAR REPORTE**. En *Mis reportes* aparece "Recibido" con **Riesgo Alto** y el contacto comunal.

### 3.2 Reporte a distancia (HU-1.2)

1. Elegir **Lo veo a la distancia**.
2. Comunidad: *Concepción*; rumbo: *Este*; distancia: `4`.
3. Se muestra la comunidad más cercana y su referente. **ENVIAR REPORTE** → "Recibido", riesgo Alto.

### 3.3 Sin conexión y canal SMS (RNF-01, HU-1.3)

- **Opción A (sin red real):** Chrome `F12` → pestaña **Network** → *No throttling* → **Offline**.
  1. Enviar un reporte: queda **"En cola"** y se muestra el **SMS `BRC1`** (≤160 caracteres).
  2. Recargar la página (`F5`): la app abre igual sin red y el reporte sigue guardado.
  3. Volver a **No throttling** (online): el reporte pasa solo a **"Recibido"**.
- **Opción B (simulador SMS):** en **Ajustes** marcar *Simular falta de datos*, enviar un reporte y pulsar
  **Simular envío SMS** → queda "Recibido por SMS". Desmarcar la opción al terminar.

> Si la app muestra una versión anterior tras actualizar el código: `F12` → **Application → Service workers →
> Unregister** y recargar con `Ctrl+Shift+R`.

### 3.4 Flujo del coordinador por API (Bolt 0 con roles)

La interfaz del coordinador llega en los próximos bolts; mientras tanto, el flujo completo se recorre con
un script de Node (sin bash ni curl; funciona igual en PowerShell):

```bash
node backend/scripts/flujo-e2e.mjs
# 1) Reporte GPS … 5) Despacho … 6) Llegada: ΔT = 60 min, ahorro 66.7 % vs. 180 min … 7) Historial
```

Si ya se ejecutó varias veces y no quedan brigadas disponibles, volver a correr la semilla
(`docker compose exec api node dist/seed`), que las devuelve a "Disponible".

Consultas sueltas de ejemplo:

```bash
C="Authorization: Bearer demo-coordinador"
curl -H "$C" http://localhost:3000/api/panel                      # incidentes por estado y brigadas
curl -H "$C" http://localhost:3000/api/sms/mensajes               # bandeja de la pasarela SMS simulada
curl -H "Authorization: Bearer demo-guardaparque" http://localhost:3000/api/panel   # 403: rol no autorizado
```

Enviar un SMS como lo haría el proveedor (webhook):

```bash
curl -X POST http://localhost:3000/api/sms/entrante \
  -H 'x-sms-secreto: secreto-sms-solo-desarrollo' -H 'Content-Type: application/json' \
  -d '{"de":"+59171234567","texto":"hola"}'
# {"estado":"Rechazado", … "respuesta":"BRC1 ERR El SMS no empieza con BRC1. …"}
```

### 3.5 Verificar el cifrado en reposo (RNF-08)

```bash
docker compose exec db psql -U chiquitania -d chiquitania_db \
  -c "SELECT latitud, longitud FROM incidente LIMIT 2;" \
  -c "SELECT nombre_autoridad, telefono FROM contacto_comunal LIMIT 2;"
# Los valores deben verse como v1:xxxx:yyyy:zzzz (cifrados), no en claro.
```

### 3.6 Evaluación y reclasificación del riesgo (Bolt 2)

1. Como guardaparque, enviar un reporte **a distancia**: comunidad *Concepción*, rumbo *Norte*, `10` km.
   Debe quedar con riesgo **Medio** ("Comunidad habitada en el área de influencia…").
2. Cerrar sesión (**Ajustes → Cerrar sesión**) e ingresar con `demo-coordinador`. Aparecen las pestañas
   **Reportar** y **Evaluación de riesgo** (el guardaparque no las ve).
3. En **Evaluación de riesgo**, abrir el foco. Se ven:
   - el riesgo vigente;
   - la distancia a la comunidad;
   - la justificación del algoritmo;
   - en *Factores evaluados por el motor*: la regla aplicada, los umbrales (Alto <5 km, Medio <15 km), las
     estancias excluidas y la versión del motor.
4. Elegir **Alto** y escribir una justificación de 14 caracteres: el contador marca `14/15 car.` y el botón
   **GUARDAR RECLASIFICACIÓN** sigue desactivado (DoD 3). Con 15 o más caracteres se activa. Al guardar, el
   riesgo pasa a Alto "(reclasificado manualmente)" y el **historial** muestra quién, cuándo, niveles y motivo.

Exclusión de estancias (DoD 2), por API: un foco junto a la estancia de ejemplo *El Porvenir*, lejos de toda
comunidad, queda **Bajo** y lo explica:

```bash
G="Authorization: Bearer demo-guardaparque"
curl -X POST http://localhost:3000/api/incidentes -H "$G" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$(node -e 'console.log(crypto.randomUUID())')\",\"latitud\":-16.547,\"longitud\":-61.75,\"precisionMetros\":5}"
# "nivelRiesgo":"Bajo", "justificacionRiesgo":"Sin comunidad habitada a menos de 15 km (…). Excluido de la
#  priorización automática: Estancia El Porvenir (ejemplo) a 0.33 km"
```

Cargar estancias reales (coordinador): `POST /api/predios-privados` con `{"nombre":"…","latitud":…,"longitud":…}`.

### 3.7 Carta municipal, panel COED y estados de brigada (Bolt 3)

Actualizar desde el Bolt 2: `docker compose up -d --build` y volver a aplicar la semilla (agrega la 4.ª brigada y
asigna el jefe demo a la Brigada 3). No hace falta borrar la base: las columnas nuevas se crean solas y las cartas
anteriores quedan como "referencia sin archivo".

1. **Focos de ejemplo.** Como guardaparque, enviar 3 o 4 reportes cerca de distintas comunidades (o usar el
   bucle de abajo para generar 60).
2. **Carta de la UGR (CU-08).** Ingresar con `demo-ugr`: se ven las pestañas **Reportar** y **Cartas**. En
   **Cartas** aparecen los focos sin carta. Elegir un PDF o una foto de la carta (una foto de varios MB se
   comprime sola a ≤1 MB), revisar la fecha de emisión y tocar **ADJUNTAR CARTA**: queda "por validar" y el foco
   sale de la lista.
3. **Panel COED (HU-3.1).** Ingresar con `demo-coordinador`, pestaña **Panel COED**:
   - 4 columnas (Nuevo, Asignado, En atención, En liquidación) con "total · con carta";
   - el filtro **Con carta** muestra solo las tarjetas con insignia *Por validar* o *Con carta*; **Sin carta**,
     el resto; **Por validar**, las que esperan revisión;
   - el mapa esquemático agrupa los focos por zona y muestra las brigadas con `*` `^` `#` `~`;
   - el panel se actualiza solo cada 30 s sin perder el filtro.
4. **Validar o rechazar.** Tocar una tarjeta: se abre su evaluación con la sección **Carta municipal**.
   **Ver documento** muestra la imagen (o el enlace al PDF). **VALIDAR CARTA** la deja en *Con carta*. Para
   rechazar, el motivo exige 15 caracteres; una carta rechazada bloquea el despacho y el foco vuelve a la
   bandeja de la UGR con el motivo.
5. **Estados tácticos (RF-08).** Despachar la Brigada 3 a un foco con carta y confirmar la llegada (el script
   `backend/scripts/flujo-e2e.mjs` lo hace por API). Ingresar con `demo-jefe-brigada` → pestaña **Mi brigada**:
   aparece "En combate activo" y el botón **Reportar: EN LIQUIDACIÓN / POR FINALIZAR**. Al confirmarlo, la
   brigada y su foco pasan a En liquidación. En el panel del coordinador, **Liberar brigada** la deja Disponible.

Generar 60 focos (1 de cada 3 con carta) para probar la legibilidad del panel (RNF-05):

```bash
for i in $(seq 1 60); do
  ID=$(node -e 'console.log(crypto.randomUUID())')
  LAT=$(node -e "console.log((-16.1333 + ($i % 14 + 1) / 111.195).toFixed(5))")
  curl -s -o /dev/null -X POST http://localhost:3000/api/incidentes -H 'Authorization: Bearer demo-guardaparque' \
    -H 'Content-Type: application/json' -d "{\"id\":\"$ID\",\"latitud\":$LAT,\"longitud\":-62.0258,\"precisionMetros\":8}"
  if [ $((i % 3)) -eq 0 ]; then
    printf '%%PDF-1.4\n%% carta %s\n%%%%EOF\n' "$ID" | curl -s -o /dev/null -X POST \
      "http://localhost:3000/api/incidentes/$ID/carta-municipal" -H 'Authorization: Bearer demo-ugr' \
      -H 'Content-Type: application/pdf' -H 'x-fecha-emision: 2026-09-28' --data-binary @-
  fi
done
curl -s 'http://localhost:3000/api/panel?carta=con' -H 'Authorization: Bearer demo-coordinador' | head -c 300
```

Auditoría append-only de cartas y brigadas:

```bash
docker compose exec db psql -U chiquitania -d chiquitania_db \
  -c "SELECT tipo, detalle, creado_en FROM evento_auditoria ORDER BY creado_en DESC LIMIT 5;" \
  -c "UPDATE evento_auditoria SET detalle = 'x';"   # debe fallar: registro inmutable (RNF-07)
```

### 3.8 Despacho en 1 clic, orden de salida, reactivación y reasignación (Bolt 4)

Actualizar desde el Bolt 3: `docker compose up -d --build` y volver a aplicar la semilla (asigna jefes con
teléfono a las 4 brigadas). No hace falta borrar la base.

1. **Despacho en 1 clic (RF-10).** Crear un foco cerca de una comunidad y adjuntarle la carta (sección 3.7). En
   **Panel COED**, su tarjeta de "Nuevo" muestra **DESPACHAR B3 · 118 km** (la brigada sugerida). Tocarlo, confirmar
   y la tarjeta pasa a "Asignado" con **📨 Aviso enviado (SMS)**. Si falta la carta, el contacto o un jefe con
   teléfono, el botón aparece desactivado con el motivo (🔒). Tocar dos veces seguidas no crea dos asignaciones.
2. **Aviso al jefe (RF-11).** En la bandeja de la pasarela simulada (`curl -H "Authorization: Bearer
   demo-coordinador" http://localhost:3000/api/sms/mensajes`) aparece el SMS `DESPACHO F-… Alto <lat>,<lon> 118km NE. Ref: <referente> <teléfono>` (≤160). Con el navegador del jefe
   suscrito a notificaciones, llega primero un **push**; si no abre la orden en 3 minutos, sale el SMS.
3. **Orden de salida (HU-4.2).** Ingresar con el jefe de esa brigada (p. ej. `demo-jefe-brigada` para la B3) →
   **Mi brigada**: coordenadas, ruta en línea recta, referente con botón **Llamar** y cronómetro. Al abrirla, el
   panel del coordinador pasa a **✔ Orden leída**. **CONFIRMAR LLEGADA (GPS)** registra la llegada (ΔT).
4. **Reactivación (decisión 7.2).** Con la brigada "En Liquidación" (botón del jefe), crear otro reporte a menos de
   2 km del foco: el panel marca el foco controlado como **Posible reactivación**. Abrir su evaluación → **REACTIVAR
   FOCO** (justificación ≥15): vuelve a "Nuevo", riesgo Alto, **⟳ Reactivado** y primero en la columna.
5. **Reasignación táctica (HU-4.3).** La tarjeta reactivada ofrece **~ REASIGNAR B3 · 0 km** (la brigada que lo
   liquidaba): un clic y queda "Asignado". Cualquier foco **Alto** a menos de 30 km de una brigada "En Liquidación"
   la sugiere primero.

Web Push en desarrollo funciona en `http://localhost` (Chrome o Firefox de escritorio o Android con la API en la
misma máquina); en el VPS necesita HTTPS. Las claves VAPID de desarrollo se generan solas en el volumen
`evidencias` (`almacen/vapid-dev.json`).

Por API (curl), con el mismo UUID el reintento no duplica:

```bash
C="Authorization: Bearer demo-coordinador"; ID=<id del foco>; A=$(node -e 'console.log(crypto.randomUUID())')
curl -s "http://localhost:3000/api/incidentes/$ID/brigadas-sugeridas" -H "$C"   # version de cada brigada
curl -s -X POST "http://localhost:3000/api/incidentes/$ID/asignaciones" -H "$C" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$A\",\"brigadaId\":\"00000000-0000-4000-8000-000000000203\",\"versionBrigada\":0}" -w ' %{http_code}\n'
# 201; repetir el mismo comando → 200 con la misma asignación; con otra versión → 409
```

### 3.9 Bitácora de turno, cierre e informe consolidado (Bolt 5)

Actualizar desde el Bolt 4: `docker compose up -d --build`. No hace falta borrar la base (las tablas `bitacora` e
`informe_consolidado` del Bolt 0 estaban vacías y se reemplazan por las del UML).

1. **Foco en atención.** Despachar una brigada a un foco con carta y confirmar la llegada (3.8, o el script
   `backend/scripts/flujo-e2e.mjs`, que ahora recorre también la bitácora y el cierre).
2. **Bitácora sin conexión (HU-5.2).** Ingresar con el jefe de esa brigada (entra directo a **Mi brigada**). Bajo la
   orden aparece **Bitácora de turno**: tocar lo que cambió (agua, combustible, herramientas, **−/+** de km y de %
   de control) y **GUARDAR BITÁCORA**. En DevTools → *Network* → *Offline*: queda **En cola** con el SMS `BRC1 B`
   visible; al recargar sin red sigue ahí (la orden también); al volver la red pasa a **Enviada** sola. La siguiente
   bitácora se precarga con la anterior.
3. **Panel.** La tarjeta del foco muestra **📈 % control**.
4. **Cierre en 1 clic (HU-5.4).** Coordinador → abrir el foco → **Cerrar incidente**:
   - **Falso positivo** exige 15 caracteres de justificación (el botón queda bloqueado hasta cumplirlos);
   - **Controlado** o **Extendido** solo después de la llegada.
   **CERRAR Y GENERAR INFORME** descarga el PDF; la brigada queda Disponible. El detalle muestra el SHA-256.
5. **Informes.** Pestaña **Informes** (Coordinador y UGR): focos cerrados, resumen del KPI (ΔT promedio y % que
   cumple la meta del 30 %) y descarga de cada PDF.

Inmutabilidad (RNF-07):

```bash
docker compose exec db psql -U chiquitania -d chiquitania_db \
  -c "UPDATE bitacora SET porcentaje_control = 99;" \
  -c "UPDATE informe_consolidado SET sha256 = repeat('0', 64);"   # ambos deben fallar
```

---

## 4. Pruebas automatizadas

Las pruebas corren con Node 22 **fuera de Docker**, contra el PostgreSQL del contenedor `db` (puerto 5432).
La base `chiquitania_db` no se toca en las unitarias ni en las e2e: estas crean y vacían su propia base
`chiquitania_test`. Todo funciona igual en Windows (PowerShell), macOS y Linux: no hace falta bash, WSL ni curl.

### 4.1 Todo junto, con evidencias (recomendado)

Desde la raíz del repositorio:

```powershell
docker compose up -d --build
cd backend; npm ci; cd ..
cd frontend/pruebas; npm ci; cd ../..
node scripts/evidencias.mjs
```

Corre en orden: salud de la API, **unitarias** con cobertura, **e2e**, **flujo completo por API**,
**inmutabilidad RNF-07** (4 intentos de modificar/borrar que la base debe rechazar) y la **app en Chrome**. Deja
todo en `evidencias/` (no se versiona):

| Archivo | Contenido | Esperado |
|---|---|---|
| `RESUMEN.md` | Portada: fecha, commit, entorno y tabla ✅/❌ por paso | todo ✅ |
| `00-health.txt` | `GET /api/health` | `{"status":"ok","db":"up"}` |
| `01-unitarias.txt` + `cobertura/lcov-report/index.html` | Jest detallado y cobertura | 76/76 |
| `02-e2e.txt` | Jest e2e de los Bolts 0 a 5 | 94/94 |
| `03-flujo-api.txt` | Reporte → despacho → llegada (ΔT) → bitácora → cierre con PDF | 9/9 pasos |
| `04-inmutabilidad.txt` | UPDATE/DELETE/TRUNCATE sobre la auditoría | 4/4 rechazados |
| `05-navegador.txt` + `capturas/` | Playwright en Chrome, capturas a 360 y 1366 px | 18/18 |

Opciones: `--solo e2e,navegador` repite solo esos pasos (valores: `health`, `unitarias`, `e2e`, `flujo`,
`inmutabilidad`, `navegador`); `--seguir` no se detiene en el primer fallo. Chrome se encuentra solo en su ruta
habitual; si está en otra, definir `CHROMIUM` (PowerShell: `$env:CHROMIUM = "D:\...\chrome.exe"`). Antes del
flujo y del navegador se aplica la semilla (las pruebas despachan brigadas).

### 4.2 Paso a paso (cada comando desde la raíz del repositorio)

```powershell
# Unitarias (sin BD)
cd backend; npx jest --verbose; cd ..
# E2E contra PostgreSQL (docker compose up -d db basta)
cd backend; npx jest --config test/jest-e2e.json --runInBand --verbose; cd ..
# Flujo completo por API (con la semilla aplicada)
docker compose exec api node dist/seed
node backend/scripts/flujo-e2e.mjs
# App en Chrome (volver a aplicar la semilla antes de cada corrida)
docker compose exec api node dist/seed
cd frontend/pruebas; $env:APP = "http://localhost:8080"; npm test; cd ../..
```

En Bash/macOS la última línea es `cd frontend/pruebas && APP=http://localhost:8080 npm test && cd ../..`.
La prueba del navegador cubre inicio de sesión, reporte GPS con foto, cola sin conexión, recarga sin red,
sincronización, SMS simulado, evaluación y reclasificación; Bolt 3: 60 focos simulados, jefe "En Liquidación",
carta de la UGR, panel COED a 1366 px con filtros, validación y rechazo, panel a 360 px; Bolt 4: despacho en 1 clic
con doble clic, orden de salida leída y llegada por GPS, reactivación y reasignación; Bolt 5: bitácora sin conexión
y cierre con descarga del PDF; y memoria (RS-01). Las capturas quedan en `frontend/pruebas/capturas/`.

### 4.3 Desarrollo de la API sin Docker (opcional)

```bash
docker compose up -d db
docker compose stop api          # libera el puerto 3000
cd backend
cp .env.example .env
npm ci && npm run build && npm run seed
npm run start:dev                # API en :3000 y, con FRONTEND_DIR, también la app en http://localhost:3000
```

---

## 5. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| La API se reinicia y el log dice `column "latitud" … contains null values` | Base del Bolt 0 con el esquema anterior: `docker compose down -v` y volver a la sección 2. |
| `port is already allocated` al levantar | Otro servicio usa 5432, 3000 u 8080: detenerlo o cambiar el puerto publicado en `docker-compose.yml`. |
| `401 Falta el token de acceso` | Toda la API exige `Authorization: Bearer <código>`, salvo `/api/health`. |
| `403 Acción no permitida para el rol …` | El código usado no tiene ese permiso (ver tabla de roles en el `README.md`). |
| El botón de GPS nunca acepta la lectura | Precisión mayor a 15 m: simular la ubicación con *Sensors* (3.1) o usar el reporte a distancia. |
| Desde un teléfono en la misma red el GPS no funciona | El navegador solo permite geolocalización en `localhost` o con **HTTPS**. Para pruebas, usar el reporte a distancia o configurar TLS. |
| Cambios del frontend no se ven | Caché del service worker: *Unregister* y `Ctrl+Shift+R` (3.3). |
| La prueba del navegador no encuentra Chromium | Definir la variable `CHROMIUM` con la ruta al ejecutable (4.2). |
| Windows/PowerShell: `bash` responde `WSL … execvpe(/bin/bash) failed` | Ese `bash` es el de WSL sin distribución. Ya no hace falta: el flujo es `node backend/scripts/flujo-e2e.mjs`. |
| La prueba del navegador falla con `mkdir 'C:\C:\Users\…'` | Versión anterior de `app.prueba.mjs`: `git pull origin main`. |
| `UPDATE 0` en vez de error al probar la inmutabilidad | Las tablas estaban vacías (un trigger por fila no se dispara sin filas). Correr antes el flujo, o usar `node scripts/evidencias.mjs --solo flujo,inmutabilidad`. |
| Windows/PowerShell: `curl` pide "Advertencia de seguridad" | En PowerShell `curl` es `Invoke-WebRequest`: usar `curl.exe http://localhost:3000/api/health` (el `curl` real). |
| La semilla muestra `DeprecationWarning: Calling client.query() when the client is already executing a query` | Viene de TypeORM al sincronizar el esquema (`DB_SYNCHRONIZE=true`, solo desarrollo); es inofensiva y desaparece con las migraciones (Release 1.0). |

---

## 6. Antes de pasar a un VPS (no es desarrollo)

Crear un archivo `.env` junto a `docker-compose.yml` con, como mínimo:

```bash
NODE_ENV=production
CLAVE_CIFRADO=<salida de: openssl rand -base64 32>   # guardarla en lugar seguro: sin ella no se descifran los datos
SMS_WEBHOOK_SECRETO=<cadena larga aleatoria>
DB_PASSWORD=<clave robusta>
SMS_NUMERO_CENTRAL=<número de la central>
# Web Push (Bolt 4): generar UNA vez con `docker compose run --rm api node dist/generar-vapid mailto:<correo COED>`
VAPID_PUBLICA=<...>
VAPID_PRIVADA=<...>
VAPID_CONTACTO=mailto:<correo COED>
```

En producción la semilla **no** crea usuarios demo. El primer coordinador se crea con
`docker compose exec api node dist/crear-usuario "Nombre" Coordinador`. Los jefes de brigada se crean con
teléfono (`POST /api/usuarios`) y se asignan a su brigada con `PUT /api/brigadas/:id/jefe`: sin jefe con teléfono
no se despacha. Además hace falta HTTPS delante del servicio `web` para la geolocalización y para Web Push.
