'use strict';
// Panel de administración: acceso, productos (con costo), categorías y fotos.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { iniciarServidor, entrarAlPanel, esperarHasta, PASSWORD } = require('./servidor');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const productoBase = (cambios = {}) => ({
  nombre: 'Tenis de Prueba',
  marca: 'Marca',
  categoria: 'hombre',
  sub: 'Deportivo',
  tipo: 'tenis',
  precio: 1000,
  precioOferta: null,
  material: 'Malla',
  descripcion: 'Descripción',
  tallas: ['26', '27'],
  etiquetaVariante: 'Color',
  variantes: [{ nombre: 'Negro', hex: '#111111', stock: { 26: 2, 27: 3 } }],
  relacionados: [],
  ...cambios,
});

describe('Acceso al panel', () => {
  // TRUST_PROXY=1 permite simular IPs distintas con X-Forwarded-For (para probar el bloqueo sin bloquearnos).
  let servidor;
  before(async () => { servidor = await iniciarServidor({ TRUST_PROXY: '1' }); });
  after(() => servidor.cerrar());

  test('primer uso: crear la contraseña', async () => {
    const pedir = servidor.cliente();
    assert.deepEqual((await pedir('/api/sesion')).cuerpo, { autenticado: false, configurado: false });
    assert.equal((await pedir('/api/configurar', { metodo: 'POST', datos: { password: 'corta' } })).estado, 400);
    const r = await pedir('/api/configurar', { metodo: 'POST', datos: { password: PASSWORD } });
    assert.equal(r.estado, 200);
    const cookie = r.cabeceras.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Secure/, 'sin HTTPS la cookie no puede ser Secure');
    assert.equal((await pedir('/api/configurar', { metodo: 'POST', datos: { password: 'otra-clave-123' } })).estado, 409);
  });

  test('sin sesión no se puede modificar nada', async () => {
    const pedir = servidor.cliente();
    assert.equal((await pedir('/api/productos', { metodo: 'POST', datos: productoBase() })).estado, 401);
    assert.equal((await pedir('/api/pedidos')).estado, 401);
    assert.equal((await pedir('/api/imagenes', { metodo: 'POST', datos: { datos: PNG } })).estado, 401);
  });

  test('iniciar y cerrar sesión', async () => {
    const pedir = servidor.cliente({ 'X-Forwarded-For': '198.51.100.1' });
    assert.equal((await pedir('/api/login', { metodo: 'POST', datos: { password: 'equivocada' } })).estado, 401);
    assert.equal((await pedir('/api/login', { metodo: 'POST', datos: { password: PASSWORD } })).estado, 200);
    assert.equal((await pedir('/api/sesion')).cuerpo.autenticado, true);
    await pedir('/api/logout', { metodo: 'POST' });
    assert.equal((await pedir('/api/sesion')).cuerpo.autenticado, false);
  });

  test('con HTTPS detrás del proxy la cookie es Secure', async () => {
    const pedir = servidor.cliente({ 'X-Forwarded-For': '198.51.100.2', 'X-Forwarded-Proto': 'https' });
    const r = await pedir('/api/login', { metodo: 'POST', datos: { password: PASSWORD } });
    assert.match(r.cabeceras.get('set-cookie'), /Secure/);
  });

  test('5 intentos fallidos bloquean esa IP, pero no a las demás', async () => {
    const atacante = servidor.cliente({ 'X-Forwarded-For': '203.0.113.9' });
    for (let i = 0; i < 5; i++) await atacante('/api/login', { metodo: 'POST', datos: { password: 'mala' } });
    assert.equal((await atacante('/api/login', { metodo: 'POST', datos: { password: PASSWORD } })).estado, 429);
    const otra = servidor.cliente({ 'X-Forwarded-For': '203.0.113.10' });
    assert.equal((await otra('/api/login', { metodo: 'POST', datos: { password: PASSWORD } })).estado, 200);
  });

  test('cambiar la contraseña', async () => {
    const pedir = servidor.cliente({ 'X-Forwarded-For': '198.51.100.3' });
    await pedir('/api/login', { metodo: 'POST', datos: { password: PASSWORD } });
    assert.equal((await pedir('/api/cambiar-password', { metodo: 'POST', datos: { actual: 'mala', nueva: 'nueva-clave-123' } })).estado, 400);
    assert.equal((await pedir('/api/cambiar-password', { metodo: 'POST', datos: { actual: PASSWORD, nueva: 'nueva-clave-123' } })).estado, 200);
    const otro = servidor.cliente({ 'X-Forwarded-For': '198.51.100.4' });
    assert.equal((await otro('/api/login', { metodo: 'POST', datos: { password: PASSWORD } })).estado, 401);
    assert.equal((await otro('/api/login', { metodo: 'POST', datos: { password: 'nueva-clave-123' } })).estado, 200);
  });
});

describe('Productos, categorías y fotos', () => {
  let servidor;
  let pedir;
  before(async () => {
    servidor = await iniciarServidor();
    pedir = servidor.cliente();
    await entrarAlPanel(pedir);
  });
  after(() => servidor.cerrar());

  test('crear un producto: id a partir del nombre y textos limpios', async () => {
    const r = await pedir('/api/productos', { metodo: 'POST', datos: productoBase({ nombre: 'Tenis <script>Prueba</script>' }) });
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.nombre, 'Tenis scriptPrueba/script');
    assert.equal(r.cuerpo.id, 'tenis-scriptprueba-script');
    const repetido = await pedir('/api/productos', { metodo: 'POST', datos: productoBase({ nombre: 'Tenis <script>Prueba</script>' }) });
    assert.equal(repetido.cuerpo.id, 'tenis-scriptprueba-script-2');
  });

  test('validaciones del producto', async () => {
    const casos = [
      [{ nombre: '' }, /nombre/],
      [{ categoria: 'inventada' }, /Categoría/],
      [{ precio: 0 }, /precio/],
      [{ precioOferta: 1500 }, /oferta/],
      [{ tallas: ['26', '26'] }, /tallas/],
      [{ variantes: [] }, /variante/],
      [{ variantes: [{ nombre: '', hex: '#111111', stock: { 26: 1, 27: 1 } }] }, /nombre/],
      [{ variantes: [{ nombre: 'X', hex: 'rojo', stock: { 26: 1, 27: 1 } }] }, /Color/],
      [{ variantes: [{ nombre: 'X', hex: '#111111', stock: { 26: -1, 27: 1 } }] }, /Inventario/],
      [{ variantes: [{ nombre: 'X', hex: '#111111', stock: { 26: 1, 27: 1 }, imagen: '../server.js' }] }, /Imagen/],
      [{ costo: -5 }, /costo/],
      [{ variantes: [{ nombre: 'X', hex: '#111111', stock: { 26: 1, 27: 1 }, costo: 'caro' }] }, /Costo/],
    ];
    for (const [cambio, mensaje] of casos) {
      const r = await pedir('/api/productos', { metodo: 'POST', datos: productoBase(cambio) });
      assert.equal(r.estado, 400, JSON.stringify(cambio));
      assert.match(r.cuerpo.error, mensaje, JSON.stringify(cambio));
    }
  });

  test('el costo se guarda, pero solo lo ve el panel', async () => {
    const r = await pedir('/api/productos', {
      metodo: 'POST',
      datos: productoBase({ nombre: 'Con Costo', costo: 450, variantes: [{ nombre: 'Negro', hex: '#111111', stock: { 26: 1, 27: 1 }, costo: 480 }] }),
    });
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.costo, 450);
    assert.equal(r.cuerpo.variantes[0].costo, 480);
    const enPanel = (await pedir('/api/catalogo')).cuerpo.productos.find((p) => p.id === 'con-costo');
    assert.equal(enPanel.costo, 450);
    const publico = await (await fetch(`${servidor.base}/api/catalogo`)).text();
    assert.ok(publico.includes('con-costo'));
    assert.ok(!publico.includes('"costo"'), 'la tienda pública no debe recibir costos');
    const pagina = await (await fetch(`${servidor.base}/producto/con-costo`)).text();
    assert.ok(!pagina.includes('450') && !pagina.includes('480'));
  });

  test('editar y eliminar un producto (se quita de los relacionados)', async () => {
    const a = (await pedir('/api/productos', { metodo: 'POST', datos: productoBase({ nombre: 'Producto A' }) })).cuerpo;
    const b = (await pedir('/api/productos', { metodo: 'POST', datos: productoBase({ nombre: 'Producto B', relacionados: [a.id] }) })).cuerpo;
    assert.deepEqual(b.relacionados, [a.id]);
    const editado = await pedir(`/api/productos/${a.id}`, { metodo: 'PUT', datos: { ...a, precio: 1234 } });
    assert.equal(editado.cuerpo.precio, 1234);
    assert.equal(editado.cuerpo.id, a.id);
    assert.equal((await pedir(`/api/productos/${a.id}`, { metodo: 'DELETE' })).estado, 200);
    const catalogo = (await pedir('/api/catalogo')).cuerpo;
    assert.ok(!catalogo.productos.some((p) => p.id === a.id));
    assert.deepEqual(catalogo.productos.find((p) => p.id === b.id).relacionados, []);
    assert.equal((await pedir('/api/productos/no-existe', { metodo: 'DELETE' })).estado, 404);
  });

  test('categorías: crear, editar, ordenar y eliminar', async () => {
    const r = await pedir('/api/categorias', { metodo: 'POST', datos: { nombre: 'Escolar <b>', desc: 'Para la escuela', tipo: 'oxford', hex: '#112233' } });
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.id, 'escolar-b');
    assert.equal((await pedir('/api/categorias', { metodo: 'POST', datos: { nombre: 'X', tipo: 'Mal Tipo', hex: '#112233' } })).estado, 400);
    assert.equal((await pedir('/api/categorias', { metodo: 'POST', datos: { nombre: '', tipo: 'tenis', hex: '#112233' } })).estado, 400);
    const editada = await pedir('/api/categorias/escolar-b', { metodo: 'PUT', datos: { nombre: 'Escolar', desc: 'Nueva', tipo: 'tenis', hex: '#AABBCC' } });
    assert.equal(editada.cuerpo.hex, '#aabbcc');

    const ids = (await pedir('/api/catalogo')).cuerpo.categorias.map((c) => c.id);
    const invertido = [...ids].reverse();
    assert.equal((await pedir('/api/categorias/orden', { metodo: 'POST', datos: { ids: invertido } })).estado, 200);
    assert.deepEqual((await pedir('/api/catalogo')).cuerpo.categorias.map((c) => c.id), invertido);
    assert.equal((await pedir('/api/categorias/orden', { metodo: 'POST', datos: { ids: ids.slice(1) } })).estado, 400);
    assert.equal((await pedir('/api/categorias/orden', { metodo: 'POST', datos: { ids: [...ids.slice(1), 'otra'] } })).estado, 400);

    assert.equal((await pedir('/api/categorias/hombre', { metodo: 'DELETE' })).estado, 409, 'no se borra una categoría con productos');
    assert.equal((await pedir('/api/categorias/escolar-b', { metodo: 'DELETE' })).estado, 200);
  });

  test('fotos: subir, servir y rechazar formatos o tamaños no permitidos', async () => {
    const r = await pedir('/api/imagenes', { metodo: 'POST', datos: { datos: PNG } });
    assert.equal(r.estado, 201);
    assert.match(r.cuerpo.ruta, /^img\/productos\/[a-z0-9-]+\.png$/);
    const foto = await pedir(`/${r.cuerpo.ruta}`);
    assert.equal(foto.estado, 200);
    assert.match(foto.cabeceras.get('cache-control'), /immutable/);
    assert.equal((await pedir('/api/imagenes', { metodo: 'POST', datos: { datos: 'data:image/gif;base64,R0lGOD' } })).estado, 400);
    const enorme = `data:image/png;base64,${Buffer.alloc(5_300_000).toString('base64')}`; // más de 5 MB
    assert.equal((await pedir('/api/imagenes', { metodo: 'POST', datos: { datos: enorme } })).estado, 413);
  });

  test('fotos sin usar se borran solas; las usadas y las recién subidas se conservan', async () => {
    const subir = async () => (await pedir('/api/imagenes', { metodo: 'POST', datos: { datos: PNG } })).cuerpo.ruta;
    const archivo = (ruta) => path.join(servidor.datos, 'imagenes', path.basename(ruta));
    const usada = await subir();
    const vieja = await subir();
    const reciente = await subir();
    const hace2h = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(archivo(usada), hace2h, hace2h);
    fs.utimesSync(archivo(vieja), hace2h, hace2h);

    const p = (await pedir('/api/productos', { metodo: 'POST', datos: productoBase({ nombre: 'Con Foto' }) })).cuerpo;
    p.variantes[0].imagen = usada;
    assert.equal((await pedir(`/api/productos/${p.id}`, { metodo: 'PUT', datos: p })).estado, 200);
    assert.ok(await esperarHasta(() => !fs.existsSync(archivo(vieja))), 'la foto vieja sin usar debe borrarse');
    assert.ok(fs.existsSync(archivo(usada)), 'la foto en uso se conserva');
    assert.ok(fs.existsSync(archivo(reciente)), 'la foto recién subida se conserva');

    delete p.variantes[0].imagen;
    await pedir(`/api/productos/${p.id}`, { metodo: 'PUT', datos: p });
    assert.ok(await esperarHasta(() => !fs.existsSync(archivo(usada))), 'al quitarla del producto, la foto se borra');
  });
});
