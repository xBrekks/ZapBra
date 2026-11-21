'use strict';
/*
 * Servidor de Zapatería Brazil.
 * Sirve la tienda (carpeta public/) y la API del panel de administración.
 * Sin dependencias externas: solo necesita Node.js 20.12 o superior.
 *
 *   node server.js          → http://localhost:3000
 *
 * Variables de entorno (en el archivo .env o en el hosting):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY  Guardan catálogo, contraseña y fotos en Supabase (ver almacen.js)
 *   TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY  Verificación anti-bots de Cloudflare al entrar al panel (opcional)
 *   PORT         Puerto (por defecto 3000)
 *   DATA_DIR     Sin Supabase: carpeta persistente para catálogo, contraseña y fotos (por defecto ./data)
 *   TRUST_PROXY  "1" si el sitio está detrás de un proxy/HTTPS del hosting
 *   ALMACEN      "archivos" ignora Supabase y usa la carpeta de datos (lo usan las pruebas: npm test)
 *   TURNSTILE_VERIFY_URL  Solo para las pruebas: un Cloudflare falso que corre en la misma computadora
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* sin .env: se usan las variables del sistema */ }
const { crearAlmacen } = require('./almacen');

const PUERTO = process.env.PORT ? Number(process.env.PORT) : 3000; // PORT=0 deja que el sistema elija uno libre
const PUBLICO = path.join(__dirname, 'public');
const DATOS_INICIALES = path.join(__dirname, 'data');
const DATOS = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DATOS_INICIALES;
const CONFIAR_PROXY = process.env.TRUST_PROXY === '1';

// Verificación anti-bots de Cloudflare (Turnstile, gratis) al entrar al panel. Sin las dos claves, el panel
// pide solo la contraseña; quitarlas también sirve para apagarla si algún día Cloudflare fallara.
const TURNSTILE = process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY
  ? {
      sitekey: process.env.TURNSTILE_SITE_KEY,
      secreto: process.env.TURNSTILE_SECRET_KEY,
      url: process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    }
  : null;
const ACCION_PANEL = 'panel'; // el panel la fija al dibujar el recuadro; Cloudflare la devuelve al validar
const esClaveDePrueba = (clave) => /^[123]x0+[A-F]{2}$/.test(clave); // claves de prueba que publica Cloudflare

const almacen = crearAlmacen({ datos: DATOS, datosIniciales: DATOS_INICIALES });
const CARPETA_IMAGENES = almacen.carpetaImagenes; // solo sin Supabase; se sirven en /img/productos/

// Datos de la tienda física. La tienda los recibe en /api/catalogo; se usan en el carrito, los pedidos y Google.
const TIENDA = {
  nombre: 'Zapatería Brazil',
  whatsapp: '527771091249', // 52 + 10 dígitos
  telefono: '777 109 1249',
  calle: 'Calle Emiliano Zapata 29',
  colonia: 'Centro',
  cp: '62580',
  municipio: 'Temixco',
  estado: 'Morelos',
  direccion: 'Calle Emiliano Zapata 29, Centro, 62580 Temixco, Mor.',
  horario: 'Lunes a domingo, 10:00 a 19:00',
  abre: '10:00',
  cierra: '19:00',
  envioGratisDesde: 999,
  costoEnvio: 149,
};

const DURACION_SESION = 8 * 60 * 60 * 1000; // 8 horas
const MAX_CUERPO = 8 * 1024 * 1024; // 8 MB (imágenes en base64)
const MAX_IMAGEN = 5 * 1024 * 1024; // 5 MB
const SEGURIDAD = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Rutas cortas → archivo
const ALIAS = {
  '/admin': '/admin.html',
  '/cambios-y-devoluciones': '/cambios-y-devoluciones.html',
  '/aviso-de-privacidad': '/aviso-de-privacidad.html',
};

// ---------- Utilidades HTTP ----------
function enviarJSON(res, estado, datos, cabeceras = {}) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabeceras });
  res.end(JSON.stringify(datos));
}

const error = (res, estado, mensaje) => enviarJSON(res, estado, { error: mensaje });

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(Object.assign(new Error('Se esperaba JSON'), { estado: 415 }));
    }
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > MAX_CUERPO) {
        reject(Object.assign(new Error('La solicitud es demasiado grande'), { estado: 413 }));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON inválido'), { estado: 400 })); }
    });
    req.on('error', reject);
  });
}

// Detrás del proxy de un hosting, la IP y el protocolo reales vienen en cabeceras.
const ipCliente = (req) =>
  (CONFIAR_PROXY && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const esHttps = (req) =>
  req.socket.encrypted || (CONFIAR_PROXY && req.headers['x-forwarded-proto'] === 'https');

function leerCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v)
  );
}

// ---------- Catálogo ----------
const leerCatalogo = () => almacen.leerCatalogo();
const guardarCatalogo = (catalogo, cambios) => almacen.guardarCatalogo(catalogo, cambios);

// El costo de cada producto solo lo ve el panel: la tienda recibe el catálogo sin él.
const sinCostos = (catalogo) => ({
  ...catalogo,
  productos: catalogo.productos.map(({ costo, variantes, ...p }) => ({
    ...p,
    variantes: variantes.map(({ costo: _costo, ...v }) => v),
  })),
});

// Limpieza en segundo plano: si falla, no afecta la respuesta al panel.
const limpiarImagenes = (catalogo) =>
  almacen.limpiarImagenes(catalogo).catch((e) => console.error('No se pudieron limpiar las fotos:', e.message));

const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Limpia textos del panel: quita < > y cambia comillas rectas para que nunca rompan el HTML de la tienda.
const texto = (v, max = 200) =>
  typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/"/g, '”').trim().slice(0, max) : '';
const entero = (v) => Number.isInteger(v) && v >= 0;
const precioValido = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6;

// Valida y limpia una categoría enviada por el panel. Devuelve { categoria } o { error }.
function validarCategoria(d) {
  if (!d || typeof d !== 'object') return { error: 'Datos inválidos' };
  const nombre = texto(d.nombre, 40);
  if (!nombre) return { error: 'El nombre de la categoría es obligatorio' };
  if (!/^[a-z]{1,20}$/.test(d.tipo || '')) return { error: 'Ilustración inválida' };
  if (!/^#[0-9a-f]{6}$/i.test(d.hex || '')) return { error: 'Color inválido' };
  return { categoria: { id: d.id, nombre, desc: texto(d.desc, 80), tipo: d.tipo, hex: d.hex.toLowerCase() } };
}

// Valida y limpia un producto enviado por el panel. Devuelve { producto } o { error }.
function validarProducto(d, catalogo) {
  if (!d || typeof d !== 'object') return { error: 'Datos inválidos' };
  const nombre = texto(d.nombre, 120);
  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (!catalogo.categorias.some((c) => c.id === d.categoria)) return { error: 'Categoría inválida' };
  const sub = texto(d.sub, 60);
  if (!sub) return { error: 'El tipo (subcategoría) es obligatorio' };
  if (!precioValido(d.precio) || d.precio === 0) return { error: 'El precio debe ser mayor a 0' };
  if (d.precioOferta != null && (!precioValido(d.precioOferta) || d.precioOferta >= d.precio)) {
    return { error: 'El precio de oferta debe ser menor al precio normal' };
  }
  if (d.costo != null && !precioValido(d.costo)) return { error: 'El costo debe ser un número válido' };
  if (!['Color', 'Presentación'].includes(d.etiquetaVariante)) return { error: 'Tipo de variante inválido' };

  let tallas = null;
  if (d.tallas != null) {
    if (!Array.isArray(d.tallas) || !d.tallas.length || d.tallas.length > 30) return { error: 'Lista de tallas inválida' };
    tallas = d.tallas.map((t) => texto(String(t), 8));
    if (tallas.some((t) => !t) || new Set(tallas).size !== tallas.length) return { error: 'Hay tallas vacías o repetidas' };
  }

  if (!Array.isArray(d.variantes) || !d.variantes.length) return { error: 'Agrega al menos una variante' };
  const variantes = [];
  for (const v of d.variantes) {
    const vn = texto(v?.nombre, 60);
    if (!vn) return { error: 'Cada variante necesita un nombre' };
    if (variantes.some((x) => x.nombre === vn)) return { error: `La variante "${vn}" está repetida` };
    if (!/^#[0-9a-f]{6}$/i.test(v.hex || '')) return { error: `Color inválido en "${vn}"` };
    const limpia = { nombre: vn, hex: v.hex.toLowerCase() };
    if (v.precio != null) {
      if (!precioValido(v.precio) || v.precio === 0) return { error: `Precio inválido en "${vn}"` };
      limpia.precio = v.precio;
    }
    if (v.costo != null) {
      if (!precioValido(v.costo)) return { error: `Costo inválido en "${vn}"` };
      limpia.costo = v.costo;
    }
    if (v.imagen) {
      if (typeof v.imagen !== 'string' || !/^img\/productos\/[a-z0-9-]+\.(jpg|png|webp)$/.test(v.imagen)) {
        return { error: `Imagen inválida en "${vn}"` };
      }
      limpia.imagen = v.imagen;
    }
    if (tallas) {
      if (!v.stock || typeof v.stock !== 'object') return { error: `Falta el inventario por talla en "${vn}"` };
      limpia.stock = {};
      for (const t of tallas) {
        const n = v.stock[t] ?? 0;
        if (!entero(n)) return { error: `Inventario inválido en "${vn}", talla ${t}` };
        limpia.stock[t] = n;
      }
    } else {
      if (!entero(v.stock)) return { error: `Inventario inválido en "${vn}"` };
      limpia.stock = v.stock;
    }
    variantes.push(limpia);
  }

  const ids = new Set(catalogo.productos.map((p) => p.id));
  const producto = {
    id: d.id,
    nombre,
    marca: texto(d.marca, 60),
    categoria: d.categoria,
    sub,
    tipo: texto(d.tipo, 30) || 'tenis',
    precio: d.precio,
    ...(d.precioOferta != null && { precioOferta: d.precioOferta }),
    ...(d.costo != null && { costo: d.costo }),
    ...(d.nuevo === true && { nuevo: true }),
    material: texto(d.material, 160),
    ...(texto(d.calce, 80) && { calce: texto(d.calce, 80) }),
    descripcion: texto(d.descripcion, 1000),
    ...(tallas && { tallas }),
    etiquetaVariante: d.etiquetaVariante,
    variantes,
    relacionados: Array.isArray(d.relacionados)
      ? [...new Set(d.relacionados)].filter((r) => r !== d.id && ids.has(r)).slice(0, 6)
      : [],
  };
  return { producto };
}

// ---------- Pedidos ----------
// A qué estados puede pasar un pedido desde cada estado.
const TRANSICIONES = { nuevo: ['confirmado', 'cancelado'], confirmado: ['entregado', 'cancelado'], entregado: [], cancelado: [] };
const MAX_PEDIDOS_IP = 5; // por cada 10 minutos, para frenar pedidos falsos en serie
const pedidosPorIp = new Map(); // ip → [momento de cada pedido]

function demasiadosPedidos(ip) {
  const recientes = (pedidosPorIp.get(ip) || []).filter((t) => t > Date.now() - 10 * 60 * 1000);
  pedidosPorIp.set(ip, recientes);
  return recientes.length >= MAX_PEDIDOS_IP;
}

const precioVariante = (p, v) => v.precio ?? p.precioOferta ?? p.precio;
// Lo que ve el cliente de su pedido: todo menos el costo de cada pieza.
const pedidoParaCliente = ({ articulos, ...pedido }) => ({ ...pedido, articulos: articulos.map(({ costo, ...a }) => a) });
const stockDe = (v, talla) => (typeof v.stock === 'number' ? v.stock : v.stock[talla] || 0);
const describir = (a) => `${a.nombre} (${a.variante}${a.talla ? `, talla ${a.talla}` : ''})`;
const costoEnvio = (entrega, subtotal) =>
  entrega === 'tienda' || subtotal >= TIENDA.envioGratisDesde ? 0 : TIENDA.costoEnvio;

// Valida un pedido de la tienda. Devuelve { pedido } o { error, estado? }.
function validarPedido(d, catalogo) {
  if (!d || typeof d !== 'object') return { error: 'Datos inválidos' };
  if (!['envio', 'tienda'].includes(d.entrega)) return { error: 'Elige cómo quieres recibir tu pedido' };

  const c = d.cliente && typeof d.cliente === 'object' ? d.cliente : {};
  const nombre = texto(c.nombre, 80);
  if (nombre.length < 2) return { error: 'Escribe tu nombre' };
  const telefono = String(c.telefono ?? '').replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');
  if (!/^\d{10}$/.test(telefono)) return { error: 'El teléfono debe tener 10 dígitos' };
  const cliente = { nombre, telefono };
  if (d.entrega === 'envio') {
    for (const [campo, etiqueta, max] of [['calle', 'calle y número', 120], ['colonia', 'colonia', 80], ['municipio', 'municipio o ciudad', 80], ['estado', 'estado', 40]]) {
      cliente[campo] = texto(c[campo], max);
      if (!cliente[campo]) return { error: `Escribe tu ${etiqueta}` };
    }
    cliente.cp = String(c.cp ?? '').trim();
    if (!/^\d{5}$/.test(cliente.cp)) return { error: 'El código postal debe tener 5 dígitos' };
    cliente.referencias = texto(c.referencias, 200);
  }

  if (!Array.isArray(d.articulos) || !d.articulos.length) return { error: 'Tu carrito está vacío' };
  if (d.articulos.length > 30) return { error: 'Demasiados artículos en un solo pedido' };
  const articulos = [];
  for (const a of d.articulos) {
    const p = catalogo.productos.find((x) => x.id === a?.id);
    const v = p?.variantes.find((x) => x.nombre === a.variante);
    if (!v) return { error: 'Un producto de tu carrito ya no está disponible. Quítalo e intenta de nuevo.', estado: 409 };
    const talla = p.tallas ? a.talla : undefined;
    if (p.tallas && !p.tallas.includes(talla)) return { error: `Elige una talla válida para ${p.nombre}` };
    if (!Number.isInteger(a.cant) || a.cant < 1 || a.cant > 20) return { error: 'Cantidad inválida' };
    // El costo se guarda con el pedido, para que la ganancia no cambie si después cambia el costo del producto.
    const costo = v.costo ?? p.costo;
    const art = {
      id: p.id, nombre: p.nombre, variante: v.nombre, ...(talla && { talla }), cant: a.cant,
      precio: precioVariante(p, v), ...(costo != null && { costo }),
    };
    if (articulos.some((x) => x.id === art.id && x.variante === art.variante && x.talla === art.talla)) {
      return { error: 'Hay un artículo repetido en el carrito' };
    }
    const hay = stockDe(v, talla);
    if (hay < a.cant) {
      return { error: hay ? `Solo quedan ${hay} de ${describir(art)}. Ajusta la cantidad.` : `${describir(art)} se agotó. Quítalo del carrito.`, estado: 409 };
    }
    articulos.push(art);
  }

  const subtotal = articulos.reduce((s, a) => s + a.precio * a.cant, 0);
  const envio = costoEnvio(d.entrega, subtotal);
  return {
    pedido: {
      estado: 'nuevo',
      entrega: d.entrega,
      cliente,
      articulos,
      subtotal,
      envio,
      total: subtotal + envio,
      notas: texto(d.notas, 300),
      inventarioDescontado: false,
      historial: [{ estado: 'nuevo', fecha: new Date().toISOString() }],
    },
  };
}

// Resta (signo -1) o regresa (signo +1) al inventario las piezas de un pedido. Devuelve los productos tocados.
function moverInventario(catalogo, articulos, signo) {
  const faltantes = [];
  const tocados = new Set();
  for (const a of articulos) {
    const v = catalogo.productos.find((p) => p.id === a.id)?.variantes.find((x) => x.nombre === a.variante);
    if (!v || (typeof v.stock === 'object' && !(a.talla in v.stock))) {
      if (signo < 0) faltantes.push(`${describir(a)} ya no existe en el catálogo`);
      continue; // al cancelar, si el producto ya no existe no hay a dónde regresarlo
    }
    const actual = stockDe(v, a.talla);
    if (signo < 0 && actual < a.cant) {
      faltantes.push(`${describir(a)}: hay ${actual}, el pedido pide ${a.cant}`);
      continue;
    }
    if (typeof v.stock === 'number') v.stock = actual + signo * a.cant;
    else v.stock[a.talla] = actual + signo * a.cant;
    tocados.add(a.id);
  }
  if (faltantes.length) {
    throw Object.assign(new Error(`No hay inventario suficiente. ${faltantes.join('. ')}.`), { estado: 409 });
  }
  return [...tocados];
}

// Los cambios de estado van en fila, para que dos confirmaciones no descuenten el mismo inventario a la vez.
let colaEstados = Promise.resolve();
function cambiarEstadoPedido(id, nuevo) {
  const tarea = colaEstados.then(async () => {
    const pedido = await almacen.leerPedido(id);
    if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { estado: 404 });
    if (!TRANSICIONES[pedido.estado].includes(nuevo)) {
      throw Object.assign(new Error(`Un pedido ${pedido.estado} no puede pasar a ${nuevo}`), { estado: 409 });
    }
    // Confirmar descuenta el inventario; cancelar un pedido ya descontado lo regresa.
    const signo = nuevo === 'confirmado' ? -1 : nuevo === 'cancelado' && pedido.inventarioDescontado ? 1 : 0;
    if (signo) {
      const catalogo = await leerCatalogo();
      const tocados = moverInventario(catalogo, pedido.articulos, signo);
      await guardarCatalogo(catalogo, { productos: tocados });
      pedido.inventarioDescontado = signo < 0;
    }
    pedido.estado = nuevo;
    pedido.historial.push({ estado: nuevo, fecha: new Date().toISOString() });
    await almacen.guardarPedido(pedido);
    return pedido;
  });
  colaEstados = tarea.catch(() => {});
  return tarea;
}

// ---------- Autenticación ----------
const sesiones = new Map(); // token → expira
const intentos = new Map(); // ip → { fallos, hasta }

function hashPassword(password, sal = crypto.randomBytes(16).toString('hex')) {
  return { sal, hash: crypto.scryptSync(password, sal, 64).toString('hex') };
}

const leerAdmin = () => almacen.leerAdmin();

async function passwordCorrecto(password) {
  const admin = await leerAdmin();
  if (!admin || typeof password !== 'string') return false;
  const { hash } = hashPassword(password, admin.sal);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.hash, 'hex'));
}

function crearSesion(req) {
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, Date.now() + DURACION_SESION);
  return `sesion=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_SESION / 1000}${esHttps(req) ? '; Secure' : ''}`;
}

function autenticado(req) {
  const token = leerCookies(req).sesion;
  const expira = token && sesiones.get(token);
  if (!expira) return false;
  if (expira < Date.now()) { sesiones.delete(token); return false; }
  return true;
}

function bloqueado(ip) {
  const r = intentos.get(ip);
  return r && r.hasta > Date.now();
}

function registrarFallo(ip) {
  const r = intentos.get(ip) || { fallos: 0, hasta: 0 };
  r.fallos += 1;
  if (r.fallos >= 5) { r.hasta = Date.now() + 15 * 60 * 1000; r.fallos = 0; }
  intentos.set(ip, r);
}

// Pregunta a Cloudflare si el token del recuadro de verificación es bueno (dura 5 minutos y sirve para un
// solo intento). Devuelve null si la persona pasó, o { estado, mensaje } para responder.
async function revisarVerificacion(token) {
  if (!TURNSTILE) return null;
  const invalida = { estado: 403, mensaje: 'La verificación de seguridad no es válida o ya expiró. Intenta de nuevo.' };
  if (typeof token !== 'string' || !token) return { estado: 403, mensaje: 'Completa la verificación de seguridad e intenta de nuevo.' };
  if (token.length > 2048) return invalida; // Cloudflare no da tokens más largos
  let r = null;
  try {
    const res = await fetch(TURNSTILE.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sin "remoteip" (es opcional): la IP con que el cliente llega a Cloudflare puede no ser la que ve
      // este servidor (IPv6 contra IPv4, proxies del hosting) y no queremos rechazar a nadie por eso.
      body: JSON.stringify({ secret: TURNSTILE.secreto, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    r = await res.json();
  } catch (e) {
    console.error(`No se pudo consultar la verificación de Cloudflare: ${e.message}`);
  }
  const codigos = Array.isArray(r?.['error-codes']) ? r['error-codes'] : [];
  if (!r || codigos.includes('internal-error')) {
    return { estado: 503, mensaje: 'No se pudo comprobar la verificación de seguridad. Intenta de nuevo en un momento.' };
  }
  if (codigos.some((c) => String(c).includes('secret'))) {
    console.error('Cloudflare rechazó TURNSTILE_SECRET_KEY: revisa que sea la clave secreta del mismo widget que TURNSTILE_SITE_KEY.');
    return { estado: 503, mensaje: 'La verificación de seguridad está mal configurada en el servidor (TURNSTILE_SECRET_KEY).' };
  }
  // Con las claves de prueba de Cloudflare la respuesta no trae acción.
  return r.success === true && (!r.action || r.action === ACCION_PANEL) ? null : invalida;
}

// ---------- API ----------
// La verificación anti-bots va antes que la contraseña. Un token inválido cuenta como intento fallido.
async function pasaVerificacion(res, ip, token) {
  const problema = await revisarVerificacion(token);
  if (!problema) return true;
  if (problema.estado === 403) registrarFallo(ip);
  error(res, problema.estado, problema.mensaje);
  return false;
}

async function api(req, res, ruta) {
  const metodo = req.method;
  const ip = ipCliente(req);

  if (metodo === 'GET' && ruta === '/api/catalogo') {
    const catalogo = await leerCatalogo();
    return enviarJSON(res, 200, { ...(autenticado(req) ? catalogo : sinCostos(catalogo)), tienda: TIENDA });
  }

  // Pedido desde la tienda (sin sesión). El servidor recalcula precios y revisa el inventario.
  if (metodo === 'POST' && ruta === '/api/pedidos') {
    if (demasiadosPedidos(ip)) return error(res, 429, 'Hiciste varios pedidos seguidos. Espera unos minutos o escríbenos por WhatsApp.');
    const { pedido, error: msg, estado } = validarPedido(await leerCuerpo(req), await leerCatalogo());
    if (msg) return error(res, estado || 400, msg);
    const creado = await almacen.crearPedido(pedido);
    pedidosPorIp.get(ip).push(Date.now());
    return enviarJSON(res, 201, pedidoParaCliente(creado));
  }

  if (metodo === 'GET' && ruta === '/api/sesion') {
    return enviarJSON(res, 200, {
      autenticado: autenticado(req),
      configurado: !!(await leerAdmin()),
      ...(TURNSTILE && { sitekeyTurnstile: TURNSTILE.sitekey }), // la clave pública; la secreta nunca sale de aquí
    });
  }

  // Primer uso: crear la contraseña del administrador (solo si aún no existe).
  if (metodo === 'POST' && ruta === '/api/configurar') {
    if (await leerAdmin()) return error(res, 409, 'La contraseña ya fue configurada');
    if (bloqueado(ip)) return error(res, 429, 'Demasiados intentos. Espera 15 minutos.');
    const { password, tokenTurnstile } = await leerCuerpo(req);
    if (typeof password !== 'string' || password.length < 8) return error(res, 400, 'La contraseña debe tener al menos 8 caracteres');
    if (!(await pasaVerificacion(res, ip, tokenTurnstile))) return;
    await almacen.crearAdmin(hashPassword(password));
    return enviarJSON(res, 200, { ok: true }, { 'Set-Cookie': crearSesion(req) });
  }

  if (metodo === 'POST' && ruta === '/api/login') {
    if (bloqueado(ip)) return error(res, 429, 'Demasiados intentos. Espera 15 minutos.');
    const { password, tokenTurnstile } = await leerCuerpo(req);
    if (!(await pasaVerificacion(res, ip, tokenTurnstile))) return;
    if (!(await passwordCorrecto(password))) {
      registrarFallo(ip);
      return error(res, 401, 'Contraseña incorrecta');
    }
    intentos.delete(ip);
    return enviarJSON(res, 200, { ok: true }, { 'Set-Cookie': crearSesion(req) });
  }

  if (metodo === 'POST' && ruta === '/api/logout') {
    sesiones.delete(leerCookies(req).sesion);
    return enviarJSON(res, 200, { ok: true }, { 'Set-Cookie': 'sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // ----- A partir de aquí todo requiere sesión -----
  if (!autenticado(req)) return error(res, 401, 'Inicia sesión para continuar');

  if (metodo === 'POST' && ruta === '/api/cambiar-password') {
    const { actual, nueva } = await leerCuerpo(req);
    if (!(await passwordCorrecto(actual))) return error(res, 400, 'La contraseña actual no es correcta');
    if (typeof nueva !== 'string' || nueva.length < 8) return error(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres');
    await almacen.guardarAdmin(hashPassword(nueva));
    sesiones.clear(); // cierra todas las sesiones abiertas
    return enviarJSON(res, 200, { ok: true }, { 'Set-Cookie': crearSesion(req) });
  }

  if (metodo === 'POST' && ruta === '/api/productos') {
    const catalogo = await leerCatalogo();
    const datos = await leerCuerpo(req);
    const base = slug(texto(datos.nombre, 120)) || 'producto';
    let id = base;
    for (let n = 2; catalogo.productos.some((p) => p.id === id); n++) id = `${base}-${n}`;
    const { producto, error: msg } = validarProducto({ ...datos, id }, catalogo);
    if (msg) return error(res, 400, msg);
    catalogo.productos.push(producto);
    await guardarCatalogo(catalogo, { productos: [id] });
    return enviarJSON(res, 201, producto);
  }

  const coincide = ruta.match(/^\/api\/productos\/([a-z0-9-]+)$/);
  if (coincide && (metodo === 'PUT' || metodo === 'DELETE')) {
    const catalogo = await leerCatalogo();
    const i = catalogo.productos.findIndex((p) => p.id === coincide[1]);
    if (i === -1) return error(res, 404, 'Producto no encontrado');

    if (metodo === 'DELETE') {
      const [eliminado] = catalogo.productos.splice(i, 1);
      const apuntaban = catalogo.productos.filter((p) => (p.relacionados || []).includes(eliminado.id));
      apuntaban.forEach((p) => { p.relacionados = p.relacionados.filter((r) => r !== eliminado.id); });
      await guardarCatalogo(catalogo, { productos: apuntaban.map((p) => p.id), borrarProductos: [eliminado.id] });
      limpiarImagenes(catalogo);
      return enviarJSON(res, 200, { ok: true });
    }

    const { producto, error: msg } = validarProducto({ ...(await leerCuerpo(req)), id: coincide[1] }, catalogo);
    if (msg) return error(res, 400, msg);
    catalogo.productos[i] = producto;
    await guardarCatalogo(catalogo, { productos: [producto.id] });
    limpiarImagenes(catalogo);
    return enviarJSON(res, 200, producto);
  }

  // ----- Categorías -----
  if (metodo === 'POST' && ruta === '/api/categorias') {
    const catalogo = await leerCatalogo();
    const datos = await leerCuerpo(req);
    const base = slug(texto(datos.nombre, 40)) || 'categoria';
    let id = base;
    for (let n = 2; catalogo.categorias.some((c) => c.id === id); n++) id = `${base}-${n}`;
    const { categoria, error: msg } = validarCategoria({ ...datos, id });
    if (msg) return error(res, 400, msg);
    catalogo.categorias.push(categoria);
    await guardarCatalogo(catalogo, { categorias: true });
    return enviarJSON(res, 201, categoria);
  }

  if (metodo === 'POST' && ruta === '/api/categorias/orden') {
    const catalogo = await leerCatalogo();
    const { ids } = await leerCuerpo(req);
    const actuales = catalogo.categorias.map((c) => c.id);
    if (!Array.isArray(ids) || ids.length !== actuales.length || [...ids].sort().join() !== [...actuales].sort().join()) {
      return error(res, 400, 'El orden enviado no coincide con las categorías actuales');
    }
    catalogo.categorias = ids.map((id) => catalogo.categorias.find((c) => c.id === id));
    await guardarCatalogo(catalogo, { categorias: true });
    return enviarJSON(res, 200, { ok: true });
  }

  const coincideCat = ruta.match(/^\/api\/categorias\/([a-z0-9-]+)$/);
  if (coincideCat && (metodo === 'PUT' || metodo === 'DELETE')) {
    const catalogo = await leerCatalogo();
    const i = catalogo.categorias.findIndex((c) => c.id === coincideCat[1]);
    if (i === -1) return error(res, 404, 'Categoría no encontrada');

    if (metodo === 'DELETE') {
      const enUso = catalogo.productos.filter((p) => p.categoria === coincideCat[1]).length;
      if (enUso) return error(res, 409, `Esta categoría tiene ${enUso} producto(s). Muévelos a otra categoría antes de eliminarla.`);
      if (catalogo.categorias.length === 1) return error(res, 409, 'La tienda necesita al menos una categoría');
      catalogo.categorias.splice(i, 1);
      await guardarCatalogo(catalogo, { categorias: true, borrarCategorias: [coincideCat[1]] });
      return enviarJSON(res, 200, { ok: true });
    }

    const { categoria, error: msg } = validarCategoria({ ...(await leerCuerpo(req)), id: coincideCat[1] });
    if (msg) return error(res, 400, msg);
    catalogo.categorias[i] = categoria;
    await guardarCatalogo(catalogo, { categorias: true });
    return enviarJSON(res, 200, categoria);
  }

  // ----- Pedidos -----
  if (metodo === 'GET' && ruta === '/api/pedidos') {
    // ?todos=1 trae el historial completo (lo usa el tablero); sin él, los 500 más recientes.
    const todos = new URL(req.url, 'http://localhost').searchParams.get('todos') === '1';
    return enviarJSON(res, 200, await almacen.listarPedidos({ todos }));
  }

  const coincidePedido = ruta.match(/^\/api\/pedidos\/(\d+)\/estado$/);
  if (coincidePedido && metodo === 'POST') {
    const { estado } = await leerCuerpo(req);
    if (!(estado in TRANSICIONES)) return error(res, 400, 'Estado inválido');
    return enviarJSON(res, 200, await cambiarEstadoPedido(Number(coincidePedido[1]), estado));
  }

  if (metodo === 'POST' && ruta === '/api/imagenes') {
    const { datos } = await leerCuerpo(req);
    const m = typeof datos === 'string' && datos.match(/^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=]+)$/i);
    if (!m) return error(res, 400, 'Formato no permitido. Usa JPG, PNG o WEBP.');
    const binario = Buffer.from(m[2], 'base64');
    if (binario.length > MAX_IMAGEN) return error(res, 413, 'La imagen pesa más de 5 MB');
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[m[1].toLowerCase()];
    const nombre = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await almacen.guardarImagen(nombre, binario);
    return enviarJSON(res, 201, { ruta: `img/productos/${nombre}` });
  }

  return error(res, 404, 'Ruta no encontrada');
}

// ---------- Archivos estáticos ----------
async function estatico(req, res, ruta) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
  ruta = ALIAS[ruta] || ruta;
  if (ruta.endsWith('/')) ruta += 'index.html';

  // Las fotos subidas viven en Supabase o en la carpeta de datos (persistente), no en public/.
  let base = PUBLICO;
  if (ruta.startsWith('/img/productos/')) {
    const destino = almacen.urlImagen(path.basename(ruta));
    if (destino) {
      res.writeHead(301, { Location: destino, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end();
    }
    base = CARPETA_IMAGENES;
    ruta = ruta.slice('/img/productos'.length);
  }
  const archivo = path.normalize(path.join(base, ruta));
  if (!archivo.startsWith(base + path.sep)) return error(res, 403, 'Prohibido');
  try {
    const info = await fsp.stat(archivo);
    if (!info.isFile()) throw new Error();
    res.writeHead(200, {
      'Content-Type': TIPOS_MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      ...SEGURIDAD,
      // El recuadro de Cloudflare revisa desde qué sitio se abre: el panel le manda solo el origen, nunca la ruta.
      ...(TURNSTILE && ruta === '/admin.html' && { 'Referrer-Policy': 'strict-origin-when-cross-origin' }),
      // Las fotos tienen nombre único, así que el navegador puede guardarlas mucho tiempo.
      'Cache-Control': base === CARPETA_IMAGENES ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(archivo).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página no encontrada');
  }
}

// ---------- Páginas de la tienda ----------
// La tienda es una sola página (index.html), pero cada producto tiene su propia dirección: /producto/<id>.
// El servidor llena título, descripción y foto en el HTML, porque WhatsApp, Facebook y Google
// leen esos datos sin ejecutar JavaScript.
const attr = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (datos) => `<script type="application/ld+json">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>`;
const dinero = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const recortar = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// Dirección pública del sitio (para enlaces absolutos). En el hosting conviene fijarla con SITIO_URL.
function origen(req) {
  if (process.env.SITIO_URL) return process.env.SITIO_URL.replace(/\/+$/, '');
  const host = /^[a-z0-9.-]+(:\d+)?$/i.test(req.headers.host || '') ? req.headers.host : `localhost:${PUERTO}`;
  return `${esHttps(req) ? 'https' : 'http'}://${host}`;
}

const urlFoto = (base, ruta) => almacen.urlImagen(path.basename(ruta)) || `${base}/${ruta}`;

const datosNegocio = (base) => ({
  '@context': 'https://schema.org',
  '@type': 'ShoeStore',
  name: TIENDA.nombre,
  url: `${base}/`,
  image: `${base}/img/compartir.png`,
  telephone: `+52 ${TIENDA.telefono}`,
  address: {
    '@type': 'PostalAddress',
    streetAddress: `${TIENDA.calle}, ${TIENDA.colonia}`,
    addressLocality: TIENDA.municipio,
    addressRegion: TIENDA.estado,
    postalCode: TIENDA.cp,
    addressCountry: 'MX',
  },
  openingHoursSpecification: [{
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: TIENDA.abre,
    closes: TIENDA.cierra,
  }],
});

async function paginaTienda(req, res, idProducto) {
  let html = await fsp.readFile(path.join(PUBLICO, 'index.html'), 'utf8');
  const base = origen(req);
  let estado = 200;
  let titulo = html.match(/<title>([^<]*)<\/title>/)[1];
  let descripcion = html.match(/<meta name="description" content="([^"]*)"/)[1];
  let url = `${base}/`;
  let imagen = `${base}/img/compartir.png`;
  const extra = [];
  let datos = datosNegocio(base);

  if (idProducto) {
    const p = (await leerCatalogo()).productos.find((x) => x.id === idProducto);
    if (!p) {
      estado = 404;
      titulo = `Producto no disponible | ${TIENDA.nombre}`;
      extra.push('<meta name="robots" content="noindex">');
      datos = null;
    } else {
      const precio = precioVariante(p, p.variantes[0]);
      const conFoto = p.variantes.find((v) => v.imagen);
      const hay = p.variantes.some((v) => (typeof v.stock === 'number' ? v.stock : Object.values(v.stock).some(Boolean)));
      titulo = `${p.nombre} | ${TIENDA.nombre}`;
      descripcion = recortar(`${dinero(precio)} · ${p.descripcion || `${p.sub} ${p.marca}`}`, 160);
      url = `${base}/producto/${p.id}`;
      if (conFoto) imagen = urlFoto(base, conFoto.imagen);
      extra.push(
        `<meta property="product:price:amount" content="${precio}">`,
        '<meta property="product:price:currency" content="MXN">'
      );
      datos = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.nombre,
        description: p.descripcion,
        sku: p.id,
        category: p.sub,
        ...(p.marca && { brand: { '@type': 'Brand', name: p.marca } }),
        image: [imagen],
        offers: {
          '@type': 'Offer',
          url,
          price: precio,
          priceCurrency: 'MXN',
          availability: `https://schema.org/${hay ? 'InStock' : 'OutOfStock'}`,
          seller: { '@type': 'Organization', name: TIENDA.nombre },
        },
      };
    }
  }

  const meta = [
    `<link rel="canonical" href="${attr(url)}">`,
    `<meta property="og:site_name" content="${attr(TIENDA.nombre)}">`,
    `<meta property="og:locale" content="es_MX">`,
    `<meta property="og:type" content="${idProducto && datos ? 'product' : 'website'}">`,
    `<meta property="og:title" content="${attr(titulo)}">`,
    `<meta property="og:description" content="${attr(descripcion)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:image" content="${attr(imagen)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    ...extra,
    ...(datos ? [jsonLd(datos)] : []),
  ].join('\n  ');

  // Reemplazos con función: los precios llevan "$", que en un texto de reemplazo tiene significado especial.
  html = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${attr(titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, inicio) => inicio + attr(descripcion))
    .replace('<!--META-->', () => meta)
    .replace('<body>', () => `<body data-vista="${idProducto ? 'producto' : 'catalogo'}">`);
  res.writeHead(estado, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEGURIDAD });
  res.end(req.method === 'HEAD' ? undefined : html);
}

async function mapaDelSitio(req, res) {
  const base = origen(req);
  const urls = [`${base}/`, ...(await leerCatalogo()).productos.map((p) => `${base}/producto/${p.id}`)];
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${attr(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
}

function robots(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origen(req)}/sitemap.xml\n`);
}

const servidor = http.createServer(async (req, res) => {
  let ruta;
  try { ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return error(res, 400, 'URL inválida'); }
  try {
    const lectura = req.method === 'GET' || req.method === 'HEAD';
    const producto = ruta.match(/^\/producto\/([a-z0-9-]+)\/?$/);
    if (ruta.startsWith('/api/')) await api(req, res, ruta);
    else if (lectura && (ruta === '/' || ruta === '/index.html')) await paginaTienda(req, res, null);
    else if (lectura && producto) await paginaTienda(req, res, producto[1]);
    else if (lectura && ruta === '/sitemap.xml') await mapaDelSitio(req, res);
    else if (lectura && ruta === '/robots.txt') robots(req, res);
    else await estatico(req, res, ruta);
  } catch (e) {
    if (!e.estado) console.error(e);
    if (!res.headersSent) error(res, e.estado || 500, e.estado ? e.message : 'Error interno del servidor');
  }
});

// Dice al arrancar si el panel pide la verificación de Cloudflare, para detectar claves mal puestas.
function avisarVerificacion() {
  if (!TURNSTILE) {
    if (process.env.TURNSTILE_SITE_KEY || process.env.TURNSTILE_SECRET_KEY) {
      console.warn('Falta TURNSTILE_SITE_KEY o TURNSTILE_SECRET_KEY: el panel pide solo la contraseña.');
    }
    return;
  }
  const dePrueba = [TURNSTILE.sitekey, TURNSTILE.secreto].filter(esClaveDePrueba).length;
  if (dePrueba === 2) console.log('Verificación anti-bots con las claves de PRUEBA de Cloudflare: siempre pasa, no protege el sitio publicado.');
  else if (dePrueba === 1) console.warn('Verificación anti-bots: mezclaste una clave de prueba con una real, así no vas a poder entrar al panel. Revisa TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY.');
  else console.log('Verificación anti-bots de Cloudflare activa al entrar al panel.');
}

almacen.preparar()
  .then(async () => {
    await limpiarImagenes(await leerCatalogo());
    servidor.listen(PUERTO, () => {
      const { port } = servidor.address();
      console.log(`Zapatería Brazil lista en http://localhost:${port} (datos en ${almacen.modo === 'supabase' ? 'Supabase' : DATOS})`);
      console.log(`Panel de administración: http://localhost:${port}/admin`);
      avisarVerificacion();
    });
  })
  .catch((e) => {
    console.error(`No se pudo iniciar: ${e.message}`);
    process.exitCode = 1; // sin process.exit(): en Windows choca con las conexiones abiertas de fetch
  });
