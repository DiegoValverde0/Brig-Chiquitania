/*
 * Service worker: la app abre sin red (offline-first). Solo se precachea la "cáscara" estática; la API nunca
 * se cachea (los datos viven en IndexedDB y los maneja la cola de sincronización).
 * Subir VERSION al cambiar cualquier archivo de la lista.
 */
var VERSION = 'brc-app-v2';
var CASCARA = [
  './',
  'index.html',
  'css/app.css',
  'js/sms.js',
  'js/geo.js',
  'js/almacen.js',
  'js/api.js',
  'js/foto.js',
  'js/sync.js',
  'js/evaluacion.js',
  'js/app.js',
  'manifest.webmanifest',
  'icono.svg',
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(CASCARA);
    }).then(function () {
      return self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(
        claves
          .filter(function (c) {
            return c !== VERSION;
          })
          .map(function (c) {
            return caches.delete(c);
          }),
      );
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener('fetch', function (evento) {
  var url = new URL(evento.request.url);
  if (evento.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) {
    return; // la API va siempre a la red
  }
  // Red primero con respaldo en caché: si hay señal se obtiene la última versión; sin señal, la guardada.
  evento.respondWith(
    fetch(evento.request).then(
      function (respuesta) {
        if (respuesta.ok) {
          var copia = respuesta.clone();
          caches.open(VERSION).then(function (cache) {
            cache.put(evento.request, copia);
          });
        }
        return respuesta;
      },
      function () {
        return caches.match(evento.request, { ignoreSearch: true }).then(function (r) {
          return r || caches.match('index.html');
        });
      },
    ),
  );
});
