# Guía de despliegue en desarrollo y pruebas

Pasos para levantar el MVP en una máquina de desarrollo con Docker, cargar datos de ejemplo y verificar todo
lo construido hasta el **Bolt 2** (Walking Skeleton, captura resiliente y contacto comunal, motor de riesgo y
gobernanza algorítmica).

> Todos los comandos se ejecutan desde la raíz del repositorio, salvo que se indique otra carpeta.
> En Windows, usar PowerShell o Git Bash; los comandos `curl` de ejemplo están escritos para Bash.

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
- 3 brigadas (dos en Santa Cruz de la Sierra, una en San Ignacio de Velasco), todas **Disponibles**.
- 2 estancias **ficticias** para probar la exclusión de predios privados del motor de riesgo (Bolt 2).
- 4 usuarios demo, uno por rol. **Sus códigos son públicos: solo para desarrollo.**

| Rol | Código de acceso |
|---|---|
| Guardaparque / Comunario | `demo-guardaparque` |
| Coordinador de Despacho (COED) | `demo-coordinador` |
| Jefe de Brigada | `demo-jefe-brigada` |
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
un script (requiere `curl` y `node`):

```bash
sh backend/scripts/flujo-e2e.sh
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

---

## 4. Pruebas automatizadas

Las pruebas corren con Node 22 **fuera de Docker**, contra el PostgreSQL del contenedor `db` (puerto 5432).
La base `chiquitania_db` no se toca: las pruebas e2e crean y vacían su propia base `chiquitania_test`.

### 4.1 Backend: unitarias y e2e

```bash
docker compose up -d db          # basta con la base de datos
cd backend
npm ci
npm test                         # unitarias (sin BD): cifrado, codec SMS, geografía, motor de riesgo, validación
npm run test:e2e                 # flujo Bolt 0 + captura Bolt 1 contra PostgreSQL
cd ..
```

Resultado esperado al cierre del Bolt 2: **30 unitarias** y **45 e2e** en verde.

### 4.2 App web en el navegador (Playwright)

Requiere el entorno levantado y la semilla aplicada (sección 2), y un Chrome/Chromium local.

```bash
cd frontend/pruebas
npm ci
# Indicar el ejecutable del navegador si no está en /opt/pw-browsers/chromium:
#   Linux:   export CHROMIUM=/usr/bin/google-chrome
#   macOS:   export CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
#   Windows (cmd): set CHROMIUM=C:\Program Files\Google\Chrome\Application\chrome.exe
APP=http://localhost:8080 npm test
# Windows (cmd): set APP=http://localhost:8080  y luego  npm test
cd ../..
```

Resultado esperado: **8/8 pasos OK** (inicio de sesión, reporte GPS con foto, cola sin conexión, recarga sin
red, sincronización, SMS simulado, evaluación y reclasificación del coordinador, y memoria). Las capturas quedan en `frontend/pruebas/capturas/`.

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

---

## 6. Antes de pasar a un VPS (no es desarrollo)

Crear un archivo `.env` junto a `docker-compose.yml` con, como mínimo:

```bash
NODE_ENV=production
CLAVE_CIFRADO=<salida de: openssl rand -base64 32>   # guardarla en lugar seguro: sin ella no se descifran los datos
SMS_WEBHOOK_SECRETO=<cadena larga aleatoria>
DB_PASSWORD=<clave robusta>
SMS_NUMERO_CENTRAL=<número de la central>
```

En producción la semilla **no** crea usuarios demo. El primer coordinador se crea con
`docker compose exec api node dist/crear-usuario "Nombre" Coordinador`. Además hace falta HTTPS delante del
servicio `web` para que funcione la geolocalización.
