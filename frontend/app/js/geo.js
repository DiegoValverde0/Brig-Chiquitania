/* Cálculos geográficos locales (sin mapas ni red): los mismos que hace el backend (common/geo.ts). */
(function (global) {
  'use strict';

  var RADIO_KM = 6371;
  var GRADOS_RUMBO = { N: 0, E: 90, S: 180, O: 270 };

  function rad(g) {
    return (g * Math.PI) / 180;
  }

  /** Distancia haversine en km. */
  function distanciaKm(a, b) {
    var dLat = rad(b.latitud - a.latitud);
    var dLon = rad(b.longitud - a.longitud);
    var h =
      Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * RADIO_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Punto a `km` de `origen` hacia el rumbo cardinal (HU-1.2). */
  function puntoDestino(origen, rumbo, km) {
    var d = km / RADIO_KM;
    var r = rad(GRADOS_RUMBO[rumbo]);
    var lat1 = rad(origen.latitud);
    var lon1 = rad(origen.longitud);
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(r));
    var lon2 = lon1 + Math.atan2(Math.sin(r) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    var deg = function (x) {
      return (x * 180) / Math.PI;
    };
    return {
      latitud: Math.round(deg(lat2) * 1e6) / 1e6,
      longitud: Math.round((((deg(lon2) + 540) % 360) - 180) * 1e6) / 1e6,
    };
  }

  /** Comunidad del catálogo más cercana al punto, con su distancia. */
  function comunidadMasCercana(punto, comunidades) {
    var mejor = null;
    var minima = Infinity;
    for (var i = 0; i < comunidades.length; i++) {
      var d = distanciaKm(punto, comunidades[i]);
      if (d < minima) {
        minima = d;
        mejor = comunidades[i];
      }
    }
    return mejor ? { comunidad: mejor, distanciaKm: Math.round(minima * 100) / 100 } : null;
  }

  global.BrcGeo = { distanciaKm: distanciaKm, puntoDestino: puntoDestino, comunidadMasCercana: comunidadMasCercana };
})(self);
