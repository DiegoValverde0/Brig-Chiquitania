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
  var urlCarta = null; // documento descargado (object URL), se libera al cambiar de foco
  var ETIQUETA_CARTA = {
    por_validar: 'Recibida, por validar: ya habilita el despacho',
    validada: 'Validada por el coordinador',
    rechazada: 'Rechazada: el despacho queda bloqueado hasta que la UGR adjunte otra',
  };

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
    liberarDocumento();
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

    pintarCarta();
    pintarReactivacion();

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

  // ---------- carta municipal (CU-08, Ley 602) ----------

  function liberarDocumento() {
    if (urlCarta) URL.revokeObjectURL(urlCarta);
    urlCarta = null;
    $('carta-imagen').hidden = true;
    $('carta-imagen').removeAttribute('src');
    $('carta-enlace').hidden = true;
    $('carta-enlace').removeAttribute('href');
  }

  function pintarCarta() {
    var c = actual.carta;
    liberarDocumento();
    texto($('mensaje-carta'), '');
    $('motivo-rechazo').value = '';
    validarMotivo();
    var estado = $('carta-estado');
    estado.innerHTML = '';
    if (!c) {
      estado.appendChild(insigniaCarta(document.createElement('span'), 'sin_carta'));
      estado.appendChild(document.createTextNode(' La UGR aún no adjuntó la carta: el despacho está bloqueado.'));
    } else {
      estado.appendChild(insigniaCarta(document.createElement('span'), c.estado));
      var linea = ' ' + ETIQUETA_CARTA[c.estado] + ' · emitida el ' + c.fechaEmision;
      if (c.tieneArchivo) linea += ' · ' + (c.tipoMime === 'application/pdf' ? 'PDF' : 'imagen') + ', ' + c.pesoKB + ' KB';
      else linea += ' · referencia sin archivo (anterior al Bolt 3)';
      estado.appendChild(document.createTextNode(linea));
      if (c.motivoRechazo) {
        var motivo = document.createElement('span');
        motivo.className = 'bloque';
        motivo.textContent = 'Motivo: ' + c.motivoRechazo;
        estado.appendChild(motivo);
      }
    }
    var abierta = actual.estado !== 'Cerrado';
    $('carta-documento').hidden = !(c && c.tieneArchivo);
    $('carta-acciones').hidden = !(c && c.tieneArchivo && c.estado !== 'rechazada' && abierta);
    $('validar-carta').hidden = !(c && c.estado === 'por_validar');
  }

  function insigniaCarta(el, estado) {
    var etiquetas = { sin_carta: 'Sin carta', por_validar: 'Por validar', validada: 'Con carta', rechazada: 'Rechazada' };
    el.textContent = etiquetas[estado];
    el.className = 'insignia carta-' + estado;
    return el;
  }

  function verDocumento() {
    var boton = $('ver-carta');
    boton.disabled = true;
    texto($('mensaje-carta'), 'Descargando…');
    BrcApi.blob('/incidentes/' + actual.id + '/carta-municipal/archivo').then(
      function (res) {
        boton.disabled = false;
        texto($('mensaje-carta'), '');
        liberarDocumento();
        urlCarta = URL.createObjectURL(res.datos);
        var esPdf = res.datos.type === 'application/pdf';
        if (!esPdf) {
          $('carta-imagen').src = urlCarta;
          $('carta-imagen').hidden = false;
        }
        var enlace = $('carta-enlace');
        enlace.href = urlCarta;
        enlace.setAttribute('download', 'carta-FOCO-' + actual.id.slice(0, 8) + (esPdf ? '.pdf' : '.jpg'));
        enlace.hidden = false;
      },
      function (e) {
        boton.disabled = false;
        texto($('mensaje-carta'), 'No se pudo descargar: ' + e.message);
      },
    );
  }

  function validarMotivo() {
    var largo = $('motivo-rechazo').value.trim().length;
    var contador = $('contador-motivo');
    contador.textContent = largo + '/' + MINIMO + ' car.';
    contador.className = 'contador ' + (largo >= MINIMO ? 'ok' : 'falta');
    $('rechazar-carta').disabled = !(largo >= MINIMO && largo <= 500);
  }

  function verificarCarta(resultado) {
    var cuerpo = { resultado: resultado };
    if (resultado === 'Rechazada') cuerpo.motivo = $('motivo-rechazo').value;
    $('validar-carta').disabled = true;
    $('rechazar-carta').disabled = true;
    texto($('mensaje-carta'), 'Guardando…');
    BrcApi.post('/incidentes/' + actual.id + '/carta-municipal/verificacion', cuerpo).then(
      function (res) {
        actual.carta = res.datos;
        $('validar-carta').disabled = false;
        pintarCarta();
        texto($('mensaje-carta'), resultado === 'Validada' ? '✔ Carta validada (queda auditado).' : '✔ Carta rechazada: el despacho queda bloqueado.');
      },
      function (e) {
        $('validar-carta').disabled = false;
        validarMotivo();
        texto($('mensaje-carta'), 'No se guardó: ' + e.message);
      },
    );
  }

  // ---------- reactivación (Bolt 4, decisión 7.2) ----------

  function pintarReactivacion() {
    $('detalle-reactivar').hidden = actual.estado !== 'En_Liquidacion';
    $('justificacion-reactivar').value = '';
    texto($('mensaje-reactivar'), '');
    validarReactivacion();
    var aviso = $('detalle-reactivado');
    aviso.hidden = !actual.reactivaciones;
    if (actual.reactivaciones) {
      texto(aviso, '⟳ Foco reactivado ' + (actual.reactivaciones > 1 ? actual.reactivaciones + ' veces' : '') + ' · última vez ' + hora(actual.reactivadoEn));
    }
  }

  function validarReactivacion() {
    var largo = $('justificacion-reactivar').value.trim().length;
    var contador = $('contador-reactivar');
    contador.textContent = largo + '/' + MINIMO + ' car.';
    contador.className = 'contador ' + (largo >= MINIMO ? 'ok' : 'falta');
    $('reactivar-foco').disabled = !(actual && largo >= MINIMO && largo <= 500);
  }

  function reactivar() {
    if (!confirm('¿Reactivar FOCO-' + actual.id.slice(0, 8) + '? Vuelve a Nuevo con riesgo Alto para un nuevo despacho.')) return;
    $('reactivar-foco').disabled = true;
    texto($('mensaje-reactivar'), 'Guardando…');
    BrcApi.post('/incidentes/' + actual.id + '/reactivacion', { justificacion: $('justificacion-reactivar').value }).then(
      function (res) {
        actual = res.datos;
        pintarDetalle();
        texto($('mensaje-reactivar'), '');
        texto($('mensaje-reclasificacion'), '✔ Foco reactivado: está primero en la columna Nuevo del panel.');
      },
      function (e) {
        validarReactivacion();
        texto($('mensaje-reactivar'), 'No se reactivó: ' + e.message);
      },
    );
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
    $('ver-carta').addEventListener('click', verDocumento);
    $('validar-carta').addEventListener('click', function () {
      verificarCarta('Validada');
    });
    $('rechazar-carta').addEventListener('click', function () {
      verificarCarta('Rechazada');
    });
    $('motivo-rechazo').addEventListener('input', validarMotivo);
    $('justificacion-reactivar').addEventListener('input', validarReactivacion);
    $('reactivar-foco').addEventListener('click', reactivar);
  }

  /** Muestra la lista; con un id (tarjeta del panel COED) abre directamente ese foco. */
  function mostrar(id) {
    if (!id) {
      $('detalle-foco').hidden = true;
      $('lista-focos').hidden = false;
      return cargarLista();
    }
    return abrir(id);
  }

  global.BrcEvaluacion = { iniciar: iniciar, mostrar: mostrar, insigniaCarta: insigniaCarta };
})(self);
