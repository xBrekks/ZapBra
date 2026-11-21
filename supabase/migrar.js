'use strict';
/*
 * Copia a Supabase lo que hoy está en la carpeta data/: categorías, productos, fotos y la contraseña del panel.
 * No borra nada de data/.
 *
 *   npm run migrar
 *
 * Solo funciona con la base vacía, para no duplicar ni pisar datos.
 */
const fsp = require('node:fs/promises');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(RAIZ, '.env')); } catch {}
const { crearAlmacen } = require('../almacen');

const DATOS = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(RAIZ, 'data');
const almacen = crearAlmacen({ datos: DATOS, datosIniciales: path.join(RAIZ, 'data') });

(async () => {
  if (almacen.modo !== 'supabase') throw new Error('Falta SUPABASE_URL o SUPABASE_SECRET_KEY en el archivo .env');
  const { sb } = almacen;
  await almacen.preparar();

  const [hayCategorias, hayProductos] = await Promise.all([
    sb('/rest/v1/categorias?select=id&limit=1'),
    sb('/rest/v1/productos?select=id&limit=1'),
  ]);
  if (hayCategorias.length || hayProductos.length) {
    throw new Error('Supabase ya tiene categorías o productos. La migración solo se hace una vez, con la base vacía.');
  }

  const catalogo = JSON.parse(await fsp.readFile(path.join(DATOS, 'catalogo.json'), 'utf8'));

  // 1. Fotos que usa algún producto
  const fotos = [...new Set(catalogo.productos.flatMap((p) => p.variantes.map((v) => v.imagen)).filter(Boolean))];
  for (const ruta of fotos) {
    const nombre = path.basename(ruta);
    try {
      await almacen.guardarImagen(nombre, await fsp.readFile(path.join(DATOS, 'imagenes', nombre)));
    } catch (e) {
      if (e.code === 'ENOENT') { console.warn(`  Aviso: no se encontró la foto ${nombre}`); continue; }
      if (e.status !== 409 && !/exists/i.test(e.message)) throw e; // 409 = ya estaba subida
    }
  }
  console.log(`Fotos: ${fotos.length}`);

  // 2. Categorías (con su orden)
  await almacen.guardarCatalogo(catalogo, { categorias: true });
  console.log(`Categorías: ${catalogo.categorias.length}`);

  // 3. Productos, conservando el orden actual
  const inicio = Date.now() - catalogo.productos.length * 1000;
  await sb('/rest/v1/productos', {
    metodo: 'POST',
    cuerpo: catalogo.productos.map((p, i) => ({
      id: p.id, categoria: p.categoria, datos: p, creado: new Date(inicio + i * 1000).toISOString(),
    })),
    cabeceras: { Prefer: 'return=minimal' },
  });
  console.log(`Productos: ${catalogo.productos.length}`);

  // 4. Contraseña del panel (ya cifrada; se copia tal cual)
  try {
    const admin = JSON.parse(await fsp.readFile(path.join(DATOS, 'admin.json'), 'utf8'));
    if (await almacen.leerAdmin()) console.log('Contraseña del panel: ya existía en Supabase, no se cambió');
    else { await almacen.crearAdmin(admin); console.log('Contraseña del panel: copiada (sigue siendo la misma)'); }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('Contraseña del panel: no había; se creará la primera vez que entres a /admin');
  }

  // Comprobación final
  const leido = await almacen.leerCatalogo();
  if (leido.productos.length !== catalogo.productos.length || leido.categorias.length !== catalogo.categorias.length) {
    throw new Error('Lo guardado en Supabase no coincide con data/catalogo.json');
  }
  console.log('\nListo. Tu catálogo ya está en Supabase.');
})().catch((e) => {
  console.error(`\nNo se pudo migrar: ${e.message}`);
  process.exitCode = 1;
});
