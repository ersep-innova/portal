/* =============================================================================
   ERSeP · Actas por empresa — cifrado
   -----------------------------------------------------------------------------
   Cada empresa tiene sus actas cifradas con una clave derivada de SU contraseña.
   El portal sólo publica el texto cifrado: las contraseñas no están en el código
   ni en ningún archivo del sitio. Sin la contraseña correcta el contenido no se
   puede leer, ni siquiera abriendo el código fuente.

     · Derivación de clave: PBKDF2-SHA-256, 310.000 iteraciones, sal aleatoria.
     · Cifrado: AES-GCM de 256 bits, vector de inicialización aleatorio.
   Todo corre en el navegador con la Web Crypto API; nada se envía a un servidor.
   ============================================================================= */
window.ActasCripto = (function () {
  'use strict';

  var ITERACIONES = 310000;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function aB64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function deB64(t) {
    var s = atob(t), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  function derivar(clave, sal, iteraciones) {
    return crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: sal, iterations: iteraciones || ITERACIONES, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function cifrar(objeto, clave) {
    var sal = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return derivar(clave, sal).then(function (k) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify(objeto)));
    }).then(function (c) {
      return { v: 1, it: ITERACIONES, sal: aB64(sal), iv: aB64(iv), datos: aB64(c) };
    });
  }

  /* Si la contraseña es incorrecta, AES-GCM rechaza el descifrado: no hay forma
     de "casi acertar" ni de leer nada parcial. */
  function descifrar(paquete, clave) {
    return derivar(clave, deB64(paquete.sal), paquete.it).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(paquete.iv) }, k, deB64(paquete.datos));
    }).then(function (p) {
      return JSON.parse(dec.decode(p));
    });
  }

  /* Contraseñas legibles para mandar por mail: 4 bloques sin caracteres ambiguos
     (sin 0/O, 1/l/I). Son ~80 bits de azar: inviables de adivinar por fuerza bruta. */
  var ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function contrasena() {
    var r = crypto.getRandomValues(new Uint32Array(16)), s = '';
    for (var i = 0; i < 16; i++) {
      s += ALFABETO[r[i] % ALFABETO.length];
      if (i % 4 === 3 && i < 15) s += '-';
    }
    return s;
  }

  function usuario(nombre) {
    return String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
  }

  return { cifrar: cifrar, descifrar: descifrar, contrasena: contrasena, usuario: usuario, ITERACIONES: ITERACIONES };
})();
