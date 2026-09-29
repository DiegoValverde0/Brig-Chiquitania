/* Cliente HTTP mínimo de la API: token de sesión, tiempo límite (redes 2G) y errores tipados. */
(function (global) {
  'use strict';

  var TIEMPO_LIMITE_MS = 20000;

  /** Error de la API con su código HTTP (0 = sin red o sin respuesta). */
  function ErrorApi(estado, mensaje) {
    this.estado = estado;
    this.message = mensaje;
  }
  ErrorApi.prototype = Object.create(Error.prototype);
  ErrorApi.prototype.name = 'ErrorApi';

  function pedir(metodo, ruta, opciones) {
    opciones = opciones || {};
    var cabeceras = opciones.cabeceras || {};
    var token = BrcAjustes.obtener('token', null);
    if (token) cabeceras.Authorization = 'Bearer ' + token;
    var cuerpo;
    if (opciones.json !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(opciones.json);
    } else if (opciones.binario) {
      cabeceras['Content-Type'] = opciones.binario.type || 'image/jpeg';
      cuerpo = opciones.binario;
    }

    var control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador = setTimeout(function () {
      if (control) control.abort();
    }, opciones.tiempoLimite || TIEMPO_LIMITE_MS);

    return fetch('/api' + ruta, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo,
      signal: control ? control.signal : undefined,
      cache: 'no-store',
    }).then(
      function (res) {
        clearTimeout(temporizador);
        if (res.ok && opciones.comoBlob) {
          return res.blob().then(function (blob) {
            return { estado: res.status, datos: blob };
          });
        }
        return res.text().then(function (texto) {
          var datos = null;
          try {
            datos = texto ? JSON.parse(texto) : null;
          } catch (e) {
            datos = texto;
          }
          if (!res.ok) {
            var mensaje = datos && datos.message ? [].concat(datos.message).join('; ') : 'Error ' + res.status;
            throw new ErrorApi(res.status, mensaje);
          }
          return { estado: res.status, datos: datos };
        });
      },
      function () {
        clearTimeout(temporizador);
        throw new ErrorApi(0, 'Sin conexión con el servidor');
      },
    );
  }

  global.BrcApi = {
    ErrorApi: ErrorApi,
    get: function (ruta) {
      return pedir('GET', ruta);
    },
    post: function (ruta, json) {
      return pedir('POST', ruta, { json: json });
    },
    postBinario: function (ruta, blob, cabeceras) {
      return pedir('POST', ruta, { binario: blob, cabeceras: cabeceras });
    },
    /** Descarga un archivo protegido (p. ej. la carta municipal) como Blob. */
    blob: function (ruta) {
      return pedir('GET', ruta, { comoBlob: true, tiempoLimite: 60000 });
    },
  };
})(self);
