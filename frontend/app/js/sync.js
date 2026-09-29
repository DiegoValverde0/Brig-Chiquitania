/*
 * Sincronización de la cola de reportes (RNF-01): envío ordenado, idempotente (el UUID lo genera el
 * teléfono, así que reintentar nunca duplica) y tolerante a cortes. Nunca borra un reporte hasta que el
 * servidor lo confirmó. La foto se envía después del reporte, por separado, para que la alerta no espere a
 * la imagen (HU-1.1: "sin detener el flujo de la alerta").
 */
(function (global) {
  'use strict';

  var enCurso = false;
  var oyentes = [];

  function notificar() {
    for (var i = 0; i < oyentes.length; i++) oyentes[i]();
  }

  /** ¿Hay canal de datos? El modo "simular falta de datos" fuerza el camino SMS en pruebas y demos. */
  function hayDatos() {
    return navigator.onLine && !BrcAjustes.obtener('simularSinDatos', false);
  }

  function enviarUno(r) {
    var paso = r.respuesta
      ? Promise.resolve()
      : BrcApi.post('/incidentes', r.cuerpo).then(function (res) {
          return BrcAlmacen.actualizarReporte(r.id, { respuesta: res.datos, enviadoEn: new Date().toISOString() });
        });
    return paso
      .then(function () {
        if (!r.foto || r.fotoSubida) return null;
        return BrcApi.postBinario('/incidentes/' + r.id + '/evidencia', r.foto, {
          'x-capturada-en': r.fotoCapturadaEn,
        }).then(
          function () {
            return BrcAlmacen.actualizarReporte(r.id, { fotoSubida: true });
          },
          function (e) {
            // 409: ya había otra foto; no se reintenta indefinidamente.
            if (e.estado === 409) return BrcAlmacen.actualizarReporte(r.id, { fotoSubida: true, avisoFoto: e.message });
            throw e;
          },
        );
      })
      .then(function () {
        return BrcAlmacen.actualizarReporte(r.id, { estado: 'enviado', error: null });
      });
  }

  /** Recorre la cola; devuelve cuántos reportes quedaron confirmados en esta pasada. */
  function sincronizar() {
    if (enCurso || !hayDatos() || !BrcAjustes.obtener('token', null)) return Promise.resolve(0);
    enCurso = true;
    var confirmados = 0;
    return BrcAlmacen.reportes()
      .then(function (lista) {
        var pendientes = lista
          .filter(function (r) {
            return r.estado === 'pendiente';
          })
          .reverse(); // los más antiguos primero
        var cadena = Promise.resolve();
        var detener = false;
        pendientes.forEach(function (r) {
          cadena = cadena.then(function () {
            if (detener) return null;
            return enviarUno(r).then(
              function () {
                confirmados++;
                notificar();
              },
              function (e) {
                if (e.estado === 0 || e.estado >= 500 || e.estado === 429) {
                  detener = true; // sin red o servidor caído: se reintenta más tarde
                  return null;
                }
                if (e.estado === 401) {
                  detener = true;
                  BrcAjustes.fijar('sesionVencida', true);
                  notificar();
                  return null;
                }
                // 4xx de validación: el reporte no se puede aceptar tal cual; se deja visible con el motivo.
                return BrcAlmacen.actualizarReporte(r.id, { estado: 'error', error: e.message }).then(notificar);
              },
            );
          });
        });
        return cadena;
      })
      .then(
        function () {
          enCurso = false;
          return confirmados;
        },
        function (e) {
          enCurso = false;
          throw e;
        },
      );
  }

  /** Descarga el catálogo comunal si cambió (HU-1.4: autocompletado offline). */
  function actualizarCatalogo() {
    if (!hayDatos() || !BrcAjustes.obtener('token', null)) return Promise.resolve(false);
    return BrcApi.get('/catalogo/comunidades').then(
      function (res) {
        return BrcAlmacen.leer('catalogo').then(function (actual) {
          if (actual && actual.version === res.datos.version) return false;
          return BrcAlmacen.escribir('catalogo', res.datos).then(function () {
            notificar();
            return true;
          });
        });
      },
      function () {
        return false;
      },
    );
  }

  function iniciar() {
    global.addEventListener('online', function () {
      sincronizar();
      actualizarCatalogo();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sincronizar();
    });
    setInterval(sincronizar, 30000);
  }

  global.BrcSync = {
    hayDatos: hayDatos,
    sincronizar: sincronizar,
    actualizarCatalogo: actualizarCatalogo,
    iniciar: iniciar,
    alCambiar: function (f) {
      oyentes.push(f);
    },
  };
})(self);
