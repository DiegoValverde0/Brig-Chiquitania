/*
 * Panel Kanban del COED (HU-3.1, CU-07/08/09; Actividad 3, Figura 9). Solo coordinador; necesita conexión.
 * - Filtros de trámite municipal (Ley 602), riesgo y comunidad: los aplica la API (RF-07).
 * - 4 columnas con contadores; "ver más" a partir de 15 tarjetas y desplazamiento propio por columna (RNF-05).
 * - Mapa esquemático en SVG propio, sin teselas ni librerías (RF-01), con focos agrupados por cuadrícula.
 * - Brigadas en sus 4 estados (RF-08); el coordinador libera las que están "En Liquidación".
 * Se actualiza cada 30 s mientras la pestaña está visible, sin perder el filtro ni el desplazamiento.
 * Bolt 4: DESPACHAR (o REASIGNAR) en 1 clic desde la tarjeta, con confirmación humana (RS-03), UUID propio del
 * clic (reintentar no duplica) y la versión de la brigada (bloqueo optimista); focos reactivados primero y estado
 * del aviso al jefe (📨 enviado, ✔ leído, ⚠ fallido).
 */
(function (global) {
  'use strict';

  var COLUMNAS = ['Nuevo', 'Asignado', 'En_Atencion', 'En_Liquidacion'];
  var TITULO_COLUMNA = { Nuevo: 'Nuevo', Asignado: 'Asignado', En_Atencion: 'En atención', En_Liquidacion: 'En liquidación' };
  var ESTADOS_BRIGADA = ['Disponible', 'En_Desplazamiento', 'En_Combate_Activo', 'En_Liquidacion'];
  var ETIQUETA_BRIGADA = {
    Disponible: 'Disponible',
    En_Desplazamiento: 'En desplazamiento',
    En_Combate_Activo: 'En combate',
    En_Liquidacion: 'En liquidación',
  };
  var SIMBOLO_BRIGADA = { Disponible: '*', En_Desplazamiento: '^', En_Combate_Activo: '#', En_Liquidacion: '~' };
  var POR_PAGINA = 15;
  var REFRESCO_MS = 30000;
  var ORDEN_RIESGO = { Alto: 0, Medio: 1, Bajo: 2 };
  // Recuadro aproximado de la Chiquitanía (grados decimales) y celda del agrupamiento.
  var CAJA = { norte: -14.8, sur: -19.2, oeste: -63.6, este: -57.6 };
  var CELDA_GRADOS = 0.3;
  var SVG = 'http://www.w3.org/2000/svg';

  var $ = function (id) {
    return document.getElementById(id);
  };
  var opciones = { abrirFoco: function () {} };
  var visibles = {}; // tarjetas mostradas por columna ("ver más")
  var temporizador = null;
  var esperaBusqueda = null;
  var pidiendo = false;
  var otraVez = false; // un filtro cambió mientras había una consulta en curso
  var ultimo = null;
  var clics = {}; // incidente → UUID del despacho en curso (el mismo en cada reintento)
  var ETIQUETA_AVISO = { Enviada: '📨 Aviso enviado', Leida: '✔ Orden leída', Fallida: '⚠ Aviso fallido: llame al jefe', Pendiente: '… Avisando' };

  function texto(el, valor) {
    el.textContent = valor;
    return el;
  }

  function el(etiqueta, clase, contenido) {
    var e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    if (contenido !== undefined) e.textContent = contenido;
    return e;
  }

  function corto(nombre) {
    return nombre.replace('Brigada Departamental ', 'B');
  }

  function km(d) {
    return (d < 10 ? Math.round(d * 10) / 10 : Math.round(d)) + ' km';
  }

  function hace(iso) {
    var min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    return h < 48 ? 'hace ' + h + ' h ' + (min % 60) + ' min' : 'hace ' + Math.floor(h / 24) + ' días';
  }

  // ---------- filtros ----------

  function consulta() {
    var partes = [];
    var carta = document.querySelector('input[name="carta"]:checked');
    if (carta && carta.value) partes.push('carta=' + carta.value);
    var riesgos = Array.prototype.filter
      .call(document.querySelectorAll('input[name="riesgo"]'), function (r) {
        return r.checked;
      })
      .map(function (r) {
        return r.value;
      });
    if (riesgos.length) partes.push('riesgo=' + riesgos.join(','));
    var comunidad = $('filtro-comunidad').value.trim();
    if (comunidad) partes.push('comunidad=' + encodeURIComponent(comunidad));
    return partes.length ? '?' + partes.join('&') : '';
  }

  function alCambiarFiltro() {
    visibles = {};
    cargar();
  }

  // ---------- carga ----------

  function cargar() {
    if (pidiendo) {
      otraVez = true;
      return Promise.resolve();
    }
    pidiendo = true;
    otraVez = false;
    texto($('error-panel'), '');
    var terminar = function () {
      pidiendo = false;
      if (otraVez) return cargar();
    };
    return BrcApi.get('/panel' + consulta()).then(
      function (res) {
        ultimo = res.datos;
        pintar(res.datos);
        return terminar();
      },
      function (e) {
        texto($('error-panel'), e.estado === 0 ? 'Sin conexión: se muestra la última lectura.' : e.message);
        return terminar();
      },
    );
  }

  function pintar(datos) {
    var r = datos.resumen;
    var hora = new Date();
    texto(
      $('resumen-panel'),
      'Mostrando ' + r.visibles + ' de ' + r.total + ' focos activos · actualizado ' +
        ('0' + hora.getHours()).slice(-2) + ':' + ('0' + hora.getMinutes()).slice(-2) + ':' + ('0' + hora.getSeconds()).slice(-2),
    );
    pintarKanban(datos);
    pintarMapa(datos);
    pintarBrigadas(datos);
  }

  // ---------- Kanban ----------

  function pintarKanban(datos) {
    var kanban = $('kanban');
    // Conserva el desplazamiento de cada columna entre actualizaciones.
    var scroll = {};
    Array.prototype.forEach.call(kanban.querySelectorAll('.columna-lista'), function (l) {
      scroll[l.parentNode.dataset.columna] = l.scrollTop;
    });
    kanban.innerHTML = '';
    COLUMNAS.forEach(function (c) {
      var tarjetas = datos.incidentes[c] || [];
      var cont = datos.resumen.columnas[c];
      var columna = el('section', 'columna');
      columna.dataset.columna = c;
      var cabecera = el('header', 'columna-cabecera');
      cabecera.appendChild(el('h3', null, TITULO_COLUMNA[c]));
      var contador = el('span', 'contador-columna', cont.total + ' · ' + cont.conCarta + ' con carta');
      contador.title = cont.total + ' focos, ' + cont.conCarta + ' con carta municipal';
      cabecera.appendChild(contador);
      columna.appendChild(cabecera);

      var lista = el('ul', 'columna-lista');
      var limite = visibles[c] || POR_PAGINA;
      tarjetas.slice(0, limite).forEach(function (t) {
        lista.appendChild(tarjeta(t));
      });
      if (!tarjetas.length) lista.appendChild(el('li', 'nota vacio', 'Sin focos'));
      columna.appendChild(lista);
      if (tarjetas.length > limite) {
        var mas = el('button', 'enlace ver-mas', 'Ver ' + Math.min(POR_PAGINA, tarjetas.length - limite) + ' más (' + (tarjetas.length - limite) + ' ocultos)');
        mas.type = 'button';
        mas.addEventListener('click', function () {
          visibles[c] = limite + POR_PAGINA;
          pintarKanban(ultimo);
        });
        columna.appendChild(mas);
      }
      kanban.appendChild(columna);
      if (scroll[c]) lista.scrollTop = scroll[c];
    });
  }

  function tarjeta(t) {
    var li = el('li', 'tarjeta-foco riesgo-borde-' + (t.nivelRiesgo || 'ninguno'));
    li.dataset.id = t.id;
    li.dataset.carta = t.estadoCarta;
    var boton = el('button', 'foco-boton');
    boton.type = 'button';
    var cabecera = el('span', 'cabecera-reporte');
    cabecera.appendChild(el('strong', null, 'FOCO-' + t.id.slice(0, 8)));
    var riesgo = el('span', 'insignia riesgo-' + (t.nivelRiesgo || 'ninguno'), t.nivelRiesgo || 'Sin calcular');
    if (t.origenRiesgo === 'Manual') riesgo.textContent += ' ✎';
    cabecera.appendChild(riesgo);
    boton.appendChild(cabecera);
    boton.appendChild(el('span', 'bloque', (t.comunidad || 'Sin comunidad') + ' · ' + hace(t.fechaReporte)));
    var pie = el('span', 'bloque pie-tarjeta');
    pie.appendChild(BrcEvaluacion.insigniaCarta(el('span'), t.estadoCarta));
    if (!t.tieneContactoComunal) pie.appendChild(el('span', 'insignia estado-error', 'Sin contacto'));
    if (t.reactivado) pie.appendChild(el('span', 'insignia reactivado', '⟳ Reactivado'));
    if (t.posibleReactivacion) pie.appendChild(el('span', 'insignia posible-reactivacion', 'Posible reactivación'));
    if (t.brigada) pie.appendChild(el('span', 'nota', '🚒 ' + t.brigada));
    if (t.notificacion) {
      var aviso = t.notificacion.leida ? 'Leida' : t.notificacion.estado;
      var n = el('span', 'insignia aviso aviso-' + aviso, ETIQUETA_AVISO[aviso] + (aviso === 'Enviada' ? ' (' + (t.notificacion.canal === 'SMS' ? 'SMS' : 'push') + ')' : ''));
      n.dataset.aviso = aviso;
      pie.appendChild(n);
    }
    boton.appendChild(pie);
    boton.addEventListener('click', function () {
      opciones.abrirFoco(t.id);
    });
    li.appendChild(boton);
    if (t.estado === 'Nuevo') li.appendChild(zonaDespacho(t));
    return li;
  }

  // ---------- despacho en 1 clic (RF-10, HU-4.3) ----------

  function zonaDespacho(t) {
    var zona = el('div', 'zona-despacho');
    var s = t.sugerencia;
    var boton = el('button', 'boton despachar');
    boton.type = 'button';
    if (s) {
      boton.textContent = (s.reasignacion ? '~ REASIGNAR ' : 'DESPACHAR ') + corto(s.nombre) + ' · ' + km(s.distanciaKm);
      if (s.reasignacion) boton.className += ' reasignar';
      boton.addEventListener('click', function () {
        despachar(t, boton);
      });
    } else {
      boton.textContent = 'DESPACHAR';
      boton.disabled = true;
      boton.title = t.bloqueoDespacho || '';
    }
    zona.appendChild(boton);
    if (!s && t.bloqueoDespacho) zona.appendChild(el('span', 'nota bloqueo', '🔒 ' + t.bloqueoDespacho));
    if (s && s.reasignacion) {
      zona.appendChild(el('span', 'nota', 'En liquidación' + (s.focoAnterior ? ' de FOCO-' + s.focoAnterior.id.slice(0, 8) : '') + ': reasignación táctica'));
    }
    return zona;
  }

  /** RS-03: siempre confirma un humano. Un solo toque abre la confirmación; el segundo despacha. */
  function despachar(t, boton) {
    var s = t.sugerencia;
    var resumen =
      (s.reasignacion ? 'REASIGNACIÓN TÁCTICA\n' : 'DESPACHO\n') +
      'FOCO-' + t.id.slice(0, 8) + ' · riesgo ' + t.nivelRiesgo + ' · ' + (t.comunidad || 'sin comunidad') + '\n' +
      'Brigada: ' + s.nombre + ' (' + km(s.distanciaKm) + ')\n' +
      (s.focoAnterior ? 'Deja FOCO-' + s.focoAnterior.id.slice(0, 8) + ' en liquidación\n' : '') +
      'Se avisará al jefe por push o SMS con la ubicación y el contacto comunal.';
    if (!confirm(resumen)) return;
    if (!clics[t.id]) clics[t.id] = global.BrcUuid();
    boton.disabled = true;
    boton.textContent = 'Despachando…';
    BrcApi.post('/incidentes/' + t.id + '/asignaciones', { id: clics[t.id], brigadaId: s.id, versionBrigada: s.version }).then(
      function () {
        delete clics[t.id];
        texto($('error-panel'), '');
        cargar();
      },
      function (e) {
        if (e.estado === 409 || e.estado === 422) delete clics[t.id]; // la situación cambió: nuevo clic, nuevo id
        boton.disabled = false;
        boton.textContent = 'Reintentar despacho';
        texto($('error-panel'), 'No se despachó FOCO-' + t.id.slice(0, 8) + ': ' + e.message);
        if (e.estado === 409) cargar();
      },
    );
  }

  // ---------- mapa esquemático (SVG, sin teselas) ----------

  function nodo(etiqueta, atributos, contenido) {
    var n = document.createElementNS(SVG, etiqueta);
    Object.keys(atributos).forEach(function (k) {
      n.setAttribute(k, atributos[k]);
    });
    if (contenido !== undefined) n.textContent = contenido;
    return n;
  }

  var ANCHO = 600;
  var ALTO = Math.round((ANCHO * (CAJA.norte - CAJA.sur)) / (CAJA.este - CAJA.oeste));
  function x(lon) {
    return Math.round(((lon - CAJA.oeste) / (CAJA.este - CAJA.oeste)) * ANCHO);
  }
  function y(lat) {
    return Math.round(((CAJA.norte - lat) / (CAJA.norte - CAJA.sur)) * ALTO);
  }
  function dentro(p) {
    return p.latitud <= CAJA.norte && p.latitud >= CAJA.sur && p.longitud >= CAJA.oeste && p.longitud <= CAJA.este;
  }

  /** Agrupa los focos por celda de CELDA_GRADOS; cada grupo toma el riesgo más alto de sus focos. */
  function agrupar(focos) {
    var celdas = {};
    focos.forEach(function (f) {
      var p = f.coordenada;
      if (!dentro(p)) return;
      var clave = Math.floor(p.latitud / CELDA_GRADOS) + ':' + Math.floor(p.longitud / CELDA_GRADOS);
      var c = celdas[clave] || (celdas[clave] = { n: 0, lat: 0, lon: 0, riesgo: null });
      c.n += 1;
      c.lat += p.latitud;
      c.lon += p.longitud;
      if (c.riesgo === null || ORDEN_RIESGO[f.nivelRiesgo] < ORDEN_RIESGO[c.riesgo]) c.riesgo = f.nivelRiesgo || c.riesgo;
    });
    return Object.keys(celdas).map(function (k) {
      var c = celdas[k];
      return { n: c.n, latitud: c.lat / c.n, longitud: c.lon / c.n, riesgo: c.riesgo };
    });
  }

  function pintarMapa(datos) {
    var focos = [];
    COLUMNAS.forEach(function (c) {
      focos = focos.concat(datos.incidentes[c] || []);
    });
    BrcAlmacen.leer('catalogo').then(function (catalogo) {
      var svg = nodo('svg', { viewBox: '0 0 ' + ANCHO + ' ' + ALTO, class: 'mapa-svg', 'aria-hidden': 'true' });
      svg.appendChild(nodo('rect', { x: 0, y: 0, width: ANCHO, height: ALTO, class: 'mapa-fondo' }));
      // Retícula de 1° como referencia de lectura.
      for (var lon = Math.ceil(CAJA.oeste); lon <= CAJA.este; lon++) {
        svg.appendChild(nodo('line', { x1: x(lon), y1: 0, x2: x(lon), y2: ALTO, class: 'mapa-reticula' }));
        svg.appendChild(nodo('text', { x: x(lon) + 3, y: ALTO - 4, class: 'mapa-grado' }, lon + '°'));
      }
      for (var lat = Math.ceil(CAJA.sur); lat <= CAJA.norte; lat++) {
        svg.appendChild(nodo('line', { x1: 0, y1: y(lat), x2: ANCHO, y2: y(lat), class: 'mapa-reticula' }));
        svg.appendChild(nodo('text', { x: 3, y: y(lat) - 3, class: 'mapa-grado' }, lat + '°'));
      }
      var grupos = agrupar(focos);
      grupos.forEach(function (g) {
        var radio = Math.min(22, 7 + Math.sqrt(g.n) * 3);
        var grupo = nodo('g', { class: 'mapa-foco riesgo-mapa-' + (g.riesgo || 'ninguno') });
        grupo.appendChild(nodo('circle', { cx: x(g.longitud), cy: y(g.latitud), r: radio }));
        grupo.appendChild(nodo('title', {}, g.n + ' foco(s), riesgo máximo ' + (g.riesgo || 'sin calcular')));
        svg.appendChild(grupo);
      });
      // Comunidades encima de los focos (con halo blanco) para que sus nombres se lean.
      ((catalogo && catalogo.comunidades) || []).forEach(function (c) {
        if (!dentro(c)) return;
        svg.appendChild(nodo('rect', { x: x(c.longitud) - 3, y: y(c.latitud) - 3, width: 6, height: 6, class: 'mapa-comunidad' }));
        svg.appendChild(nodo('text', { x: x(c.longitud) + 6, y: y(c.latitud) + 4, class: 'mapa-etiqueta' }, c.nombre));
      });
      // Cantidad de focos de cada grupo, por encima de las comunidades.
      grupos.forEach(function (g) {
        if (g.n > 1) svg.appendChild(nodo('text', { x: x(g.longitud), y: y(g.latitud) - 4, class: 'mapa-cuenta' }, String(g.n)));
      });
      // Brigadas en el mismo punto se apilan para que se lean todas.
      var apiladas = {};
      datos.brigadas.forEach(function (b) {
        if (!dentro(b.ubicacion)) return;
        var clave = x(b.ubicacion.longitud) + ':' + y(b.ubicacion.latitud);
        var desplazamiento = (apiladas[clave] = (apiladas[clave] || 0) + 1) - 1;
        var bx = x(b.ubicacion.longitud);
        var by = y(b.ubicacion.latitud) - 12 - desplazamiento * 15;
        var t = nodo('text', { x: bx, y: by, class: 'mapa-brigada brigada-' + b.estadoOperativo }, SIMBOLO_BRIGADA[b.estadoOperativo] + ' ' + b.nombre.replace('Brigada Departamental', 'B'));
        t.appendChild(nodo('title', {}, b.nombre + ': ' + ETIQUETA_BRIGADA[b.estadoOperativo]));
        svg.appendChild(t);
      });
      var mapa = $('mapa-panel');
      mapa.innerHTML = '';
      mapa.appendChild(svg);
    });
  }

  // ---------- brigadas (RF-08) ----------

  function pintarBrigadas(datos) {
    var conteo = $('conteo-brigadas');
    conteo.innerHTML = '';
    ESTADOS_BRIGADA.forEach(function (e) {
      var li = el('li', 'brigada-' + e);
      li.dataset.estado = e;
      li.appendChild(el('b', null, SIMBOLO_BRIGADA[e] + ' ' + (datos.resumen.brigadas[e] || 0)));
      li.appendChild(el('span', null, ' ' + ETIQUETA_BRIGADA[e]));
      conteo.appendChild(li);
    });
    var ul = $('lista-brigadas');
    ul.innerHTML = '';
    datos.brigadas.forEach(function (b) {
      var li = el('li', 'reporte brigada');
      li.dataset.id = b.id;
      li.dataset.estado = b.estadoOperativo;
      var cabecera = el('div', 'cabecera-reporte');
      cabecera.appendChild(el('strong', null, SIMBOLO_BRIGADA[b.estadoOperativo] + ' ' + b.nombre));
      cabecera.appendChild(el('span', 'insignia brigada-' + b.estadoOperativo, ETIQUETA_BRIGADA[b.estadoOperativo]));
      li.appendChild(cabecera);
      var detalle = 'Jefe: ' + (b.jefe ? b.jefe.nombre : 'sin asignar');
      if (b.incidente) detalle += ' · FOCO-' + b.incidente.id.slice(0, 8) + (b.incidente.comunidad ? ' (' + b.incidente.comunidad + ')' : '');
      li.appendChild(el('p', 'nota', detalle));
      if (b.estadoOperativo === 'En_Liquidacion') {
        var liberar = el('button', 'boton liberar', 'Liberar brigada (Disponible)');
        liberar.type = 'button';
        liberar.addEventListener('click', function () {
          if (!confirm('¿Liberar ' + b.nombre + '? Quedará Disponible para un nuevo despacho.')) return;
          liberar.disabled = true;
          BrcApi.post('/brigadas/' + b.id + '/estado', { estado: 'Disponible' }).then(cargar, function (e) {
            liberar.disabled = false;
            texto($('error-panel'), 'No se liberó: ' + e.message);
          });
        });
        li.appendChild(liberar);
      }
      ul.appendChild(li);
    });
  }

  // ---------- ciclo de vida de la pestaña ----------

  function mostrar() {
    ocultar();
    temporizador = setInterval(function () {
      if (!document.hidden) cargar();
    }, REFRESCO_MS);
    return cargar();
  }

  function ocultar() {
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
  }

  function iniciar(opts) {
    opciones = opts || opciones;
    Array.prototype.forEach.call(document.querySelectorAll('#filtros-panel input[type="radio"], #filtros-panel input[type="checkbox"]'), function (i) {
      i.addEventListener('change', alCambiarFiltro);
    });
    $('filtro-comunidad').addEventListener('input', function () {
      clearTimeout(esperaBusqueda);
      esperaBusqueda = setTimeout(alCambiarFiltro, 400);
    });
    $('actualizar-panel').addEventListener('click', cargar);
  }

  global.BrcPanel = { iniciar: iniciar, mostrar: mostrar, ocultar: ocultar, recargar: cargar };
})(self);
