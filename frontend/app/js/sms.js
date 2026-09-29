/*
 * Codificador del reporte por SMS (HU-1.3, RNF-02). Debe producir exactamente el mismo texto que
 * backend/src/core/sync/sms/codec-sms.ts; una prueba del backend verifica la paridad.
 *
 *   GPS:       BRC1 G <id> <lat> <lon> <precisión m> <hora>
 *   Distancia: BRC1 D <id> <comunidad> <rumbo N|S|E|O> <km> <hora>
 *   Bitácora:  BRC1 B <foco> <id> <agua S|C> <combustible O|R> <herramientas 1|0> <km faja> <% control> <hora>
 */
(function (global) {
  'use strict';

  var PREFIJO = 'BRC1';
  var LARGO_MAXIMO = 160;
  var B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /** UUID → 22 caracteres base64url (16 bytes). */
  function uuidACorto(uuid) {
    var hex = uuid.replace(/-/g, '');
    var bytes = [];
    for (var i = 0; i < 32; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    var salida = '';
    for (var j = 0; j < bytes.length; j += 3) {
      var b0 = bytes[j];
      var b1 = j + 1 < bytes.length ? bytes[j + 1] : 0;
      var b2 = j + 2 < bytes.length ? bytes[j + 2] : 0;
      var n = (b0 << 16) | (b1 << 8) | b2;
      salida += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
      if (j + 1 < bytes.length) salida += B64URL[(n >> 6) & 63];
      if (j + 2 < bytes.length) salida += B64URL[n & 63];
    }
    return salida;
  }

  /** Igual que String(Number(x.toFixed(d))) en el backend: sin ceros sobrantes. */
  function numero(valor, decimales) {
    return String(Number(valor.toFixed(decimales)));
  }

  /**
   * r: { tipo: 'G', id, latitud, longitud, precisionMetros, fecha }
   *  | { tipo: 'D', id, comunidadId, rumbo, distanciaKm, fecha }
   *  | { tipo: 'B', incidenteId, id, aguaSuficiente, combustibleOk, herramientasOperativas, kmFajaMitigados,
   *      porcentajeControl, fecha }   (Bolt 5: bitácora de turno)
   */
  function codificarReporte(r) {
    var hora = Math.floor(r.fecha.getTime() / 1000).toString(36);
    var partes;
    if (r.tipo === 'G') {
      partes = [PREFIJO, 'G', uuidACorto(r.id), numero(r.latitud, 5), numero(r.longitud, 5), String(Math.round(r.precisionMetros)), hora];
    } else if (r.tipo === 'D') {
      partes = [PREFIJO, 'D', uuidACorto(r.id), uuidACorto(r.comunidadId), r.rumbo, numero(r.distanciaKm, 1), hora];
    } else {
      partes = [
        PREFIJO,
        'B',
        uuidACorto(r.incidenteId),
        uuidACorto(r.id),
        r.aguaSuficiente ? 'S' : 'C',
        r.combustibleOk ? 'O' : 'R',
        r.herramientasOperativas ? '1' : '0',
        numero(r.kmFajaMitigados, 1),
        String(Math.round(r.porcentajeControl)),
        hora,
      ];
    }
    var texto = partes.join(' ');
    if (texto.length > LARGO_MAXIMO) throw new Error('El SMS supera los 160 caracteres');
    return texto;
  }

  var api = { PREFIJO: PREFIJO, LARGO_MAXIMO: LARGO_MAXIMO, uuidACorto: uuidACorto, codificarReporte: codificarReporte };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BrcSms = api;
})(typeof self !== 'undefined' ? self : this);
