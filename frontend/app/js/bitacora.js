/*
 * Bitácora de turno del Jefe de Brigada (Bolt 5, HU-5.2, RF-12; Acta ACTA-002, acuerdo 3: reemplaza el WhatsApp).
 * - Checklist de pocos toques (agua, combustible, herramientas, km de faja, % de control), nunca texto libre.
 * - Se precarga con la bitácora anterior: solo se toca lo que cambió.
 * - Offline-first (RNF-01): se guarda primero en IndexedDB con la hora del teléfono y la cola la envía sola al
 *   volver la señal (<1 KB, RS-02). Sin datos, se muestra el SMS `BRC1 B` (≤160 caracteres) para enviarlo.
 */
(function (global) {
  'use strict';

  var ESTADOS_CON_BITACORA = ['En_Atencion', 'En_Liquidacion'];
  var KM_MAXIMO = 500;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var foco = null; // incidente de la orden vigente
  var valores = null; // checklist en pantalla

  function el(etiqueta, clase, contenido) {
    var e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    if (contenido !== undefined) e.textContent = contenido;
    return e;
  }

  function hora(iso) {
    var d = new Date(iso);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + d.toLocaleDateString();
  }

  function marcar(nombre, valor) {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="' + nombre + '"]'), function (r) {
      r.checked = r.value === valor;
    });
  }

  function pintarValores() {
    marcar('agua', valores.nivelAgua);
    marcar('combustible', valores.nivelCombustible);
    marcar('herramientas', valores.herramientasOperativas ? 'si' : 'no');
    $('valor-km').textContent = String(valores.kmFajaMitigados).replace('.', ',') + ' km';
    $('valor-control').textContent = valores.porcentajeControl + ' %';
    $('rango-control').value = valores.porcentajeControl;
  }

  /** Precarga: la última bitácora del foco guardada en el teléfono, o valores iniciales. */
  function precargar(lista) {
    var ultima = null;
    lista.forEach(function (b) {
      if (!ultima && b.incidenteId === foco.id) ultima = b;
    });
    valores = ultima
      ? {
          nivelAgua: ultima.cuerpo.nivelAgua,
          nivelCombustible: ultima.cuerpo.nivelCombustible,
          herramientasOperativas: ultima.cuerpo.herramientasOperativas,
          kmFajaMitigados: ultima.cuerpo.kmFajaMitigados,
          porcentajeControl: ultima.cuerpo.porcentajeControl,
        }
      : { nivelAgua: 'Suficiente', nivelCombustible: 'OK', herramientasOperativas: true, kmFajaMitigados: 0, porcentajeControl: 0 };
    pintarValores();
  }

  // ---------- lista del turno ----------

  var ETIQUETA = { pendiente: 'En cola', enviada: 'Enviada', error: 'Rechazada' };

  function resumen(c) {
    return (
      'Agua ' + (c.nivelAgua === 'Critica' ? 'CRÍTICA' : 'suficiente') +
      ' · Comb. ' + (c.nivelCombustible === 'Reserva' ? 'RESERVA' : 'OK') +
      ' · Herr. ' + (c.herramientasOperativas ? 'operativas' : 'CON FALLAS') +
      ' · ' + String(c.kmFajaMitigados).replace('.', ',') + ' km · ' + c.porcentajeControl + ' % de control'
    );
  }

  function pintarLista() {
    return BrcAlmacen.bitacoras().then(function (lista) {
      var propias = lista.filter(function (b) {
        return foco && b.incidenteId === foco.id;
      });
      var ul = $('lista-bitacoras');
      ul.innerHTML = '';
      if (!propias.length) ul.appendChild(el('li', 'nota', 'Todavía no hay bitácoras de este foco en el teléfono.'));
      var numero = BrcAjustes.obtener('numeroCentral', null);
      propias.forEach(function (b) {
        var li = el('li', 'reporte bitacora-item');
        li.dataset.id = b.id;
        li.dataset.estado = b.estado;
        var cabecera = el('div', 'cabecera-reporte');
        cabecera.appendChild(el('strong', null, 'Bitácora ' + hora(b.cuerpo.fecha)));
        var etiqueta = ETIQUETA[b.estado] + (b.estado === 'enviada' && b.canal === 'SMS' ? ' por SMS' : '');
        cabecera.appendChild(el('span', 'insignia estado estado-' + (b.estado === 'enviada' ? 'enviado' : b.estado), etiqueta));
        li.appendChild(cabecera);
        li.appendChild(el('p', 'nota', resumen(b.cuerpo) + (b.error ? ' · ' + b.error : '')));
        if (b.estado === 'pendiente' && !BrcSync.hayDatos()) {
          var sms = el('div', 'sms');
          sms.appendChild(el('p', 'nota', 'Sin datos: envíe este SMS a la central (≤160 caracteres).'));
          sms.appendChild(el('code', 'texto-sms', b.smsTexto + '  (' + b.smsTexto.length + ' car.)'));
          var acciones = el('div', 'acciones');
          var abrir = el('a', 'boton abrir-sms', '✉ Abrir SMS');
          if (numero) abrir.href = 'sms:' + numero + '?body=' + encodeURIComponent(b.smsTexto);
          else abrir.hidden = true;
          var simular = el('button', 'boton simular-sms', 'Simular envío SMS');
          simular.type = 'button';
          simular.addEventListener('click', function () {
            simularSms(b, simular);
          });
          acciones.appendChild(abrir);
          acciones.appendChild(simular);
          sms.appendChild(acciones);
          li.appendChild(sms);
        }
        ul.appendChild(li);
      });
      return lista;
    });
  }

  /** Pasarela SMS simulada (mientras no haya proveedor): entrega el SMS a la misma entrada que el proveedor. */
  function simularSms(b, boton) {
    boton.disabled = true;
    BrcApi.post('/sms/simulador', { texto: b.smsTexto }).then(
      function (res) {
        var r = res.datos;
        var cambios = r.estado === 'Procesado'
          ? { estado: 'enviada', canal: 'SMS', respuesta: r.bitacora, error: null }
          : { estado: 'error', error: 'SMS rechazado: ' + r.motivo };
        return BrcAlmacen.actualizarBitacora(b.id, cambios).then(pintarLista);
      },
      function (e) {
        boton.disabled = false;
        $('mensaje-bitacora').textContent = 'El simulador SMS no respondió (' + e.message + '). Use "Abrir SMS".';
      },
    );
  }

  // ---------- guardar (primero en el teléfono) ----------

  function guardar(evento) {
    evento.preventDefault();
    if (!foco) return;
    var id = global.BrcUuid();
    var fecha = new Date();
    var cuerpo = {
      id: id,
      fecha: fecha.toISOString(),
      nivelAgua: valores.nivelAgua,
      nivelCombustible: valores.nivelCombustible,
      herramientasOperativas: valores.herramientasOperativas,
      kmFajaMitigados: valores.kmFajaMitigados,
      porcentajeControl: valores.porcentajeControl,
    };
    var registro = {
      id: id,
      incidenteId: foco.id,
      cuerpo: cuerpo,
      smsTexto: BrcSms.codificarReporte({
        tipo: 'B',
        incidenteId: foco.id,
        id: id,
        aguaSuficiente: cuerpo.nivelAgua === 'Suficiente',
        combustibleOk: cuerpo.nivelCombustible === 'OK',
        herramientasOperativas: cuerpo.herramientasOperativas,
        kmFajaMitigados: cuerpo.kmFajaMitigados,
        porcentajeControl: cuerpo.porcentajeControl,
        fecha: fecha,
      }),
      estado: 'pendiente',
      canal: null,
      error: null,
      creadoEn: fecha.toISOString(),
    };
    $('guardar-bitacora').disabled = true;
    BrcAlmacen.guardarBitacora(registro)
      .then(function () {
        $('mensaje-bitacora').textContent = BrcSync.hayDatos()
          ? '✔ Guardada en el teléfono. Enviando…'
          : '✔ Guardada en el teléfono. Sin señal: se enviará sola al volver la señal (o por SMS).';
        return pintarLista();
      })
      .then(function () {
        return BrcSync.sincronizar();
      })
      .then(
        function () {
          $('guardar-bitacora').disabled = false;
          return pintarLista();
        },
        function (e) {
          $('guardar-bitacora').disabled = false;
          $('mensaje-bitacora').textContent = 'No se pudo guardar: ' + e.message;
        },
      );
  }

  function paso(e) {
    var b = e.currentTarget;
    var delta = parseFloat(b.dataset.paso);
    if (b.dataset.campo === 'km') {
      valores.kmFajaMitigados = Math.min(KM_MAXIMO, Math.max(0, Math.round((valores.kmFajaMitigados + delta) * 10) / 10));
    } else {
      valores.porcentajeControl = Math.min(100, Math.max(0, valores.porcentajeControl + delta));
    }
    pintarValores();
  }

  /** Lo llama "Mi brigada" con la orden vigente: el checklist aparece entre la llegada y el cierre. */
  function pintar(orden) {
    var visible = !!orden && orden.llegadaConfirmada && ESTADOS_CON_BITACORA.indexOf(orden.incidente.estado) >= 0;
    $('bitacora-turno').hidden = !visible;
    if (!visible) {
      foco = null;
      return Promise.resolve();
    }
    var cambio = !foco || foco.id !== orden.incidente.id;
    foco = orden.incidente;
    return pintarLista().then(function (lista) {
      if (cambio || !valores) precargar(lista);
    });
  }

  function iniciar() {
    $('form-bitacora').addEventListener('submit', guardar);
    Array.prototype.forEach.call(document.querySelectorAll('#form-bitacora .paso'), function (b) {
      b.addEventListener('click', paso);
    });
    $('rango-control').addEventListener('input', function (e) {
      valores.porcentajeControl = parseInt(e.target.value, 10);
      pintarValores();
    });
    [['agua', 'nivelAgua'], ['combustible', 'nivelCombustible']].forEach(function (par) {
      Array.prototype.forEach.call(document.querySelectorAll('input[name="' + par[0] + '"]'), function (r) {
        r.addEventListener('change', function () {
          valores[par[1]] = r.value;
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="herramientas"]'), function (r) {
      r.addEventListener('change', function () {
        valores.herramientasOperativas = r.value === 'si';
      });
    });
    BrcSync.alCambiar(function () {
      if (foco) pintarLista();
    });
  }

  global.BrcBitacora = { iniciar: iniciar, pintar: pintar };
})(self);
