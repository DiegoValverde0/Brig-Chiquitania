/*
 * Informes de cierre (Bolt 5, HU-5.4, RF-13): focos cerrados con su informe consolidado en PDF inmutable y el
 * resumen del KPI (ΔT promedio y % que cumple la meta del 30 % frente a 180 min). Coordinador y UGR municipal
 * (decisión 7.6 del PO, Ley 602). Necesita conexión.
 */
(function (global) {
  'use strict';

  var ETIQUETA = { Controlado: 'Controlado', Extendido: 'Extendido', Falso_Positivo: 'Falso positivo' };
  var $ = function (id) {
    return document.getElementById(id);
  };
  var urls = [];

  function el(etiqueta, clase, contenido) {
    var e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    if (contenido !== undefined) e.textContent = contenido;
    return e;
  }

  function fecha(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /** Baja el PDF con el token y dispara la descarga; devuelve el object URL (se libera al recargar la lista). */
  function descargar(incidenteId) {
    return BrcApi.blob('/incidentes/' + incidenteId + '/informe/pdf').then(function (res) {
      var url = URL.createObjectURL(res.datos);
      urls.push(url);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'informe-FOCO-' + incidenteId.slice(0, 8) + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return url;
    });
  }

  function cargar() {
    $('error-informes').textContent = '';
    urls.forEach(function (u) {
      URL.revokeObjectURL(u);
    });
    urls = [];
    return BrcApi.get('/informes').then(
      function (res) {
        var r = res.datos.resumen;
        $('kpi-informes').textContent =
          r.total + (r.total === 1 ? ' foco cerrado · ' : ' focos cerrados · ') +
          r.falsosPositivos + (r.falsosPositivos === 1 ? ' falso positivo · ' : ' falsos positivos · ') +
          (r.deltaPromedioMin !== null
            ? 'ΔT promedio ' + r.deltaPromedioMin + ' min (' + r.conLlegada + ' con llegada; línea base ' + r.lineaBaseMin + ' min) · ' +
              r.pctCumpleMeta + ' % cumple la meta del ' + r.metaAhorroPct + ' %'
            : 'sin llegadas confirmadas todavía');
        var ul = $('lista-informes');
        ul.innerHTML = '';
        if (!res.datos.informes.length) ul.appendChild(el('li', 'nota', 'Todavía no hay focos cerrados.'));
        res.datos.informes.forEach(function (i) {
          var li = el('li', 'reporte informe');
          li.dataset.id = i.incidenteId;
          var cabecera = el('div', 'cabecera-reporte');
          cabecera.appendChild(el('strong', null, 'FOCO-' + i.incidenteId.slice(0, 8) + ' · ' + (i.comunidad || 'sin comunidad')));
          cabecera.appendChild(el('span', 'insignia cierre-' + i.resultado, ETIQUETA[i.resultado]));
          li.appendChild(cabecera);
          li.appendChild(
            el(
              'p',
              'nota',
              'Cerrado ' + fecha(i.fechaGeneracion) + ' · riesgo ' + (i.nivelRiesgo || '—') +
                (i.tiempoTotalDespacho !== null ? ' · ΔT ' + i.tiempoTotalDespacho + ' min' : ' · sin llegada') +
                (i.justificacionFalsoPositivo ? ' · ' + i.justificacionFalsoPositivo : ''),
            ),
          );
          var boton = el('button', 'boton descargar-pdf', '📑 Descargar PDF (' + i.pesoKB + ' KB)');
          boton.type = 'button';
          boton.addEventListener('click', function () {
            boton.disabled = true;
            descargar(i.incidenteId).then(
              function () {
                boton.disabled = false;
              },
              function (e) {
                boton.disabled = false;
                $('error-informes').textContent = 'No se descargó: ' + e.message;
              },
            );
          });
          li.appendChild(boton);
          li.appendChild(el('p', 'nota sha', 'SHA-256 ' + i.sha256));
          ul.appendChild(li);
        });
      },
      function (e) {
        $('error-informes').textContent = e.estado === 0 ? 'Sin conexión: los informes necesitan red.' : e.message;
      },
    );
  }

  function iniciar() {
    $('actualizar-informes').addEventListener('click', cargar);
  }

  global.BrcInformes = { iniciar: iniciar, mostrar: cargar, descargar: descargar };
})(self);
