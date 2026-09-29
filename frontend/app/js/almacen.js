/*
 * Persistencia local offline-first (RNF-01): cola de reportes (con su foto como Blob) y catálogo comunal en
 * IndexedDB. Cada escritura es una transacción atómica: si el teléfono se apaga, el reporte está entero o no está.
 */
(function (global) {
  'use strict';

  var NOMBRE = 'brig-chiquitania';
  var VERSION = 1;
  var conexion = null;

  function abrir() {
    if (conexion) return conexion;
    conexion = new Promise(function (resolver, rechazar) {
      var peticion = indexedDB.open(NOMBRE, VERSION);
      peticion.onupgradeneeded = function () {
        var db = peticion.result;
        if (!db.objectStoreNames.contains('reportes')) {
          db.createObjectStore('reportes', { keyPath: 'id' }).createIndex('creadoEn', 'creadoEn');
        }
        if (!db.objectStoreNames.contains('datos')) db.createObjectStore('datos');
      };
      peticion.onsuccess = function () {
        resolver(peticion.result);
      };
      peticion.onerror = function () {
        rechazar(peticion.error);
      };
    });
    return conexion;
  }

  function operar(almacen, modo, accion) {
    return abrir().then(function (db) {
      return new Promise(function (resolver, rechazar) {
        var tx = db.transaction(almacen, modo);
        var resultado;
        var peticion = accion(tx.objectStore(almacen));
        if (peticion) {
          peticion.onsuccess = function () {
            resultado = peticion.result;
          };
        }
        tx.oncomplete = function () {
          resolver(resultado);
        };
        tx.onerror = tx.onabort = function () {
          rechazar(tx.error);
        };
      });
    });
  }

  var Almacen = {
    guardarReporte: function (reporte) {
      return operar('reportes', 'readwrite', function (s) {
        return s.put(reporte);
      });
    },
    reporte: function (id) {
      return operar('reportes', 'readonly', function (s) {
        return s.get(id);
      });
    },
    reportes: function () {
      return operar('reportes', 'readonly', function (s) {
        return s.index('creadoEn').getAll();
      }).then(function (lista) {
        return (lista || []).reverse();
      });
    },
    /** Actualiza campos de un reporte guardado (lectura y escritura en la misma transacción). */
    actualizarReporte: function (id, cambios) {
      return abrir().then(function (db) {
        return new Promise(function (resolver, rechazar) {
          var tx = db.transaction('reportes', 'readwrite');
          var s = tx.objectStore('reportes');
          var actualizado = null;
          s.get(id).onsuccess = function (e) {
            var r = e.target.result;
            if (!r) return;
            for (var k in cambios) r[k] = cambios[k];
            actualizado = r;
            s.put(r);
          };
          tx.oncomplete = function () {
            resolver(actualizado);
          };
          tx.onerror = tx.onabort = function () {
            rechazar(tx.error);
          };
        });
      });
    },
    leer: function (clave) {
      return operar('datos', 'readonly', function (s) {
        return s.get(clave);
      });
    },
    escribir: function (clave, valor) {
      return operar('datos', 'readwrite', function (s) {
        return s.put(valor, clave);
      });
    },
  };

  /** Ajustes pequeños y síncronos (sesión y preferencias) en localStorage. */
  var Ajustes = {
    obtener: function (clave, defecto) {
      try {
        var v = localStorage.getItem('brc.' + clave);
        return v === null ? defecto : JSON.parse(v);
      } catch (e) {
        return defecto;
      }
    },
    fijar: function (clave, valor) {
      try {
        if (valor === null || valor === undefined) localStorage.removeItem('brc.' + clave);
        else localStorage.setItem('brc.' + clave, JSON.stringify(valor));
      } catch (e) {
        /* almacenamiento lleno o bloqueado: la app sigue funcionando en memoria */
      }
    },
  };

  global.BrcAlmacen = Almacen;
  global.BrcAjustes = Ajustes;
})(self);
