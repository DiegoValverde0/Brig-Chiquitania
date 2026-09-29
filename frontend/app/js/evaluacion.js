/*
 * Pantalla "Evaluación de riesgo" del Coordinador de Despacho (CU-02, Actividad 3 Figura 8; HU-2.1, HU-2.2).
 * Muestra lo que calculó el motor (nivel, justificación y factores: RF-05) y permite reclasificar con una
 * justificación obligatoria de 15 caracteres o más (RF-06). El botón queda desactivado hasta cumplirlo; la API
 * valida lo mismo. Es una pantalla del COED: necesita conexión.
 */
(function (global) {
  'use strict';

  var MINIMO = 15;
  var COLUMNAS = ['Nuevo', 'Asignado', 'En_Atencion', 'En_Liquidacion'];
  var ETIQUETA_ESTADO = { Nuevo: 'Nuevo', Asignado: 'Asignado', En_Atencion: 'En atención', En_Liquidacion: 'En liquidación', Cerrado: 'Cerrado' };
  var ETIQUETA_REGLA = {
    ComunidadAMenosDe5Km: 'Comunidad habitada a menos del umbral Alto',
    ComunidadEntre5y15Km: 'Comunidad habitada dentro de la franja Medio',
    SinComunidadCercana: 'Sin comunidad habitada dentro de la franja evaluada',
    CatalogoVacio: 'Catálogo de comunidades vacío',
  };
  var $ = function (id) {
    return document.getElementById(id);
  };
  var actual = null; // evaluación del foco abierto

  function texto(el, valor) {
    el.textContent = valor;
    return el;
  }

  function hora(iso) {
    var d = new Date(iso);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + d.toLocaleDateString();
  }

  function insigniaNivel(el, nivel) {
    el.textContent = nivel || 'Sin calcular';
    el.className = 'insignia riesgo-' + (nivel || 'ninguno');
    return el;
  }

  // ---------- lista de focos activos ----------

  function cargarLista() {
    texto($('error-evaluacion'), '');
    var ul = $('lista-focos');
    return BrcApi.get('/panel').then(
      function (res) {
        var focos = [];
        COLUMNAS.forEach(function (c) {
          (res.datos.incidentes[c] || []).forEach(function (i) {
            i.estado = c;
            focos.push(i);
          });
        });
        ul.innerHTML = '';
        if (!focos.length) {
          var vacio = document.createElement('li');
          vacio.className = 'nota';
          vacio.textContent = 'No hay focos activos.';
          ul.appendChild(vacio);
        }
        focos.forEach(function (f) {
          var li = document.createElement('li');
          li.className = 'reporte foco';
          li.dataset.id = f.id;
          var boton = document.createElement('button');
          boton.type = 'button';
          boton.className = 'foco-boton';
          var cabecera = document.createElement('span');
          cabecera.className = 'cabecera-reporte';
          var titulo = document.createElement('strong');
          titulo.textContent = 'FOCO-' + f.id.slice(0, 8) + ' · ' + (f.comunidad || 'sin comunidad');
          cabecera.appendChild(titulo);
          cabecera.appendChild(insigniaNivel(document.createElement('span'), f.nivelRiesgo));
          boton.appendChild(cabecera);
          var detalle = document.createElement('span');
          detalle.className = 'nota bloque';
          detalle.textContent =
            ETIQUETA_ESTADO[f.estado] + ' · ' + hora(f.fechaReporte) + (f.origenRiesgo === 'Manual' ? ' · Reclasificado' : '');
          boton.appendChild(detalle);
          boton.addEventListener('click', function () {
            abrir(f.id);
          });
          li.appendChild(boton);
          ul.appendChild(li);
        });
      },
      function (e) {
        texto($('error-evaluacion'), e.estado === 0 ? 'Sin conexión: la evaluación de riesgo necesita red.' : e.message);
      },
    );
  }

  // ---------- detalle del foco ----------

  function abrir(id) {
    texto($('error-evaluacion'), '');
    return BrcApi.get('/incidentes/' + id + '/evaluacion').then(
      function (res) {
        actual = res.datos;
        pintarDetalle();
        $('lista-focos').hidden = true;
        $('detalle-foco').hidden = false;
        $('detalle-foco').scrollIntoView();
      },
      function (e) {
        texto($('error-evaluacion'), e.message);
      },
    );
  }

  function cerrar() {
    actual = null;
    $('detalle-foco').hidden = true;
    $('lista-focos').hidden = false;
    cargarLista();
  }

  function pintarDetalle() {
    var e = actual;
    var f = e.factores;
    texto($('detalle-titulo'), 'FOCO-' + e.id.slice(0, 8) + ' — Evaluación de riesgo');
    insigniaNivel($('detalle-nivel'), e.nivelRiesgo);
    texto($('detalle-origen'), e.origenRiesgo === 'Manual' ? '(reclasificado manualmente)' : '(calculado por el motor)');
    var cercana = f && f.comunidadMasCercana;
    texto(
      $('detalle-distancia'),
      cercana ? 'Distancia a comunidad: ' + cercana.distanciaKm + ' km (' + cercana.nombre + ')' : 'Sin comunidad habitada en el catálogo',
    );
    texto($('detalle-justificacion'), e.justificacionAlgoritmo ? '“' + e.justificacionAlgoritmo + '”' : 'Sin justificación registrada');

    var factores = $('detalle-factores');
    factores.innerHTML = '';
    var agregar = function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      factores.appendChild(li);
    };
    if (f) {
      agregar('Regla aplicada: ' + (ETIQUETA_REGLA[f.regla] || f.regla));
      agregar('Umbrales: Alto < ' + f.umbrales.altoKm + ' km · Medio < ' + f.umbrales.medioKm + ' km de una comunidad habitada');
      if (f.prediosExcluidos.length) {
        f.prediosExcluidos.forEach(function (p) {
          agregar('Excluido de la priorización: ' + p.tipo + ' ' + p.nombre + ' a ' + p.distanciaKm + ' km');
        });
      } else {
        agregar('Sin estancias ni predios privados en la franja evaluada');
      }
      agregar('Versión de las reglas: ' + f.version + ' · cálculo en ' + f.duracionMs + ' ms');
    } else {
      agregar('Incidente evaluado antes del motor explicable (sin factores registrados).');
    }

    // Formulario: se limpia y se deshabilita el nivel vigente.
    Array.prototype.forEach.call(document.querySelectorAll('input[name="nivel"]'), function (r) {
      r.checked = false;
      r.disabled = r.value === e.nivelRiesgo || e.estado === 'Cerrado';
    });
    $('justificacion').value = '';
    texto($('mensaje-reclasificacion'), '');
    validar();

    var historial = $('detalle-historial');
    historial.innerHTML = '';
    if (!e.reclasificaciones.length) {
      var vacio = document.createElement('li');
      vacio.className = 'nota';
      vacio.textContent = 'Sin reclasificaciones: rige el cálculo del motor.';
      historial.appendChild(vacio);
    }
    e.reclasificaciones.forEach(function (h) {
      var li = document.createElement('li');
      li.className = 'reporte';
      var linea = document.createElement('strong');
      linea.textContent = h.nivelAnterior + ' → ' + h.nivelNuevo + ' · ' + hora(h.creadoEn);
      var quien = document.createElement('p');
      quien.className = 'nota';
      quien.textContent = 'Por ' + (h.usuario ? h.usuario.nombre + ' (' + h.usuario.rol + ')' : 'sistema');
      var motivo = document.createElement('p');
      motivo.textContent = h.justificacion;
      li.appendChild(linea);
      li.appendChild(quien);
      li.appendChild(motivo);
      historial.appendChild(li);
    });
  }

  // ---------- reclasificación (HU-2.2) ----------

  function nivelElegido() {
    var r = document.querySelector('input[name="nivel"]:checked');
    return r ? r.value : null;
  }

  function validar() {
    var largo = $('justificacion').value.trim().length;
    var contador = $('contador');
    contador.textContent = largo + '/' + MINIMO + ' car.';
    contador.className = 'contador ' + (largo >= MINIMO ? 'ok' : 'falta');
    $('guardar-reclasificacion').disabled = !(actual && nivelElegido() && largo >= MINIMO && largo <= 500);
  }

  function guardar(evento) {
    evento.preventDefault();
    if ($('guardar-reclasificacion').disabled) return;
    $('guardar-reclasificacion').disabled = true;
    texto($('mensaje-reclasificacion'), 'Guardando…');
    BrcApi.post('/incidentes/' + actual.id + '/reclasificacion', {
      nivelRiesgo: nivelElegido(),
      justificacion: $('justificacion').value,
    }).then(
      function (res) {
        actual = res.datos;
        pintarDetalle();
        texto($('mensaje-reclasificacion'), '✔ Reclasificación guardada y registrada en el historial.');
      },
      function (e) {
        texto($('mensaje-reclasificacion'), 'No se guardó: ' + e.message);
        validar();
      },
    );
  }

  function iniciar() {
    $('actualizar-focos').addEventListener('click', cargarLista);
    $('cerrar-detalle').addEventListener('click', cerrar);
    $('justificacion').addEventListener('input', validar);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="nivel"]'), function (r) {
      r.addEventListener('change', validar);
    });
    $('form-reclasificar').addEventListener('submit', guardar);
  }

  global.BrcEvaluacion = { iniciar: iniciar, mostrar: cargarLista };
})(self);
