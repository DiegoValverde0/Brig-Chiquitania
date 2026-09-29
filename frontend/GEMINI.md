# Frontend Skill (GEMINI.md)

Skill específica para el agente de UI (frontend). Complementa (no reemplaza) `/AGENTS.md`.
Por decisión del PO (29/09/2026), **Claude mantiene el frontend temporalmente**; estas reglas valen para
cualquier agente que lo tome.

## Estado actual (Bolts 1 y 2)
`frontend/app/`: app web instalable (PWA) del **CU-01 "Reportar foco de calor"** para el Guardaparque/Comunario,
según el wireframe de la Actividad 3 (Figura 7), y desde el Bolt 2 la pestaña **"Evaluación de riesgo"** del
Coordinador (CU-02, Figura 8), visible solo para ese rol. Las demás pantallas del coordinador llegan en los bolts
siguientes.

```
frontend/
├── app/                  # lo que sirve nginx (o la API con FRONTEND_DIR)
│   ├── index.html        # login con código de acceso + pantalla de reporte + "Mis reportes" + ajustes
│   ├── css/app.css
│   ├── js/sms.js         # codec BRC1 (idéntico a backend/src/core/sync/sms/codec-sms.ts)
│   ├── js/geo.js         # haversine y punto por rumbo (idéntico a backend/src/common/geo.ts)
│   ├── js/almacen.js     # IndexedDB (cola de reportes con foto) + ajustes en localStorage
│   ├── js/api.js         # fetch con token y tiempo límite
│   ├── js/foto.js        # compresión en el teléfono a ≤100 KB
│   ├── js/sync.js        # cola offline-first idempotente y catálogo comunal
│   ├── js/evaluacion.js  # pestaña "Evaluación de riesgo" del coordinador (CU-02, Figura 8; Bolt 2)
│   ├── js/app.js         # interfaz
│   └── sw.js             # service worker: la app abre sin red (subir VERSION al cambiar archivos)
├── nginx.conf            # sirve app/ y pasa /api al backend
└── pruebas/              # prueba en Chromium real (Playwright): offline, cola, SMS simulado, memoria
```

## Reglas
- **RS-01 (Android 5.0+, 1 GB RAM, app ≤120 MB):** sin frameworks ni librerías pesadas, sin mapas interactivos,
  JavaScript compatible con navegadores de Android 5 (sin `?.`, `??` ni módulos ES), DOM mínimo, liberar
  canvas y `ObjectURL` después de usarlos.
- **RNF-01 (offline-first):** todo reporte se persiste en IndexedDB **antes** de intentar la red; nunca se borra
  hasta que el servidor lo confirmó; el UUID lo genera el teléfono (reintentar no duplica).
- **RNF-02:** si no hay datos, mostrar el SMS `BRC1` (≤160 caracteres) con el botón para abrir la app de SMS; el
  simulador de la pasarela solo sirve para pruebas mientras no haya proveedor.
- **RS-02:** paquetes pequeños: reportes <2 KB en JSON, foto binaria ≤100 KB y enviada después del reporte.
- **HU-1.4:** el contacto comunal se autocompleta desde el catálogo guardado; si falta, avisar que el despacho
  quedará bloqueado (no impedir el reporte).
- Botones grandes (≥44 px, uso con guantes), textos en español llano, alto contraste para exteriores.
- El codec SMS y la geografía se duplican en backend y frontend: cambiar ambos a la vez (las pruebas del backend
  verifican que coincidan).

## Pruebas
`cd frontend/pruebas && npm ci && APP=http://localhost:8080 npm test` (API en marcha con la semilla; Chromium en
`CHROMIUM` o `/opt/pw-browsers/chromium`). Deja capturas de pantalla en `frontend/pruebas/capturas/`.
