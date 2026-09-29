# Frontend Skill (GEMINI.md)

Skill específica para el agente de UI (frontend). Complementa (no reemplaza) `/AGENTS.md`.
Por decisión del PO (29/09/2026), **Claude mantiene el frontend temporalmente**; estas reglas valen para
cualquier agente que lo tome.

## Estado actual (Bolts 1 a 4)
`frontend/app/`: app web instalable (PWA) del **CU-01 "Reportar foco de calor"** para el Guardaparque/Comunario,
según el wireframe de la Actividad 3 (Figura 7), con pestañas por rol (`PESTANAS_POR_ROL` en `app.js`):
- **Coordinador:** Reportar, **Panel COED** (Figura 9, Bolt 3), **Evaluación** de riesgo (Figura 8, Bolt 2, con la
  sección de carta municipal) y **Cartas** (contingencia).
- **Responsable UGR:** Reportar y **Cartas** (adjuntar la carta municipal, Ley 602).
- **Jefe de Brigada:** Reportar y **Mi brigada** ("En Liquidación / Por finalizar"; desde el Bolt 4, orden de
  salida con cronómetro, llamada al referente, acuse de recibo, CONFIRMAR LLEGADA por GPS y suscripción Web Push).
- **Guardaparque:** solo Reportar (sin barra de pestañas).
Las pantallas del COED necesitan conexión; solo el reporte es offline-first.

```
frontend/
├── app/                  # lo que sirve nginx (o la API con FRONTEND_DIR)
│   ├── index.html        # login con código de acceso + pantalla de reporte + "Mis reportes" + ajustes
│   ├── css/app.css
│   ├── js/sms.js         # codec BRC1 (idéntico a backend/src/core/sync/sms/codec-sms.ts)
│   ├── js/geo.js         # haversine y punto por rumbo (idéntico a backend/src/common/geo.ts)
│   ├── js/almacen.js     # IndexedDB (cola de reportes con foto) + ajustes en localStorage
│   ├── js/api.js         # fetch con token y tiempo límite
│   ├── js/foto.js        # compresión en el teléfono a ≤100 KB (o al límite que se pida: carta ≤1 MB)
│   ├── js/sync.js        # cola offline-first idempotente y catálogo comunal
│   ├── js/evaluacion.js  # "Evaluación de riesgo" (CU-02, Figura 8; Bolt 2) + validar/rechazar la carta (Bolt 3)
│   ├── js/panel.js       # Kanban del COED: filtros, contadores, "ver más", mapa SVG, brigadas (Bolt 3);
│   │                     # DESPACHAR / REASIGNAR en 1 clic, insignias de reactivación y de aviso (Bolt 4)
│   ├── js/cartas.js      # bandeja de la UGR: adjuntar PDF/foto de la carta ≤1 MB (Bolt 3)
│   ├── js/brigada.js     # vista del jefe de brigada (RF-08, Bolt 3)
│   ├── js/app.js         # interfaz
│   └── sw.js             # service worker: la app abre sin red (subir VERSION al cambiar archivos); push y clic de notificación
├── nginx.conf            # sirve app/ y pasa /api al backend
└── pruebas/              # prueba en Chromium real (Playwright): offline, cola, SMS, evaluación, panel, cartas, memoria
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
- **Mapa (RF-01):** solo el mapa esquemático propio en SVG de `panel.js` (recuadro fijo de la Chiquitanía,
  comunidades del catálogo offline, focos agrupados por cuadrícula de 0,3°). Nada de teselas ni librerías de mapas.
- **RNF-05:** el panel debe seguir legible con 50+ focos: máximo 15 tarjetas por columna antes de "ver más",
  desplazamiento propio por columna, y sin desplazamiento horizontal a 360 px.
- **Despacho (RS-03):** siempre con confirmación humana; el UUID del clic se reutiliza en los reintentos y se envía la
  `version` de la brigada (bloqueo optimista). Un 409 recarga el panel.
- **Web Push:** si el navegador no lo soporta o se niega el permiso, avisar que las órdenes llegarán por SMS (nunca
  bloquear). El push real no se prueba en Chromium headless (necesita FCM); lo cubre el e2e con un push falso.
- Estados de brigada con sus símbolos de la leyenda: `*` Disponible, `^` En desplazamiento, `#` En combate,
  `~` En liquidación.

## Pruebas
`cd frontend/pruebas && npm ci && APP=http://localhost:8080 npm test` (API en marcha con la semilla; Chromium en
`CHROMIUM` o `/opt/pw-browsers/chromium`). Deja capturas de pantalla en `frontend/pruebas/capturas/`.
