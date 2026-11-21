'use strict';
/*
 * Dónde se guardan el catálogo, la contraseña del panel y las fotos.
 *
 *   - Supabase: si existen SUPABASE_URL y SUPABASE_SECRET_KEY (archivo .env o variables del hosting).
 *   - Archivos: si no, en la carpeta de datos (data/ o DATA_DIR), como antes.
 *
 * Ambos ofrecen las mismas funciones, así que server.js no sabe cuál está usando.
 */
const fsp = require('node:fs/promises');
const path = require('node:path');

const GRACIA_IMAGENES = 60 * 60 * 1000; // fotos sin usar se borran tras 1 hora (da tiempo de guardar el producto)
const TIPOS_IMAGEN = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PEDIDOS_LISTA = 500; // los más recientes, para la pestaña Pedidos
const PEDIDOS_TODOS = 5000; // tope para el tablero, que necesita el historial completo

const error = (mensaje, estado) => Object.assign(new Error(mensaje), estado && { estado });

// Folio visible para el cliente y el panel: ZB-0001, ZB-0002…
const conFolio = (pedido) => ({ ...pedido, folio: `ZB-${String(pedido.id).padStart(4, '0')}` });

// Fotos que usa algún producto (solo el nombre del archivo).
const imagenesUsadas = (catalogo) =>
  new Set(catalogo.productos.flatMap((p) => p.variantes.map((v) => v.imagen)).filter(Boolean).map((r) => path.basename(r)));

// ---------- Archivos locales ----------
function almacenArchivos({ datos, datosIniciales }) {
  const ARCHIVO_CATALOGO = path.join(datos, 'catalogo.json');
  const ARCHIVO_ADMIN = path.join(datos, 'admin.json');
  const ARCHIVO_PEDIDOS = path.join(datos, 'pedidos.json');
  const CARPETA_IMAGENES = path.join(datos, 'imagenes');
  let colaEscritura = Promise.resolve();
  let colaPedidos = Promise.resolve();

  const leerPedidos = async () => {
    try { return JSON.parse(await fsp.readFile(ARCHIVO_PEDIDOS, 'utf8')); } catch { return { ultimoId: 0, pedidos: [] }; }
  };
  // Lee, modifica y escribe pedidos.json en orden, para que dos pedidos simultáneos no se pisen.
  const conPedidos = (fn) => {
    const tarea = colaPedidos.then(async () => {
      const archivo = await leerPedidos();
      const resultado = await fn(archivo);
      const tmp = ARCHIVO_PEDIDOS + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(archivo, null, 2));
      await fsp.rename(tmp, ARCHIVO_PEDIDOS);
      return resultado;
    });
    colaPedidos = tarea.catch(() => {});
    return tarea;
  };

  return {
    modo: 'archivos',
    carpetaImagenes: CARPETA_IMAGENES,

    // Si DATA_DIR apunta a una carpeta nueva (ej. el disco persistente del hosting), copia el catálogo inicial.
    async preparar() {
      await fsp.mkdir(CARPETA_IMAGENES, { recursive: true });
      try {
        await fsp.access(ARCHIVO_CATALOGO);
      } catch {
        await fsp.copyFile(path.join(datosIniciales, 'catalogo.json'), ARCHIVO_CATALOGO);
        console.log(`Catálogo inicial copiado a ${ARCHIVO_CATALOGO}`);
      }
    },

    async leerCatalogo() {
      return JSON.parse(await fsp.readFile(ARCHIVO_CATALOGO, 'utf8'));
    },

    // Escritura atómica con respaldo; las escrituras se encolan para no pisarse.
    // (El segundo parámetro, "cambios", solo lo usa Supabase.)
    guardarCatalogo(catalogo) {
      colaEscritura = colaEscritura.then(async () => {
        const tmp = ARCHIVO_CATALOGO + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(catalogo, null, 2));
        await fsp.copyFile(ARCHIVO_CATALOGO, path.join(datos, 'catalogo.respaldo.json')).catch(() => {});
        await fsp.rename(tmp, ARCHIVO_CATALOGO);
      });
      return colaEscritura;
    },

    async leerAdmin() {
      try { return JSON.parse(await fsp.readFile(ARCHIVO_ADMIN, 'utf8')); } catch { return null; }
    },

    async crearAdmin(admin) {
      try {
        await fsp.writeFile(ARCHIVO_ADMIN, JSON.stringify(admin), { flag: 'wx' });
      } catch (e) {
        throw e.code === 'EEXIST' ? error('La contraseña ya fue configurada', 409) : e;
      }
    },

    async guardarAdmin(admin) {
      await fsp.writeFile(ARCHIVO_ADMIN, JSON.stringify(admin));
    },

    async guardarImagen(nombre, binario) {
      await fsp.mkdir(CARPETA_IMAGENES, { recursive: true });
      await fsp.writeFile(path.join(CARPETA_IMAGENES, nombre), binario);
    },

    urlImagen: () => null, // las sirve server.js desde la carpeta de datos

    crearPedido(pedido) {
      return conPedidos((archivo) => {
        const nuevo = { id: ++archivo.ultimoId, creado: new Date().toISOString(), ...pedido };
        archivo.pedidos.push(nuevo);
        return conFolio(nuevo);
      });
    },

    async listarPedidos({ todos = false } = {}) {
      return (await leerPedidos()).pedidos.slice(-(todos ? PEDIDOS_TODOS : PEDIDOS_LISTA)).reverse().map(conFolio);
    },

    async leerPedido(id) {
      const pedido = (await leerPedidos()).pedidos.find((p) => p.id === id);
      return pedido ? conFolio(pedido) : null;
    },

    guardarPedido({ folio, ...pedido }) {
      return conPedidos((archivo) => {
        const i = archivo.pedidos.findIndex((p) => p.id === pedido.id);
        if (i === -1) throw error('Pedido no encontrado', 404);
        archivo.pedidos[i] = pedido;
      });
    },

    // Borra fotos que ningún producto usa (las recién subidas se respetan durante GRACIA_IMAGENES).
    async limpiarImagenes(catalogo) {
      const usadas = imagenesUsadas(catalogo);
      const limite = Date.now() - GRACIA_IMAGENES;
      let archivos = [];
      try { archivos = await fsp.readdir(CARPETA_IMAGENES); } catch { return; }
      for (const archivo of archivos) {
        if (usadas.has(archivo)) continue;
        const ruta = path.join(CARPETA_IMAGENES, archivo);
        try {
          if ((await fsp.stat(ruta)).mtimeMs < limite) await fsp.unlink(ruta);
        } catch { /* ya no existe */ }
      }
    },
  };
}

// ---------- Supabase ----------
// Usa la API REST de Supabase directamente (sin paquetes). La clave secreta solo vive en el servidor.
function almacenSupabase({ url, clave, bucket = 'productos' }) {
  const DURACION_CACHE = 30 * 1000; // por si alguien edita directo en el panel de Supabase
  let cache = null; // { catalogo, hasta }
  let adminCache; // undefined = sin leer; null = no configurado
  let colaEscritura = Promise.resolve();
  let hayTablaPedidos = true;

  async function sb(ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
    const opciones = { method: metodo, headers: { apikey: clave, Authorization: `Bearer ${clave}`, ...cabeceras } };
    if (cuerpo !== undefined) {
      if (Buffer.isBuffer(cuerpo)) opciones.body = cuerpo;
      else {
        opciones.body = JSON.stringify(cuerpo);
        opciones.headers['Content-Type'] = 'application/json';
      }
    }
    const res = await fetch(url + ruta, opciones);
    const textoRes = await res.text();
    let datos = null;
    try { datos = textoRes ? JSON.parse(textoRes) : null; } catch { datos = textoRes; }
    if (!res.ok) {
      const e = error(`Supabase ${metodo} ${ruta.split('?')[0]} → ${res.status}: ${datos?.message || textoRes}`);
      e.status = res.status;
      e.codigo = datos?.code;
      throw e;
    }
    return datos;
  }

  const lista = (ids) => `in.(${ids.map((id) => `"${id}"`).join(',')})`;

  // En la tabla, id, creado y estado son columnas; el resto del pedido va en "datos".
  const filaAPedido = ({ id, creado, estado, datos }) => conFolio({ id, creado, estado, ...datos });
  const pedidoADatos = ({ id, creado, estado, folio, ...datos }) => datos;
  const revisarTablaPedidos = () => {
    if (!hayTablaPedidos) throw error('Falta crear la tabla de pedidos: ejecuta supabase/esquema.sql en Supabase', 503);
  };
  const upsert = (tabla, filas) =>
    sb(`/rest/v1/${tabla}`, { metodo: 'POST', cuerpo: filas, cabeceras: { Prefer: 'resolution=merge-duplicates,return=minimal' } });

  return {
    modo: 'supabase',
    sb,
    bucket,

    // Comprueba que las tablas existan y crea el almacenamiento de fotos si falta.
    async preparar() {
      try {
        await sb('/rest/v1/categorias?select=id&limit=1');
      } catch (e) {
        if (e.codigo === 'PGRST205') {
          throw error('Faltan las tablas en Supabase. Ejecuta supabase/esquema.sql en el SQL Editor de tu proyecto.');
        }
        throw e;
      }
      // Sin la tabla de pedidos la tienda funciona igual; solo los pedidos quedan desactivados.
      try {
        await sb('/rest/v1/pedidos?select=id&limit=1');
        hayTablaPedidos = true;
      } catch (e) {
        if (e.codigo !== 'PGRST205') throw e;
        hayTablaPedidos = false;
        console.warn('Aviso: falta la tabla "pedidos" en Supabase. Ejecuta supabase/esquema.sql para activar los pedidos.');
      }
      try {
        await sb(`/storage/v1/bucket/${bucket}`);
      } catch {
        await sb('/storage/v1/bucket', {
          metodo: 'POST',
          cuerpo: { id: bucket, name: bucket, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: Object.values(TIPOS_IMAGEN) },
        });
        console.log(`Almacenamiento de fotos "${bucket}" creado en Supabase`);
      }
    },

    async leerCatalogo() {
      if (!cache || cache.hasta < Date.now()) {
        const [categorias, productos] = await Promise.all([
          sb('/rest/v1/categorias?select=id,nombre,descr,tipo,hex&order=orden,id'),
          sb('/rest/v1/productos?select=datos&order=creado,id'),
        ]);
        cache = {
          hasta: Date.now() + DURACION_CACHE,
          catalogo: {
            categorias: categorias.map(({ descr, ...c }) => ({ ...c, desc: descr })),
            productos: productos.map((f) => f.datos),
          },
        };
      }
      return structuredClone(cache.catalogo); // las rutas del servidor modifican la copia
    },

    // Solo envía lo que cambió:
    //   cambios = { categorias: true, productos: [ids], borrarProductos: [ids], borrarCategorias: [ids] }
    guardarCatalogo(catalogo, cambios = {}) {
      colaEscritura = colaEscritura.catch(() => {}).then(async () => {
        try {
          if (cambios.categorias) {
            await upsert('categorias', catalogo.categorias.map((c, orden) => ({
              id: c.id, nombre: c.nombre, descr: c.desc || '', tipo: c.tipo, hex: c.hex, orden,
            })));
          }
          const ids = new Set(cambios.productos || []);
          if (ids.size) {
            await upsert('productos', catalogo.productos
              .filter((p) => ids.has(p.id))
              .map((p) => ({ id: p.id, categoria: p.categoria, datos: p })));
          }
          if (cambios.borrarProductos?.length) {
            await sb(`/rest/v1/productos?id=${lista(cambios.borrarProductos)}`, { metodo: 'DELETE' });
          }
          if (cambios.borrarCategorias?.length) {
            await sb(`/rest/v1/categorias?id=${lista(cambios.borrarCategorias)}`, { metodo: 'DELETE' });
          }
        } finally {
          cache = null; // la siguiente lectura trae lo que quedó guardado
        }
      });
      return colaEscritura;
    },

    async leerAdmin() {
      if (adminCache === undefined) {
        const filas = await sb('/rest/v1/ajustes?clave=eq.admin&select=valor');
        adminCache = filas[0]?.valor || null;
      }
      return adminCache;
    },

    async crearAdmin(admin) {
      try {
        await sb('/rest/v1/ajustes', { metodo: 'POST', cuerpo: { clave: 'admin', valor: admin }, cabeceras: { Prefer: 'return=minimal' } });
      } catch (e) {
        if (e.status === 409) { adminCache = undefined; throw error('La contraseña ya fue configurada', 409); }
        throw e;
      }
      adminCache = admin;
    },

    async guardarAdmin(admin) {
      await upsert('ajustes', [{ clave: 'admin', valor: admin }]);
      adminCache = admin;
    },

    async guardarImagen(nombre, binario) {
      await sb(`/storage/v1/object/${bucket}/${nombre}`, {
        metodo: 'POST',
        cuerpo: binario,
        cabeceras: { 'Content-Type': TIPOS_IMAGEN[path.extname(nombre)], 'cache-control': 'max-age=31536000' },
      });
    },

    urlImagen: (nombre) => `${url}/storage/v1/object/public/${bucket}/${encodeURIComponent(nombre)}`,

    async crearPedido(pedido) {
      revisarTablaPedidos();
      const [fila] = await sb('/rest/v1/pedidos', {
        metodo: 'POST',
        cuerpo: { estado: pedido.estado, datos: pedidoADatos(pedido) },
        cabeceras: { Prefer: 'return=representation' },
      });
      return filaAPedido(fila);
    },

    async listarPedidos({ todos = false } = {}) {
      revisarTablaPedidos();
      if (!todos) return (await sb(`/rest/v1/pedidos?select=*&order=id.desc&limit=${PEDIDOS_LISTA}`)).map(filaAPedido);
      // Supabase entrega un número máximo de filas por consulta: se piden por páginas hasta que no lleguen más.
      const filas = [];
      while (filas.length < PEDIDOS_TODOS) {
        const pagina = await sb(`/rest/v1/pedidos?select=*&order=id.desc&limit=1000&offset=${filas.length}`);
        if (!pagina.length) break;
        filas.push(...pagina);
      }
      return filas.slice(0, PEDIDOS_TODOS).map(filaAPedido);
    },

    async leerPedido(id) {
      revisarTablaPedidos();
      const [fila] = await sb(`/rest/v1/pedidos?select=*&id=eq.${Number(id)}`);
      return fila ? filaAPedido(fila) : null;
    },

    async guardarPedido(pedido) {
      revisarTablaPedidos();
      await sb(`/rest/v1/pedidos?id=eq.${Number(pedido.id)}`, {
        metodo: 'PATCH',
        cuerpo: { estado: pedido.estado, datos: pedidoADatos(pedido) },
        cabeceras: { Prefer: 'return=minimal' },
      });
    },

    async limpiarImagenes(catalogo) {
      const usadas = imagenesUsadas(catalogo);
      const limite = Date.now() - GRACIA_IMAGENES;
      const borrar = [];
      for (let offset = 0; ; offset += 1000) {
        const archivos = await sb(`/storage/v1/object/list/${bucket}`, {
          metodo: 'POST',
          cuerpo: { prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } },
        });
        for (const a of archivos) {
          if (a.id && !usadas.has(a.name) && Date.parse(a.created_at) < limite) borrar.push(a.name);
        }
        if (archivos.length < 1000) break;
      }
      if (borrar.length) await sb(`/storage/v1/object/${bucket}`, { metodo: 'DELETE', cuerpo: { prefixes: borrar } });
    },
  };
}

function crearAlmacen({ datos, datosIniciales }) {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = (process.env.SUPABASE_SECRET_KEY || '').trim();
  // ALMACEN=archivos obliga a usar la carpeta de datos aunque haya claves de Supabase (lo usan las pruebas).
  const usarSupabase = url && clave && process.env.ALMACEN !== 'archivos';
  return usarSupabase ? almacenSupabase({ url, clave }) : almacenArchivos({ datos, datosIniciales });
}

module.exports = { crearAlmacen, almacenSupabase };
