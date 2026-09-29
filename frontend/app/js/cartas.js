/*
 * Bandeja de cartas municipales (CU-08, Ley 602): focos activos sin carta o con la carta rechazada.
 * La UGR adjunta el PDF o la foto de la carta firmada con su fecha de emisión; el coordinador puede hacerlo como
 * contingencia (Release Plan, riesgo del Bolt 3). Máximo 1 MB: las fotos se comprimen en el teléfono (foto.js).
 * Necesita conexión (la carta es un trámite de la oficina municipal, no de campo).
 */
(function (global) {
  'use strict';

  var PESO_MAXIMO = 1024 * 1024;
  var LADO_FOTO = 2000; // una carta necesita más resolución que la foto del foco para leerse
  var $ = function (id) {
    return document.getElementById(id);
  };

  function el(etiqueta, clase, contenido) {
    var e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    if (contenido !== undefined) e.textContent = contenido;
    return e;
  }

  function hoy() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function cargar() {
    $('error-cartas').textContent = '';
    return BrcApi.get('/cartas/pendientes').then(
      function (res) {
        var ul = $('lista-cartas');
        ul.innerHTML = '';
        if (!res.datos.length) ul.appendChild(el('li', 'nota', 'Todos los focos activos tienen su carta municipal.'));
        res.datos.forEach(function (f) {
          ul.appendChild(item(f));
        });
      },
      function (e) {
        $('error-cartas').textContent = e.estado === 0 ? 'Sin conexión: las cartas se adjuntan con red.' : e.message;
      },
    );
  }

  function item(f) {
    var li = el('li', 'reporte carta-pendiente');
    li.dataset.id = f.id;
    var cabecera = el('div', 'cabecera-reporte');
    cabecera.appendChild(el('strong', null, 'FOCO-' + f.id.slice(0, 8) + ' · ' + (f.comunidad || 'sin comunidad')));
    cabecera.appendChild(el('span', 'insignia riesgo-' + (f.nivelRiesgo || 'ninguno'), f.nivelRiesgo || 'Sin calcular'));
    li.appendChild(cabecera);
    li.appendChild(el('p', 'nota', 'Reportado el ' + new Date(f.fechaReporte).toLocaleString() + ' · ' + f.estado.replace('_', ' ')));
    if (f.carta && f.carta.estado === 'rechazada') {
      var aviso = el('p', 'aviso', 'Carta rechazada por el COED: ' + f.carta.motivoRechazo + '. Adjunte una nueva.');
      li.appendChild(aviso);
    }

    var form = el('form', 'form-carta');
    form.noValidate = true;
    var idArchivo = 'archivo-carta-' + f.id;
    var idFecha = 'fecha-carta-' + f.id;
    var etiquetaArchivo = el('label', 'boton', '📄 Elegir PDF o foto de la carta');
    etiquetaArchivo.setAttribute('for', idArchivo);
    var archivo = el('input');
    archivo.type = 'file';
    archivo.id = idArchivo;
    archivo.accept = 'application/pdf,image/*';
    archivo.className = 'oculto';
    var peso = el('p', 'nota peso-carta', 'Ningún archivo elegido');
    var etiquetaFecha = el('label', null, 'Fecha de emisión de la carta');
    etiquetaFecha.setAttribute('for', idFecha);
    var fecha = el('input');
    fecha.type = 'date';
    fecha.id = idFecha;
    fecha.value = hoy();
    fecha.max = hoy();
    var enviar = el('button', 'boton boton-principal', 'ADJUNTAR CARTA');
    enviar.type = 'submit';
    enviar.disabled = true;
    var mensaje = el('p', 'nota mensaje-carta');
    mensaje.setAttribute('role', 'status');
    [etiquetaArchivo, archivo, peso, etiquetaFecha, fecha, enviar, mensaje].forEach(function (n) {
      form.appendChild(n);
    });
    li.appendChild(form);

    var listo = null; // Blob a enviar
    archivo.addEventListener('change', function () {
      var elegido = archivo.files[0];
      listo = null;
      enviar.disabled = true;
      mensaje.textContent = '';
      if (!elegido) return;
      preparar(elegido).then(
        function (blob) {
          listo = blob;
          peso.textContent = elegido.name + ' · ' + Math.round(blob.size / 1024) + ' KB' + (blob !== elegido ? ' (foto comprimida)' : '');
          enviar.disabled = false;
        },
        function (e) {
          peso.textContent = e.message;
        },
      );
    });
    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (!listo) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha.value)) {
        mensaje.textContent = 'Indique la fecha de emisión de la carta.';
        return;
      }
      enviar.disabled = true;
      mensaje.textContent = 'Enviando…';
      BrcApi.postBinario('/incidentes/' + f.id + '/carta-municipal', listo, { 'x-fecha-emision': fecha.value }).then(
        function () {
          mensaje.textContent = '✔ Carta adjunta: queda "por validar" y ya habilita el despacho.';
          li.className += ' adjuntada';
          form.hidden = true;
          var ok = el('p', 'destacado', '✔ Carta adjunta (' + Math.round(listo.size / 1024) + ' KB) · por validar en el COED');
          li.appendChild(ok);
        },
        function (e) {
          enviar.disabled = false;
          mensaje.textContent = 'No se adjuntó: ' + e.message;
        },
      );
    });
    return li;
  }

  /** PDF: se envía tal cual si cabe en 1 MB. Imagen: se comprime a JPEG ≤1 MB si hace falta. */
  function preparar(archivo) {
    var esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name);
    if (esPdf) {
      if (archivo.size > PESO_MAXIMO) return Promise.reject(new Error('El PDF pesa más de 1 MB: escanéelo en menor resolución.'));
      return Promise.resolve(archivo);
    }
    if (!/^image\//.test(archivo.type)) return Promise.reject(new Error('Elija un PDF o una foto (JPEG, PNG o WebP).'));
    if (archivo.size <= PESO_MAXIMO && /^image\/(jpeg|png|webp)$/.test(archivo.type)) return Promise.resolve(archivo);
    return BrcFoto.comprimir(archivo, { pesoMaximo: PESO_MAXIMO, lado: LADO_FOTO });
  }

  function iniciar() {
    $('actualizar-cartas').addEventListener('click', cargar);
  }

  global.BrcCartas = { iniciar: iniciar, mostrar: cargar };
})(self);
