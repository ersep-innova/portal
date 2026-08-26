/* =============================================================================
   ERSeP · Descarga del padrón de electricistas (sistema Volta)
   -----------------------------------------------------------------------------
   Cómo usarlo:
     1. Abrir  https://volta.net.ar/registro  en el navegador.
     2. Abrir la consola (F12 → Consola).
     3. Pegar todo este archivo y presionar Enter.
     4. Al terminar descarga dos CSV listos para el portal:
          electricistas-general.csv   y   electricistas-gd.csv

   Mejoras respecto de la primera versión:
     · Recorre los dos registros (general y generación distribuida) en una corrida.
     · Usa la cantidad de páginas que informa el propio servidor en vez de estimarla.
     · Descarga varias localidades en paralelo (CONCURRENCIA), con reintentos.
     · Separa el campo Contacto en Teléfono 1, Teléfono 2 y Email.
     · Limpia los rellenos de guiones y espacios que trae el origen.
     · Deduplica por CUIL + matrícula + localidad y avisa inconsistencias
       (CUIL con dígito verificador inválido, matrículas repetidas).
   ============================================================================= */
(async () => {
  'use strict';

  var CONCURRENCIA = 4;      // localidades en paralelo (subir con cuidado)
  var PAUSA_MS = 120;        // pausa entre páginas de una misma localidad
  var REINTENTOS = 2;
  var MAX_PAGINAS = 1000;

  var dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function limpiar(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /* Los campos vacíos del origen vienen como "-----" o "s/d" */
  function limpiarDato(s) {
    var t = limpiar(s);
    if (/^[-_.\s]*$/.test(t)) return '';
    if (/^(s\/?d|no tiene|sin datos?)$/i.test(t)) return '';
    return t;
  }

  function csvEscape(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

  function cuilValido(s) {
    var d = String(s || '').replace(/\D/g, '');
    if (d.length !== 11) return false;
    var m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], t = 0;
    for (var i = 0; i < 10; i++) t += Number(d[i]) * m[i];
    var v = 11 - (t % 11);
    v = v === 11 ? 0 : (v === 10 ? 9 : v);
    return v === Number(d[10]);
  }

  function buscarTabla(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('table')).find(function (t) {
      var txt = limpiar(t.innerText || t.textContent).toLowerCase();
      return txt.indexOf('cuil') !== -1 && txt.indexOf('nombre') !== -1 &&
             txt.indexOf('categor') !== -1 && txt.indexOf('registro') !== -1;
    });
  }

  function extraerFilas(doc) {
    var tabla = buscarTabla(doc);
    if (!tabla) return [];
    var filas = [];
    Array.prototype.forEach.call(tabla.querySelectorAll('tr'), function (tr) {
      var c = Array.prototype.slice.call(tr.querySelectorAll('td'));
      if (c.length < 7) return;

      /* Contacto: el origen lo entrega como "| tel1 | tel2 | email |" */
      var trozos = c.slice(7).map(function (x) { return x.innerText || x.textContent; })
        .join('|').split('|').map(limpiarDato).filter(Boolean);
      var email = trozos.filter(function (t) { return t.indexOf('@') !== -1; })[0] || '';
      var tels = trozos.filter(function (t) { return t.indexOf('@') === -1 && /\d{5,}/.test(t.replace(/\D/g, '')); });

      filas.push({
        cuil: limpiarDato(c[1].innerText),
        nombre: limpiarDato(c[2].innerText),
        categoria: limpiarDato(c[3].innerText),
        registro: limpiarDato(c[4].innerText),
        localidad: limpiarDato(c[5].innerText),
        barrio: limpiarDato(c[6].innerText),
        tel1: tels[0] || '',
        tel2: tels[1] || '',
        email: email
      });
    });
    return filas;
  }

  /* El propio servidor informa "N registros en M páginas": se usa M, no una estimación */
  function paginasInformadas(doc) {
    var t = limpiar((doc.body && doc.body.innerText) || '');
    var m = t.match(/([\d.]+)\s+registros?\s+en\s+([\d.]+)\s+p[aá]ginas?/i);
    if (!m) return null;
    return {
      registros: Number(m[1].replace(/\./g, '')),
      paginas: Math.min(Number(m[2].replace(/\./g, '')) || 1, MAX_PAGINAS)
    };
  }

  async function pedir(gd, localidad, page) {
    var u = new URL('/registro', location.origin);
    u.searchParams.set('gd', gd ? '1' : '');
    u.searchParams.set('categoria', '');
    u.searchParams.set('nombre', '');
    u.searchParams.set('cuil', '');
    u.searchParams.set('registro', '');
    u.searchParams.set('localidad', localidad);
    if (page > 1) u.searchParams.set('page', String(page));

    for (var intento = 0; intento <= REINTENTOS; intento++) {
      try {
        var res = await fetch(u.toString(), { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return new DOMParser().parseFromString(await res.text(), 'text/html');
      } catch (e) {
        if (intento === REINTENTOS) throw e;
        await dormir(500 * (intento + 1));
      }
    }
  }

  async function localidades(gd) {
    var doc = await pedir(gd, '', 1);
    var sel = doc.querySelector('select[name="localidad"]');
    if (!sel) throw new Error('No se encontró el selector de localidades. ¿Estás en https://volta.net.ar/registro ?');
    return Array.prototype.slice.call(sel.options)
      .map(function (o) { return (o.value || o.textContent || '').trim(); })
      .filter(function (v) { return v && !/seleccione/i.test(v); });
  }

  async function recorrerLocalidad(gd, localidad, avisos) {
    var doc1;
    try { doc1 = await pedir(gd, localidad, 1); }
    catch (e) { avisos.push(localidad + ': no respondió'); return []; }

    var filas = extraerFilas(doc1);
    if (!filas.length) return [];

    var info = paginasInformadas(doc1);
    var paginas = info ? info.paginas : 1;
    var acumulado = filas.slice();
    var firma = filas[0].cuil + '|' + filas[0].registro;

    for (var p = 2; p <= paginas; p++) {
      await dormir(PAUSA_MS);
      var doc;
      try { doc = await pedir(gd, localidad, p); }
      catch (e) { avisos.push(localidad + ': error en página ' + p); break; }

      var f = extraerFilas(doc);
      if (!f.length) { avisos.push(localidad + ': página ' + p + ' vacía de ' + paginas); break; }

      var nueva = f[0].cuil + '|' + f[0].registro;
      if (nueva === firma) { avisos.push(localidad + ': el servidor repitió la página ' + p); break; }
      firma = nueva;
      acumulado = acumulado.concat(f);
    }

    if (info && acumulado.length < info.registros) {
      avisos.push(localidad + ': se obtuvieron ' + acumulado.length + ' de ' + info.registros + ' informados');
    }
    return acumulado;
  }

  /* Cola con concurrencia limitada */
  async function enParalelo(items, n, tarea) {
    var i = 0, salida = [];
    var trabajadores = new Array(Math.min(n, items.length)).fill(0).map(async function () {
      while (i < items.length) {
        var idx = i++;
        salida[idx] = await tarea(items[idx], idx);
      }
    });
    await Promise.all(trabajadores);
    return salida;
  }

  async function descargarRegistro(gd, nombreArchivo) {
    var etiqueta = gd ? 'GENERACIÓN DISTRIBUIDA' : 'REGISTRO GENERAL';
    console.log('%c▶ ' + etiqueta, 'font-weight:bold');

    var locs = await localidades(gd);
    console.log('Localidades a recorrer: ' + locs.length);

    var avisos = [];
    var hechas = 0;

    var partes = await enParalelo(locs, CONCURRENCIA, async function (loc) {
      var r = await recorrerLocalidad(gd, loc, avisos);
      hechas++;
      if (hechas % 20 === 0 || hechas === locs.length) {
        console.log('  ' + hechas + '/' + locs.length + ' localidades');
      }
      return r;
    });

    /* Deduplicación */
    var vistos = Object.create(null);
    var datos = [];
    partes.forEach(function (arr) {
      (arr || []).forEach(function (r) {
        var k = (r.cuil + '¦' + r.registro + '¦' + r.localidad).toUpperCase();
        if (!vistos[k]) { vistos[k] = 1; datos.push(r); }
      });
    });

    datos.sort(function (a, b) {
      return a.localidad.localeCompare(b.localidad, 'es') || a.nombre.localeCompare(b.nombre, 'es');
    });

    /* Control de calidad */
    var cuilMal = datos.filter(function (r) { return !cuilValido(r.cuil); });
    var porRegistro = {};
    datos.forEach(function (r) { if (r.registro) porRegistro[r.registro] = (porRegistro[r.registro] || 0) + 1; });
    var repetidas = Object.keys(porRegistro).filter(function (k) { return porRegistro[k] > 1; });

    var cab = ['CUIL', 'Nombre', 'Categoría', 'Registro', 'Localidad', 'Barrio', 'Telefono1', 'Telefono2', 'Email'];
    var lineas = [cab.map(csvEscape).join(';')].concat(datos.map(function (r) {
      return [r.cuil, r.nombre, r.categoria, r.registro, r.localidad, r.barrio, r.tel1, r.tel2, r.email]
        .map(csvEscape).join(';');
    }));

    var blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo;
    document.body.appendChild(a); a.click(); a.remove();

    console.log('✅ ' + etiqueta + ': ' + datos.length + ' registros → ' + nombreArchivo);
    console.log('   CUIL con dígito verificador inválido: ' + cuilMal.length +
                ' · matrículas repetidas: ' + repetidas.length);
    if (avisos.length) { console.warn('   Advertencias:'); console.table(avisos.map(function (x) { return { aviso: x }; })); }

    return datos.length;
  }

  console.log('%cDescarga del padrón de electricistas · ERSeP', 'font-size:14px;font-weight:bold');
  var t0 = Date.now();

  await descargarRegistro(false, 'electricistas-general.csv');
  await descargarRegistro(true, 'electricistas-gd.csv');

  console.log('⏱ Tiempo total: ' + Math.round((Date.now() - t0) / 1000) + ' s');
  console.log('Subí los dos archivos al repositorio en modulos/electricistas/datos/');
})();
