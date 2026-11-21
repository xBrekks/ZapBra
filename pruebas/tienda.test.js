'use strict';
// Tienda pública: catálogo, páginas de producto, mapa del sitio y seguridad de archivos.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./servidor');

describe('Tienda', () => {
  let servidor;
  let pedir;
  let catalogo;

  before(async () => {
    servidor = await iniciarServidor();
    pedir = servidor.cliente();
    catalogo = (await pedir('/api/catalogo')).cuerpo;
  });
  after(() => servidor.cerrar());

  test('el catálogo trae categorías, productos y los datos de la tienda', () => {
    assert.ok(catalogo.categorias.length > 0);
    assert.ok(catalogo.productos.length > 0);
    assert.equal(catalogo.tienda.whatsapp, '527771091249');
    assert.equal(catalogo.tienda.envioGratisDesde, 999);
  });

  test('la página de un producto trae título, vista previa para compartir y datos para Google', async () => {
    const p = catalogo.productos.find((x) => x.precioOferta);
    const r = await pedir(`/producto/${p.id}`);
    assert.equal(r.estado, 200);
    const html = r.cuerpo;
    assert.ok(html.includes(`<title>${p.nombre} | Zapatería Brazil</title>`));
    assert.ok(html.includes(`og:title" content="${p.nombre} | Zapatería Brazil"`));
    assert.match(html, /og:image" content="http:\/\/localhost:\d+\/[^"]+"/);
    assert.match(html, /<meta name="description" content="\$[\d,]+\.\d\d · /, 'el precio con $ no debe romper la descripción');
    assert.ok(html.includes('"@type":"Product"') && html.includes('"priceCurrency":"MXN"'));
    assert.ok(html.includes(`/producto/${p.id}"`) && html.includes('rel="canonical"'));
    assert.ok(html.includes('<body data-vista="producto">'));
    assert.ok(html.includes('href="/css/styles.css"') && html.includes('src="/js/app.js"'), 'rutas absolutas para que funcionen en /producto/');
  });

  test('un producto que no existe responde 404 y no se indexa', async () => {
    const r = await pedir('/producto/no-existe');
    assert.equal(r.estado, 404);
    assert.ok(r.cuerpo.includes('noindex'));
  });

  test('el inicio trae los datos del negocio para Google', async () => {
    const r = await pedir('/');
    assert.equal(r.estado, 200);
    assert.ok(r.cuerpo.includes('"@type":"ShoeStore"') && r.cuerpo.includes('"postalCode":"62580"'));
    assert.ok(r.cuerpo.includes('<body data-vista="catalogo">'));
  });

  test('una cabecera Host maliciosa no se copia al HTML', async () => {
    const r = await pedir('/', { cabeceras: { Host: 'malo"><script>alert(1)</script>' } });
    assert.ok(!r.cuerpo.includes('malo"'));
  });

  test('mapa del sitio con todos los productos y robots.txt que oculta el panel', async () => {
    const mapa = await pedir('/sitemap.xml');
    assert.equal((mapa.cuerpo.match(/<loc>/g) || []).length, catalogo.productos.length + 1);
    const robots = await pedir('/robots.txt');
    assert.match(robots.cuerpo, /Disallow: \/admin/);
    assert.match(robots.cuerpo, /Sitemap: http/);
  });

  test('archivos y páginas con encabezados de seguridad', async () => {
    for (const ruta of ['/css/styles.css', '/admin', '/aviso-de-privacidad', '/cambios-y-devoluciones', '/img/compartir.png']) {
      const r = await pedir(ruta);
      assert.equal(r.estado, 200, ruta);
      assert.equal(r.cabeceras.get('x-content-type-options'), 'nosniff', ruta);
      assert.equal(r.cabeceras.get('x-frame-options'), 'DENY', ruta);
    }
  });

  test('no se pueden leer archivos fuera de las carpetas públicas', async () => {
    for (const ruta of ['/../server.js', '/%2e%2e/server.js', '/img/productos/..%2f..%2fadmin.json', '/img/productos/%2e%2e%2fcatalogo.json']) {
      const r = await pedir(ruta);
      assert.ok([403, 404].includes(r.estado), `${ruta} respondió ${r.estado}`);
    }
  });

  test('sin TRUST_PROXY no se confía en la cabecera X-Forwarded-Proto', async () => {
    const r = await pedir('/api/configurar', { metodo: 'POST', datos: { password: 'otra-clave-123' }, cabeceras: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(r.estado, 200);
    assert.doesNotMatch(r.cabeceras.get('set-cookie'), /Secure/);
  });
});
