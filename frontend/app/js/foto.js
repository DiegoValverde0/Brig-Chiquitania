/*
 * Compresión de la fotografía en el propio teléfono (RF-03: ≤100 KB) antes de guardarla o enviarla. También
 * comprime la foto de una carta municipal (Bolt 3: ≤1 MB, con más resolución para que se pueda leer).
 * Reduce primero la calidad JPEG y luego el tamaño, liberando el canvas al terminar (RS-01: poca RAM).
 */
(function (global) {
  'use strict';

  var PESO_MAXIMO = 100 * 1024;
  var LADO_INICIAL = 1024;

  function cargarImagen(archivo) {
    return new Promise(function (resolver, rechazar) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolver(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rechazar(new Error('No se pudo leer la imagen'));
      };
      img.src = url;
    });
  }

  function aJpeg(canvas, calidad) {
    return new Promise(function (resolver) {
      canvas.toBlob(resolver, 'image/jpeg', calidad);
    });
  }

  /** Devuelve un Blob JPEG ≤100 KB (o ≤opciones.pesoMaximo, partiendo de opciones.lado px). */
  function comprimir(archivo, opciones) {
    opciones = opciones || {};
    var pesoMaximo = opciones.pesoMaximo || PESO_MAXIMO;
    return cargarImagen(archivo).then(function (img) {
      var canvas = document.createElement('canvas');
      var lado = opciones.lado || LADO_INICIAL;
      var calidad = 0.7;

      function intentar() {
        var escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return aJpeg(canvas, calidad).then(function (blob) {
          if (blob && blob.size <= pesoMaximo) return blob;
          if (calidad > 0.35) calidad -= 0.15;
          else lado = Math.round(lado * 0.75);
          if (lado < 160) throw new Error('No se pudo comprimir la foto a ' + Math.round(pesoMaximo / 1024) + ' KB');
          return intentar();
        });
      }

      return intentar().then(
        function (blob) {
          canvas.width = canvas.height = 0; // libera la memoria del canvas
          return blob;
        },
        function (error) {
          canvas.width = canvas.height = 0;
          throw error;
        },
      );
    });
  }

  global.BrcFoto = { comprimir: comprimir, PESO_MAXIMO: PESO_MAXIMO };
})(self);
