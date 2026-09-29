/*
 * Vista del Jefe de Brigada (RF-08; Acta ACTA-002, acuerdo 4): estado táctico de su brigada y el botón
 * "Reportar: En Liquidación / Por finalizar", disponible solo cuando la brigada está En Combate Activo.
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
  var $ = function (id) {
    return document.getElementById(id);
  };
  var actual = null;

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
    var puede = b.estadoOperativo === 'En_Combate_Activo';
    $('reportar-liquidacion').hidden = !puede;
    if (b.estadoOperativo === 'En_Liquidacion') linea(caja, 'La central liberará la brigada al terminar la liquidación.', 'nota');
  }

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
        $('mi-brigada').innerHTML = '';
        linea(
          $('mi-brigada'),
          e.estado === 0 ? 'Sin conexión: el estado de la brigada necesita red.' : e.message,
          'error',
        );
      },
    );
  }

  function reportarLiquidacion() {
    if (!actual) return;
    if (!confirm('¿Confirmar que la brigada está EN LIQUIDACIÓN / POR FINALIZAR?')) return;
    var boton = $('reportar-liquidacion');
    boton.disabled = true;
    $('mensaje-brigada').textContent = 'Enviando…';
    BrcApi.post('/brigadas/' + actual.id + '/estado', { estado: 'En_Liquidacion' }).then(
      function (res) {
        boton.disabled = false;
        actual = res.datos;
        pintar();
        $('mensaje-brigada').textContent = '✔ Reportado a la central: brigada en liquidación.';
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
  }

  global.BrcBrigada = { iniciar: iniciar, mostrar: cargar };
})(self);
