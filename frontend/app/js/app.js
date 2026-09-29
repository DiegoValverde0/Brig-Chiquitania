/*
 * Pantalla del CU-01 "Reportar foco de calor" (wireframe de la Actividad 3, Figura 7).
 * Sin mapas ni librerías: DOM mínimo para teléfonos Android 5+ con 1 GB de RAM (RS-01).
 */
(function () {
  'use strict';

  var PRECISION_MAXIMA_M = 15;
  var ESPERA_GPS_MS = 60000;
  var $ = function (id) {
    return document.getElementById(id);
  };

  var estado = { lecturaGps: null, foto: null, catalogo: null, vigilanteGps: null, temporizadorGps: null };

  // ---------- utilidades ----------

  function nuevoUuid() {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map
      .call(b, function (x) {
        return (x + 0x100).toString(16).slice(1);
      })
      .join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  self.BrcUuid = nuevoUuid;

  function texto(el, valor) {
    el.textContent = valor;
    return el;
  }

  function hora(iso) {
    var d = new Date(iso);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + d.toLocaleDateString();
  }

  function modo() {
    return document.querySelector('input[name="modo"]:checked').value;
  }

  // ---------- sesión ----------

  function mostrar(vista) {
    $('vista-login').hidden = vista !== 'login';
    $('vista-principal').hidden = vista !== 'principal';
  }

  function iniciarSesion(evento) {
    evento.preventDefault();
    var token = $('token').value.trim();
    texto($('error-login'), '');
    if (!token) return;
    BrcAjustes.fijar('token', token);
    BrcApi.get('/sesion').then(
      function (res) {
        BrcAjustes.fijar('usuario', res.datos);
        BrcAjustes.fijar('sesionVencida', false);
        $('token').value = '';
        entrar();
      },
      function (e) {
        BrcAjustes.fijar('token', null);
        texto($('error-login'), e.estado === 401 ? 'Código de acceso inválido' : 'Necesita conexión para el primer ingreso');
      },
    );
  }

  function cerrarSesion() {
    BrcAjustes.fijar('token', null);
    BrcAjustes.fijar('usuario', null);
    if (pestanaActual) elegirPestana('reportar');
    $('pestanas').hidden = true;
    mostrar('login');
  }

  /**
   * Pestañas por rol (la API exige lo mismo: RNF-08). Coordinador: panel COED, evaluación y cartas (contingencia);
   * UGR: cartas municipales; Jefe de Brigada: su brigada. Todos pueden reportar un foco.
   */
  var PESTANAS = {
    reportar: { titulo: 'Reportar foco de calor' },
    panel: { titulo: 'Panel COED', ancha: true, modulo: function () { return self.BrcPanel; } },
    evaluacion: { titulo: 'Evaluación de riesgo', modulo: function () { return self.BrcEvaluacion; } },
    cartas: { titulo: 'Cartas municipales', modulo: function () { return self.BrcCartas; } },
    brigada: { titulo: 'Mi brigada', modulo: function () { return self.BrcBrigada; } },
  };
  var PESTANAS_POR_ROL = {
    Coordinador: ['reportar', 'panel', 'evaluacion', 'cartas'],
    ResponsableUGR: ['reportar', 'cartas'],
    JefeBrigada: ['reportar', 'brigada'],
  };
  var pestanaActual = null;

  function elegirPestana(nombre, extra) {
    Object.keys(PESTANAS).forEach(function (n) {
      var activa = n === nombre;
      $('panel-' + n).hidden = !activa;
      $('tab-' + n).setAttribute('aria-selected', String(activa));
      var modulo = PESTANAS[n].modulo && PESTANAS[n].modulo();
      if (!activa && n === pestanaActual && modulo && modulo.ocultar) modulo.ocultar();
    });
    pestanaActual = nombre;
    var p = PESTANAS[nombre];
    texto($('titulo'), p.titulo);
    $('vista-principal').className = 'vista' + (p.ancha ? ' vista-ancha' : '');
    if (nombre !== 'reportar') detenerGps();
    var modulo = p.modulo && p.modulo();
    if (modulo) modulo.mostrar(extra);
  }

  function pintarPestanas(usuario) {
    var visibles = (usuario && PESTANAS_POR_ROL[usuario.rol]) || ['reportar'];
    Object.keys(PESTANAS).forEach(function (n) {
      $('tab-' + n).hidden = visibles.indexOf(n) < 0;
    });
    $('pestanas').hidden = visibles.length < 2;
    $('pestanas').style.gridTemplateColumns = 'repeat(' + visibles.length + ', 1fr)';
  }

  function entrar() {
    var usuario = BrcAjustes.obtener('usuario', null);
    texto($('usuario'), usuario ? usuario.nombre + ' · ' + usuario.rol : '');
    pintarPestanas(usuario);
    // Bolt 4: la notificación de despacho abre la app en "Mi brigada" (./?pestana=brigada).
    var pedida = /[?&]pestana=(\w+)/.exec(location.search);
    var visibles = (usuario && PESTANAS_POR_ROL[usuario.rol]) || ['reportar'];
    elegirPestana(pedida && visibles.indexOf(pedida[1]) >= 0 ? pedida[1] : 'reportar');
    mostrar('principal');
    cargarCatalogo();
    BrcSync.actualizarCatalogo();
    if (BrcSync.hayDatos()) {
      BrcApi.get('/sms/configuracion').then(function (res) {
        BrcAjustes.fijar('numeroCentral', res.datos.numeroCentral);
        pintarAjustes();
      }, function () {});
    }
    pintarAjustes();
    pintarRed();
    BrcSync.sincronizar().then(pintarLista);
    pintarLista();
  }

  // ---------- catálogo y contacto comunal (HU-1.4) ----------

  function cargarCatalogo() {
    return BrcAlmacen.leer('catalogo').then(function (catalogo) {
      estado.catalogo = catalogo || null;
      var select = $('comunidad');
      var elegida = select.value;
      select.innerHTML = '';
      var vacia = document.createElement('option');
      vacia.value = '';
      vacia.textContent = catalogo ? 'Elija la comunidad…' : 'Catálogo no descargado';
      select.appendChild(vacia);
      (catalogo ? catalogo.comunidades : []).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.nombre;
        select.appendChild(o);
      });
      select.value = elegida;
      texto($('version-catalogo'), catalogo ? catalogo.comunidades.length + ' comunidades' : 'sin descargar');
      pintarContacto();
    });
  }

  /** Punto del foco según el modo: lectura GPS o comunidad + rumbo + distancia. */
  function puntoDelFoco() {
    if (modo() === 'GPS') return estado.lecturaGps;
    var datos = datosDistancia();
    if (!datos.comunidad || !datos.rumbo || !datos.distanciaKm) return null;
    return BrcGeo.puntoDestino(datos.comunidad, datos.rumbo, datos.distanciaKm);
  }

  function datosDistancia() {
    var id = $('comunidad').value;
    var comunidad = null;
    if (estado.catalogo) {
      estado.catalogo.comunidades.forEach(function (c) {
        if (c.id === id) comunidad = c;
      });
    }
    var rumbo = document.querySelector('input[name="rumbo"]:checked');
    var km = parseFloat($('distancia').value);
    return { comunidad: comunidad, rumbo: rumbo ? rumbo.value : null, distanciaKm: isFinite(km) ? km : null };
  }

  function pintarContacto() {
    var caja = $('contacto');
    caja.innerHTML = '';
    var punto = puntoDelFoco();
    var p = function (contenido, clase) {
      var el = document.createElement('p');
      if (clase) el.className = clase;
      el.textContent = contenido;
      caja.appendChild(el);
    };
    if (!estado.catalogo) return p('Catálogo comunal no descargado: el contacto se asignará en la central.', 'nota');
    if (!punto) return p('El contacto comunal aparecerá al ubicar el foco.', 'nota');
    var cercana = BrcGeo.comunidadMasCercana(punto, estado.catalogo.comunidades);
    if (!cercana) return p('No hay comunidades en el catálogo.', 'nota');
    p('Comunidad más cercana: ' + cercana.comunidad.nombre + ' (' + cercana.distanciaKm + ' km)');
    var c = cercana.comunidad.contacto;
    if (c) p('Contacto comunal: ' + c.nombreAutoridad + ' · ' + c.telefono + ' (' + c.cargo + ')', 'destacado');
    else p('⚠ Sin contacto comunal registrado: el despacho quedará bloqueado hasta que la central lo registre.', 'aviso');
    p('(autocompletado offline)', 'nota');
  }

  // ---------- GPS (RF-01: coordenada cruda ≤15 m, sin mapas) ----------

  function detenerGps() {
    if (estado.vigilanteGps !== null) navigator.geolocation.clearWatch(estado.vigilanteGps);
    clearTimeout(estado.temporizadorGps);
    estado.vigilanteGps = null;
    $('capturar-gps').disabled = false;
  }

  function capturarGps() {
    var lectura = $('lectura-gps');
    if (!('geolocation' in navigator)) return texto(lectura, 'Este teléfono no tiene GPS disponible: use "Lo veo a la distancia".');
    detenerGps();
    estado.lecturaGps = null;
    $('capturar-gps').disabled = true;
    texto(lectura, 'Buscando señal GPS…');
    var mejor = null;
    estado.vigilanteGps = navigator.geolocation.watchPosition(
      function (pos) {
        var l = {
          latitud: Math.round(pos.coords.latitude * 1e6) / 1e6,
          longitud: Math.round(pos.coords.longitude * 1e6) / 1e6,
          precisionMetros: Math.round(pos.coords.accuracy * 10) / 10,
        };
        if (!mejor || l.precisionMetros < mejor.precisionMetros) mejor = l;
        var linea = 'Lat: ' + mejor.latitud.toFixed(5) + '  Lon: ' + mejor.longitud.toFixed(5) + '  (±' + Math.round(mejor.precisionMetros) + ' m)';
        if (mejor.precisionMetros <= PRECISION_MAXIMA_M) {
          estado.lecturaGps = mejor;
          texto(lectura, '✔ ' + linea);
          detenerGps();
          pintarContacto();
        } else {
          texto(lectura, linea + ' — afinando precisión (≤' + PRECISION_MAXIMA_M + ' m)…');
        }
      },
      function (error) {
        detenerGps();
        texto(
          lectura,
          error.code === 1
            ? 'Permiso de ubicación denegado. Actívelo o use "Lo veo a la distancia".'
            : 'No se obtuvo señal GPS. Salga a cielo abierto y reintente, o use "Lo veo a la distancia".',
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: ESPERA_GPS_MS },
    );
    estado.temporizadorGps = setTimeout(function () {
      if (estado.vigilanteGps === null) return;
      detenerGps();
      texto(
        lectura,
        mejor
          ? 'Precisión insuficiente (±' + Math.round(mejor.precisionMetros) + ' m, se exige ≤' + PRECISION_MAXIMA_M + ' m). Reintente a cielo abierto o use "Lo veo a la distancia".'
          : 'No se obtuvo señal GPS. Reintente o use "Lo veo a la distancia".',
      );
    }, ESPERA_GPS_MS);
  }

  // ---------- foto (RF-03) ----------

  function elegirFoto() {
    var archivo = $('archivo-foto').files[0];
    if (!archivo) return;
    var capturadaEn = new Date(archivo.lastModified || Date.now());
    if (capturadaEn.getTime() > Date.now()) capturadaEn = new Date();
    texto($('peso-foto'), 'Comprimiendo…');
    $('vista-foto').hidden = false;
    BrcFoto.comprimir(archivo).then(
      function (blob) {
        quitarFoto(true);
        estado.foto = { blob: blob, capturadaEn: capturadaEn.toISOString(), url: URL.createObjectURL(blob) };
        $('miniatura').src = estado.foto.url;
        $('vista-foto').hidden = false;
        texto($('peso-foto'), Math.round(blob.size / 1024) + ' KB');
      },
      function (e) {
        quitarFoto();
        texto($('error-reporte'), e.message);
      },
    );
  }

  function quitarFoto(conservarVista) {
    if (estado.foto) URL.revokeObjectURL(estado.foto.url);
    estado.foto = null;
    $('archivo-foto').value = '';
    $('miniatura').removeAttribute('src');
    if (!conservarVista) $('vista-foto').hidden = true;
  }

  // ---------- envío ----------

  function construirReporte() {
    var id = nuevoUuid();
    var fecha = new Date();
    if (modo() === 'GPS') {
      var l = estado.lecturaGps;
      if (!l) throw new Error('Capture las coordenadas GPS (precisión ≤15 m) o use "Lo veo a la distancia".');
      return {
        cuerpo: { id: id, tipoReporte: 'GPS', latitud: l.latitud, longitud: l.longitud, precisionMetros: l.precisionMetros, fechaReporte: fecha.toISOString() },
        sms: BrcSms.codificarReporte({ tipo: 'G', id: id, latitud: l.latitud, longitud: l.longitud, precisionMetros: l.precisionMetros, fecha: fecha }),
        titulo: 'Foco GPS',
      };
    }
    var d = datosDistancia();
    if (!d.comunidad) throw new Error('Elija la comunidad más cercana a usted.');
    if (!d.rumbo) throw new Error('Indique hacia dónde ve el humo (N, S, E u O).');
    if (!d.distanciaKm || d.distanciaKm < 0.1 || d.distanciaKm > 50) throw new Error('La distancia estimada debe estar entre 0,1 y 50 km.');
    return {
      cuerpo: { id: id, tipoReporte: 'Distancia', comunidadId: d.comunidad.id, rumbo: d.rumbo, distanciaKm: d.distanciaKm, fechaReporte: fecha.toISOString() },
      sms: BrcSms.codificarReporte({ tipo: 'D', id: id, comunidadId: d.comunidad.id, rumbo: d.rumbo, distanciaKm: d.distanciaKm, fecha: fecha }),
      titulo: 'Humo a ' + d.distanciaKm + ' km al ' + d.rumbo + ' de ' + d.comunidad.nombre,
    };
  }

  function enviar(evento) {
    evento.preventDefault();
    texto($('error-reporte'), '');
    var armado;
    try {
      armado = construirReporte();
    } catch (e) {
      return texto($('error-reporte'), e.message);
    }
    $('enviar').disabled = true;
    var registro = {
      id: armado.cuerpo.id,
      cuerpo: armado.cuerpo,
      titulo: armado.titulo,
      smsTexto: armado.sms,
      foto: estado.foto ? estado.foto.blob : null,
      fotoCapturadaEn: estado.foto ? estado.foto.capturadaEn : null,
      fotoSubida: false,
      estado: 'pendiente',
      respuesta: null,
      error: null,
      canal: null,
      creadoEn: new Date().toISOString(),
    };
    // Primero se persiste localmente (transacción atómica); recién después se intenta la red.
    BrcAlmacen.guardarReporte(registro)
      .then(function () {
        limpiarFormulario();
        var aviso = $('aviso-envio');
        aviso.hidden = false;
        aviso.textContent = BrcSync.hayDatos()
          ? 'Reporte guardado. Enviando…'
          : '[!] Sin señal de datos: el reporte quedó guardado. Envíelo por SMS desde "Mis reportes"; se sincronizará solo al volver la señal.';
        pintarLista();
        return BrcSync.sincronizar();
      })
      .then(function () {
        return pintarLista();
      })
      .then(function () {
        $('enviar').disabled = false;
      }, function (e) {
        $('enviar').disabled = false;
        texto($('error-reporte'), 'No se pudo guardar el reporte: ' + e.message);
      });
  }

  function limpiarFormulario() {
    estado.lecturaGps = null;
    texto($('lectura-gps'), 'Sin coordenadas todavía');
    $('distancia').value = '';
    Array.prototype.forEach.call(document.querySelectorAll('input[name="rumbo"]'), function (r) {
      r.checked = false;
    });
    quitarFoto();
    pintarContacto();
  }

  // ---------- canal SMS (HU-1.3; pasarela simulada) ----------

  function simularSms(reporte, boton) {
    boton.disabled = true;
    // En la vida real el SMS viaja por la red GSM; el simulador lo entrega a la misma entrada que usará el
    // proveedor, por eso necesita alcanzar el servidor.
    BrcApi.post('/sms/simulador', { texto: reporte.smsTexto }).then(
      function (res) {
        var r = res.datos;
        var cambios = { canal: 'SMS', respuestaSms: r.respuesta };
        if (r.estado === 'Procesado') {
          cambios.respuesta = r.reporte;
          // La foto no viaja por SMS: el reporte queda pendiente solo para subirla cuando haya datos.
          cambios.estado = reporte.foto && !reporte.fotoSubida ? 'pendiente' : 'enviado';
        } else {
          cambios.error = 'SMS rechazado: ' + r.motivo;
        }
        return BrcAlmacen.actualizarReporte(reporte.id, cambios).then(pintarLista);
      },
      function (e) {
        boton.disabled = false;
        alert('El simulador SMS no respondió (' + e.message + '). Use "Abrir SMS" para enviarlo desde el teléfono.');
      },
    );
  }

  // ---------- lista de reportes ----------

  var ETIQUETAS = { pendiente: 'En cola', enviado: 'Recibido', error: 'Rechazado' };

  function pintarLista() {
    return BrcAlmacen.reportes().then(function (lista) {
      var ul = $('lista-reportes');
      ul.innerHTML = '';
      if (!lista.length) {
        var vacio = document.createElement('li');
        vacio.className = 'nota';
        vacio.textContent = 'Todavía no envió reportes.';
        ul.appendChild(vacio);
      }
      var numero = BrcAjustes.obtener('numeroCentral', null);
      lista.slice(0, 30).forEach(function (r) {
        var li = $('plantilla-reporte').content.firstElementChild.cloneNode(true);
        li.dataset.id = r.id;
        li.dataset.estado = r.estado;
        texto(li.querySelector('.titulo'), r.titulo + ' · ' + hora(r.creadoEn));
        var insignia = li.querySelector('.estado');
        var etiqueta = ETIQUETAS[r.estado];
        if (r.estado === 'pendiente' && r.respuesta) etiqueta = 'Recibido (falta foto)';
        if (r.canal === 'SMS' && r.respuesta) etiqueta += ' por SMS';
        texto(insignia, etiqueta);
        insignia.className = 'insignia estado estado-' + r.estado;
        var detalle = '';
        if (r.respuesta) {
          detalle = 'Riesgo ' + r.respuesta.nivelRiesgo + ': ' + r.respuesta.justificacionRiesgo;
          var c = r.respuesta.contactoComunal;
          detalle += c ? ' · Contacto: ' + c.nombreAutoridad + ' ' + c.telefono : ' · Sin contacto comunal registrado';
        } else if (r.error) {
          detalle = r.error;
        } else {
          detalle = BrcSync.hayDatos() ? 'Enviando…' : 'Guardado en el teléfono; se enviará al volver la señal.';
        }
        if (r.foto) detalle += r.fotoSubida ? ' · Foto enviada' : ' · Foto pendiente';
        texto(li.querySelector('.detalle'), detalle);

        if (r.estado === 'pendiente' && !r.respuesta && !BrcSync.hayDatos()) {
          li.querySelector('.sms').hidden = false;
          texto(li.querySelector('.texto-sms'), r.smsTexto + '  (' + r.smsTexto.length + ' car.)');
          var abrir = li.querySelector('.abrir-sms');
          if (numero) abrir.href = 'sms:' + numero + '?body=' + encodeURIComponent(r.smsTexto);
          else abrir.hidden = true;
          li.querySelector('.simular-sms').addEventListener('click', function (e) {
            simularSms(r, e.currentTarget);
          });
        }
        ul.appendChild(li);
      });
    });
  }

  // ---------- estado de red y ajustes ----------

  function pintarRed() {
    var insignia = $('estado-red');
    var datos = BrcSync.hayDatos();
    insignia.textContent = datos ? 'Con datos' : 'Sin datos';
    insignia.className = 'insignia ' + (datos ? 'estado-enviado' : 'estado-error');
    if (BrcAjustes.obtener('sesionVencida', false)) {
      BrcAjustes.fijar('sesionVencida', false);
      alert('Su código de acceso ya no es válido. Ingrese nuevamente; sus reportes guardados se conservan.');
      cerrarSesion();
    }
  }

  function pintarAjustes() {
    texto($('numero-central'), BrcAjustes.obtener('numeroCentral', null) || 'no configurado');
    $('simular-sin-datos').checked = !!BrcAjustes.obtener('simularSinDatos', false);
  }

  // ---------- arranque ----------

  function cambioModo() {
    var gps = modo() === 'GPS';
    $('seccion-gps').hidden = !gps;
    $('seccion-distancia').hidden = gps;
    if (!gps) detenerGps();
    pintarContacto();
  }

  function iniciar() {
    BrcEvaluacion.iniciar();
    BrcPanel.iniciar({
      abrirFoco: function (id) {
        elegirPestana('evaluacion', id);
      },
    });
    BrcCartas.iniciar();
    BrcBrigada.iniciar();
    Object.keys(PESTANAS).forEach(function (n) {
      $('tab-' + n).addEventListener('click', function () {
        elegirPestana(n);
      });
    });
    $('form-login').addEventListener('submit', iniciarSesion);
    $('form-reporte').addEventListener('submit', enviar);
    $('capturar-gps').addEventListener('click', capturarGps);
    $('archivo-foto').addEventListener('change', elegirFoto);
    $('quitar-foto').addEventListener('click', function () {
      quitarFoto();
    });
    $('cerrar-sesion').addEventListener('click', cerrarSesion);
    $('simular-sin-datos').addEventListener('change', function (e) {
      BrcAjustes.fijar('simularSinDatos', e.target.checked);
      pintarRed();
      if (!e.target.checked) BrcSync.sincronizar().then(pintarLista);
      pintarLista();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="modo"]'), function (r) {
      r.addEventListener('change', cambioModo);
    });
    ['comunidad', 'distancia'].forEach(function (id) {
      $(id).addEventListener('input', pintarContacto);
      $(id).addEventListener('change', pintarContacto);
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="rumbo"]'), function (r) {
      r.addEventListener('change', pintarContacto);
    });
    self.addEventListener('online', function () {
      pintarRed();
      pintarLista();
    });
    self.addEventListener('offline', function () {
      pintarRed();
      pintarLista();
    });
    BrcSync.alCambiar(function () {
      pintarRed();
      pintarLista();
      cargarCatalogo();
    });
    BrcSync.iniciar();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    if (BrcAjustes.obtener('token', null)) entrar();
    else mostrar('login');
  }

  iniciar();
})();
