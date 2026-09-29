/*
 * Vista del Jefe de Brigada (RF-08; Acta ACTA-002, acuerdo 4; HU-4.2, Bolt 4):
 * - estado táctico de su brigada y el botón "Reportar: En Liquidación / Por finalizar" (solo En Combate Activo);
 * - orden de salida: coordenadas, ruta en línea recta, contacto comunal, cronómetro desde la asignación;
 *   al mostrarla se envía el acuse de recibo (evita el SMS de respaldo a los 3 minutos);
 * - CONFIRMAR LLEGADA con el GPS del teléfono (HU-5.1);
 * - suscripción Web Push para recibir la próxima orden (sin push, llega por SMS).
 * La liberación (Disponible) la hace el coordinador desde el panel COED.
 */
(function (global) {
  'use strict';

  var ETIQUETA = {
    Disponible: 'Disponible',
    En_Desplazamiento: 'En desplazamiento',
    En_Combate_Activo: 'En combate activo',
    En_Liquidacion: 'En liquidación / por finalizar',
  };
  var ETIQUETA_FOCO = { Asignado: 'Asignado', En_Atencion: 'En atención', En_Liquidacion: 'En liquidación' };
  /** La llegada no exige los 15 m del reporte (RF-01): basta ubicar a la brigada en el foco [inferencia]. */
  var PRECISION_LLEGADA_M = 60;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var actual = null;
  var cronometro = null;
  var leidas = {}; // acuses ya enviados en esta sesión

  function linea(caja, contenido, clase) {
    var p = document.createElement('p');
    if (clase) p.className = clase;
    p.textContent = contenido;
    caja.appendChild(p);
    return p;
  }

  function pintar() {
    var caja = $('mi-brigada');
    caja.innerHTML = '';
    var b = actual;
    var titulo = document.createElement('h2');
    titulo.textContent = b.nombre;
    caja.appendChild(titulo);
    var estado = linea(caja, 'Estado: ');
    var insignia = document.createElement('span');
    insignia.id = 'estado-mi-brigada';
    insignia.className = 'insignia brigada-' + b.estadoOperativo;
    insignia.textContent = ETIQUETA[b.estadoOperativo];
    estado.appendChild(insignia);
    if (b.incidente) {
      linea(
        caja,
        'Foco asignado: FOCO-' + b.incidente.id.slice(0, 8) + (b.incidente.comunidad ? ' (' + b.incidente.comunidad + ')' : '') +
          ' · riesgo ' + (b.incidente.nivelRiesgo || 'sin calcular') + ' · ' + ETIQUETA_FOCO[b.incidente.estado],
      );
    } else {
      linea(caja, 'Sin foco asignado.', 'nota');
    }
    $('reportar-liquidacion').hidden = b.estadoOperativo !== 'En_Combate_Activo';
    if (b.estadoOperativo === 'En_Liquidacion') linea(caja, 'La central liberará la brigada al terminar la liquidación.', 'nota');
    pintarOrden(b.orden);
  }

  // ---------- orden de salida (HU-4.2) ----------

  function pintarOrden(o) {
    clearInterval(cronometro);
    $('orden-salida').hidden = !o;
    if (!o) return;
    var i = o.incidente;
    $('orden-foco').textContent =
      'FOCO-' + i.id.slice(0, 8) + ' · riesgo ' + (i.nivelRiesgo || 'sin calcular') + (i.comunidad ? ' · ' + i.comunidad : '');
    $('orden-coordenadas').textContent = 'Lat: ' + i.latitud.toFixed(5) + '  Lon: ' + i.longitud.toFixed(5);
    $('orden-ruta').textContent = o.rutaSugerida ? 'Ruta en línea recta: ' + o.rutaSugerida.split(' (')[0] + ' desde la posición de la brigada' : '';
    var llamar = $('orden-llamar');
    if (o.contacto) {
      $('orden-contacto').textContent = 'Referente comunal: ' + o.contacto.nombre + ' · ' + o.contacto.telefono + ' (' + o.contacto.cargo + ')';
      llamar.href = 'tel:' + o.contacto.telefono.replace(/[^\d+]/g, '');
      llamar.hidden = false;
    } else {
      $('orden-contacto').textContent = 'Sin referente comunal registrado: consulte a la central.';
      llamar.hidden = true;
    }
    $('confirmar-llegada').hidden = o.llegadaConfirmada;
    $('orden-aviso').textContent = o.llegadaConfirmada ? 'llegada confirmada' : 'orden recibida';
    var desde = new Date(o.fechaAsignacion).getTime();
    var tic = function () {
      var min = Math.max(0, Math.floor((Date.now() - desde) / 60000));
      $('orden-cronometro').textContent = min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
    };
    tic();
    cronometro = setInterval(tic, 30000);
    acusarRecibo(o);
  }

  function acusarRecibo(o) {
    if (leidas[o.asignacionId] || o.llegadaConfirmada) return;
    leidas[o.asignacionId] = true;
    BrcApi.post('/asignaciones/' + o.asignacionId + '/leida', {}).then(null, function () {
      leidas[o.asignacionId] = false; // se reintenta en la próxima actualización
    });
  }

  function confirmarLlegada() {
    var o = actual && actual.orden;
    if (!o) return;
    var mensaje = $('mensaje-llegada');
    if (!('geolocation' in navigator)) {
      mensaje.textContent = 'Este teléfono no tiene GPS disponible: avise la llegada por radio a la central.';
      return;
    }
    $('confirmar-llegada').disabled = true;
    mensaje.textContent = 'Buscando señal GPS…';
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var precision = Math.round(pos.coords.accuracy * 10) / 10;
        if (precision > PRECISION_LLEGADA_M) {
          $('confirmar-llegada').disabled = false;
          mensaje.textContent = 'Precisión insuficiente (±' + Math.round(precision) + ' m). Reintente a cielo abierto.';
          return;
        }
        BrcApi.post('/asignaciones/' + o.asignacionId + '/llegada', {
          latitud: Math.round(pos.coords.latitude * 1e6) / 1e6,
          longitud: Math.round(pos.coords.longitude * 1e6) / 1e6,
          precisionMetros: precision,
        }).then(
          function (res) {
            $('confirmar-llegada').disabled = false;
            mensaje.textContent = '✔ Llegada confirmada. ΔT = ' + res.datos.deltaMinutos + ' min desde el reporte.';
            cargar();
          },
          function (e) {
            $('confirmar-llegada').disabled = false;
            mensaje.textContent = 'No se confirmó: ' + e.message;
          },
        );
      },
      function () {
        $('confirmar-llegada').disabled = false;
        mensaje.textContent = 'No se obtuvo señal GPS. Reintente a cielo abierto.';
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 },
    );
  }

  // ---------- Web Push (RF-11) ----------

  function aBytes(b64u) {
    var b64 = (b64u + '===='.slice(b64u.length % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var crudo = atob(b64);
    var bytes = new Uint8Array(crudo.length);
    for (var i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return bytes;
  }

  /** Suscribe el navegador para recibir la orden por push; si no se puede, la orden llega por SMS. */
  function suscribirPush() {
    var estado = $('estado-push');
    if (!('serviceWorker' in navigator) || !('PushManager' in global) || !('Notification' in global)) {
      estado.textContent = 'Este navegador no recibe notificaciones: las órdenes le llegarán por SMS.';
      return;
    }
    if (Notification.permission === 'denied') {
      estado.textContent = 'Notificaciones bloqueadas: las órdenes le llegarán por SMS.';
      return;
    }
    Promise.all([navigator.serviceWorker.ready, BrcApi.get('/notificaciones/clave-publica')])
      .then(function (r) {
        var registro = r[0];
        return registro.pushManager.getSubscription().then(function (existente) {
          return existente || registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(r[1].datos.clavePublica) });
        });
      })
      .then(function (suscripcion) {
        return BrcApi.post('/notificaciones/suscripcion', JSON.parse(JSON.stringify(suscripcion)));
      })
      .then(
        function () {
          estado.textContent = '🔔 Notificaciones activas: recibirá la orden de salida en este teléfono (y por SMS si no la abre).';
        },
        function () {
          estado.textContent = 'No se activaron las notificaciones: las órdenes le llegarán por SMS.';
        },
      );
  }

  // ---------- carga ----------

  function cargar() {
    $('mensaje-brigada').textContent = '';
    return BrcApi.get('/brigadas/mia').then(
      function (res) {
        actual = res.datos;
        pintar();
      },
      function (e) {
        actual = null;
        $('reportar-liquidacion').hidden = true;
        pintarOrden(null);
        $('mi-brigada').innerHTML = '';
        linea($('mi-brigada'), e.estado === 0 ? 'Sin conexión: el estado de la brigada necesita red.' : e.message, 'error');
      },
    );
  }

  function mostrar() {
    suscribirPush();
    return cargar();
  }

  function ocultar() {
    clearInterval(cronometro);
  }

  function reportarLiquidacion() {
    if (!actual) return;
    if (!confirm('¿Confirmar que la brigada está EN LIQUIDACIÓN / POR FINALIZAR?')) return;
    var boton = $('reportar-liquidacion');
    boton.disabled = true;
    $('mensaje-brigada').textContent = 'Enviando…';
    BrcApi.post('/brigadas/' + actual.id + '/estado', { estado: 'En_Liquidacion' }).then(
      function () {
        boton.disabled = false;
        $('mensaje-brigada').textContent = '✔ Reportado a la central: brigada en liquidación.';
        return cargar();
      },
      function (e) {
        boton.disabled = false;
        $('mensaje-brigada').textContent = 'No se reportó: ' + e.message;
      },
    );
  }

  function iniciar() {
    $('reportar-liquidacion').addEventListener('click', reportarLiquidacion);
    $('actualizar-brigada').addEventListener('click', cargar);
    $('confirmar-llegada').addEventListener('click', confirmarLlegada);
  }

  global.BrcBrigada = { iniciar: iniciar, mostrar: mostrar, ocultar: ocultar };
})(self);
