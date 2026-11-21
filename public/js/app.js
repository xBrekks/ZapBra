'use strict';

// ---------- Utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const dinero = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const normalizar = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// El catálogo y los datos de la tienda se cargan del servidor al iniciar (ver "Inicio").
let CATEGORIAS = [];
let PRODUCTOS = [];
let TIENDA = null; // WhatsApp, dirección, horario y costos de envío
const ORDEN_TALLAS_ROPA = ['XCH', 'CH', 'M', 'G', 'XG'];
const TITULO_INICIO = document.title;

const buscarProducto = (id) => PRODUCTOS.find((p) => p.id === id);
const urlProducto = (p) => `/producto/${p.id}`;

// Precio de una variante: algunas presentaciones (ej. 300 ml) tienen precio propio.
const precioDe = (p, v) => (v && v.precio != null ? v.precio : p.precioOferta ?? p.precio);
const precioAntesDe = (p, v) => (v && v.precio != null ? null : p.precioOferta ? p.precio : null);

const stockDe = (v, talla) => (typeof v.stock === 'number' ? v.stock : v.stock[talla] || 0);
const stockVariante = (v) =>
  typeof v.stock === 'number' ? v.stock : Object.values(v.stock).reduce((a, b) => a + b, 0);
const stockTotal = (p) => p.variantes.reduce((a, v) => a + stockVariante(v), 0);

const ordenTallas = (a, b) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return ORDEN_TALLAS_ROPA.indexOf(a) - ORDEN_TALLAS_ROPA.indexOf(b);
};

function imagen(p, v) {
  return v.imagen
    ? `<img src="/${v.imagen}" alt="${p.nombre} color ${v.nombre}" loading="lazy">`
    : figura(p.tipo, v.hex);
}

const enlaceWhatsApp = (mensaje, numero = TIENDA.whatsapp) =>
  `https://wa.me/${numero}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;

// ---------- Estado ----------
const filtrosIniciales = () => ({
  subs: new Set(),
  talla: null,
  color: null,
  soloOfertas: false,
  precioMax: null,
});

const estado = {
  categoria: 'todos',
  busqueda: '',
  orden: 'relevancia',
  ...filtrosIniciales(),
};

// ---------- Vistas y direcciones ----------
// La tienda es una sola página: "/" muestra el catálogo y "/producto/<id>" la página de un producto.
let posicionCatalogo = 0; // para volver al mismo lugar de la lista
let navegoDentro = false; // si el visitante ya navegó dentro de la tienda, "Volver" usa el historial
history.scrollRestoration = 'manual';

const idEnRuta = () => location.pathname.match(/^\/producto\/([a-z0-9-]+)\/?$/)?.[1] || null;

function navegar(url, datos = {}) {
  if (!idEnRuta()) posicionCatalogo = scrollY;
  history.pushState(datos, '', url);
  navegoDentro = true;
  aplicarRuta();
}

function aplicarRuta() {
  const id = idEnRuta();
  if (id) mostrarProducto(id, history.state?.vi || 0);
  else mostrarCatalogo();
}

function mostrarCatalogo() {
  document.body.dataset.vista = 'catalogo';
  document.title = TITULO_INICIO;
  renderCatalogo();
  scrollTo(0, posicionCatalogo);
  if (location.hash === '#visitanos') $('#visitanos').scrollIntoView();
}

function mostrarProducto(id, vi = 0) {
  document.body.dataset.vista = 'producto';
  renderNav();
  const p = buscarProducto(id);
  if (!p) {
    detalle = null;
    document.title = `Producto no disponible | ${TIENDA.nombre}`;
    $('#detalle-producto').innerHTML = `
      <div class="vacio">
        <h1>Este producto ya no está disponible</h1>
        <p>Puede que se haya agotado o que el enlace haya cambiado.</p>
        <a class="btn btn-verde" href="/" data-categoria="todos">Ver todo el catálogo</a>
      </div>`;
  } else {
    detalle = { p, vi: Math.min(vi, p.variantes.length - 1), talla: null, cant: 1 };
    document.title = `${p.nombre} | ${TIENDA.nombre}`;
    renderDetalle();
  }
  scrollTo(0, 0);
}

// ---------- Catálogo ----------
function productosDeCategoria() {
  return PRODUCTOS.filter((p) => estado.categoria === 'todos' || p.categoria === estado.categoria);
}

function productosFiltrados() {
  const q = normalizar(estado.busqueda.trim());
  const lista = productosDeCategoria().filter((p) => {
    if (estado.subs.size && !estado.subs.has(p.sub)) return false;
    if (estado.talla && !(p.tallas?.includes(estado.talla) && p.variantes.some((v) => stockDe(v, estado.talla) > 0))) return false;
    if (estado.color && !p.variantes.some((v) => v.nombre === estado.color)) return false;
    if (estado.soloOfertas && !p.precioOferta) return false;
    if (estado.precioMax != null && precioDe(p, p.variantes[0]) > estado.precioMax) return false;
    if (q) {
      const texto = [p.nombre, p.marca, p.sub, p.material, p.descripcion, ...p.variantes.map((v) => v.nombre)].join(' ');
      if (!normalizar(texto).includes(q)) return false;
    }
    return true;
  });

  const precio = (p) => precioDe(p, p.variantes[0]);
  const ordenes = {
    'precio-asc': (a, b) => precio(a) - precio(b),
    'precio-desc': (a, b) => precio(b) - precio(a),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  };
  if (ordenes[estado.orden]) lista.sort(ordenes[estado.orden]);
  // Agotados al final
  return lista.sort((a, b) => (stockTotal(a) > 0 ? 0 : 1) - (stockTotal(b) > 0 ? 0 : 1));
}

function renderNav() {
  const enCatalogo = document.body.dataset.vista === 'catalogo';
  const items = [{ id: 'todos', nombre: 'Todo' }, ...CATEGORIAS];
  $('#nav-categorias').innerHTML = items
    .map((c) => {
      const activo = enCatalogo && estado.categoria === c.id;
      return `<button data-categoria="${c.id}" class="${activo ? 'activo' : ''}" ${activo ? 'aria-current="true"' : ''}>${c.nombre}</button>`;
    })
    .join('') + '<a href="/#visitanos" class="nav-extra" data-visitanos>Visítanos</a>';
}

function renderGridCategorias() {
  $('#grid-categorias').innerHTML = CATEGORIAS.map((c) => {
    const total = PRODUCTOS.filter((p) => p.categoria === c.id).length;
    return `
      <button class="tarjeta-categoria" data-categoria="${c.id}">
        <span class="tarjeta-categoria-img">${figura(c.tipo, c.hex)}</span>
        <span class="tarjeta-categoria-nombre">${c.nombre}</span>
        <span class="texto-suave">${c.desc} · ${total} productos</span>
      </button>`;
  }).join('');
}

function renderFiltros() {
  const base = productosDeCategoria();
  const subs = [...new Set(base.map((p) => p.sub))];
  const tallas = [...new Set(base.flatMap((p) => p.tallas || []))].sort(ordenTallas);
  const colores = new Map();
  base.filter((p) => p.etiquetaVariante === 'Color')
    .forEach((p) => p.variantes.forEach((v) => colores.set(v.nombre, v.hex)));
  const maxPrecio = Math.max(...base.map((p) => precioDe(p, p.variantes[0])));
  const tope = estado.precioMax ?? maxPrecio;

  $('#filtros').innerHTML = `
    <div class="filtro">
      <h3>Tipo</h3>
      ${subs.map((s) => `
        <label class="check"><input type="checkbox" data-sub="${s}" ${estado.subs.has(s) ? 'checked' : ''}> ${s}</label>`).join('')}
    </div>
    ${tallas.length ? `
    <div class="filtro">
      <h3>Talla <button class="enlace" data-guia>Guía de tallas</button></h3>
      <div class="chips">
        ${tallas.map((t) => `<button class="chip ${estado.talla === t ? 'activo' : ''}" data-filtro-talla="${t}" aria-pressed="${estado.talla === t}">${t}</button>`).join('')}
      </div>
    </div>` : ''}
    ${colores.size ? `
    <div class="filtro">
      <h3>Color ${estado.color ? `<span class="texto-suave">· ${estado.color}</span>` : ''}</h3>
      <div class="swatches">
        ${[...colores].map(([n, hex]) => `<button class="swatch ${estado.color === n ? 'activo' : ''}" style="--c:${hex}" data-filtro-color="${n}" title="${n}" aria-label="Color ${n}" aria-pressed="${estado.color === n}"></button>`).join('')}
      </div>
    </div>` : ''}
    <div class="filtro">
      <h3>Precio máximo: <span id="valor-precio">${dinero(tope)}</span></h3>
      <input type="range" id="filtro-precio" min="0" max="${maxPrecio}" step="10" value="${tope}" aria-label="Precio máximo">
    </div>
    <div class="filtro">
      <label class="check"><input type="checkbox" id="solo-ofertas" ${estado.soloOfertas ? 'checked' : ''}> Solo ofertas</label>
    </div>
    <button class="btn btn-claro btn-bloque" id="limpiar-filtros">Limpiar filtros</button>`;
}

function badges(p) {
  const out = [];
  if (stockTotal(p) === 0) out.push('<span class="badge badge-agotado">Agotado</span>');
  else if (p.precioOferta) out.push(`<span class="badge badge-oferta">-${Math.round((1 - p.precioOferta / p.precio) * 100)}%</span>`);
  if (p.nuevo) out.push('<span class="badge badge-nuevo">Nuevo</span>');
  return out.length ? `<span class="badges">${out.join('')}</span>` : '';
}

function htmlPrecio(p, v) {
  const antes = precioAntesDe(p, v);
  return `<span class="precio-actual">${dinero(precioDe(p, v))}</span>${antes ? ` <s class="precio-antes">${dinero(antes)}</s>` : ''}`;
}

// Las tarjetas son enlaces reales a /producto/<id>: se pueden abrir en otra pestaña y Google las sigue.
function tarjetaProducto(p) {
  const v = p.variantes[0];
  const conColor = p.etiquetaVariante === 'Color' && p.variantes.length > 1;
  return `
    <article class="tarjeta ${stockTotal(p) === 0 ? 'agotado' : ''}" data-id="${p.id}" data-vi="0">
      <a class="tarjeta-img" href="${urlProducto(p)}" data-abrir="${p.id}" aria-label="Ver ${p.nombre}">
        ${imagen(p, v)}${badges(p)}
      </a>
      <div class="tarjeta-cuerpo">
        <p class="tarjeta-meta">${p.marca} · ${p.sub}</p>
        <h3><a class="tarjeta-nombre" href="${urlProducto(p)}" data-abrir="${p.id}">${p.nombre}</a></h3>
        ${conColor ? `
        <div class="swatches swatches-chicos">
          ${p.variantes.map((vv, i) => `<button class="swatch ${i === 0 ? 'activo' : ''}" style="--c:${vv.hex}" data-tarjeta-variante="${i}" title="${vv.nombre}" aria-label="Ver en ${vv.nombre}"></button>`).join('')}
        </div>` : `<p class="texto-suave tarjeta-variantes">${p.variantes.map((vv) => vv.nombre).join(' · ')}</p>`}
        <p class="precio">${htmlPrecio(p, v)}</p>
      </div>
    </article>`;
}

function renderProductos() {
  const lista = productosFiltrados();
  const cat = CATEGORIAS.find((c) => c.id === estado.categoria);
  $('#titulo-catalogo').textContent = estado.busqueda.trim()
    ? `Resultados para “${estado.busqueda.trim()}”`
    : cat ? cat.nombre : 'Todos los productos';
  $('#conteo-resultados').textContent = `${lista.length} ${lista.length === 1 ? 'producto' : 'productos'}`;
  $('#grid-productos').innerHTML = lista.length
    ? lista.map(tarjetaProducto).join('')
    : `<div class="vacio"><p>No encontramos productos con esos filtros.</p><button class="btn btn-verde" id="limpiar-filtros-vacio">Limpiar filtros</button></div>`;

  const inicio = estado.categoria === 'todos' && !estado.busqueda.trim();
  $('#hero').hidden = !inicio;
  $('#seccion-categorias').hidden = !inicio;
}

function renderCatalogo() {
  renderNav();
  renderFiltros();
  renderProductos();
}

// Desde la página de un producto, elegir una categoría o buscar regresa al catálogo.
function irAlCatalogo() {
  if (!idEnRuta()) return;
  history.pushState({}, '', '/');
  navegoDentro = true;
  document.body.dataset.vista = 'catalogo';
  document.title = TITULO_INICIO;
}

function cambiarCategoria(id) {
  irAlCatalogo();
  Object.assign(estado, filtrosIniciales(), { categoria: id });
  if (id === 'todos') {
    estado.busqueda = '';
    $('#busqueda').value = '';
  }
  renderCatalogo();
  if (id !== 'todos') $('#catalogo').scrollIntoView({ behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Página de producto ----------
let detalle = null; // { p, vi, talla, cant }

function disponibleDetalle() {
  const { p, vi, talla } = detalle;
  const v = p.variantes[vi];
  if (p.tallas && !talla) return 0;
  const enCarrito = carrito.find((i) => i.key === claveItem(p.id, v.nombre, talla))?.cant || 0;
  return Math.max(0, stockDe(v, talla) - enCarrito);
}

function renderDetalle() {
  const { p, vi, talla, cant } = detalle;
  const v = p.variantes[vi];
  const esColor = p.etiquetaVariante === 'Color';
  const disponible = disponibleDetalle();
  const sinStock = p.tallas ? stockVariante(v) === 0 : v.stock === 0;
  const cat = CATEGORIAS.find((c) => c.id === p.categoria);

  let mensajeStock = '';
  if (sinStock) mensajeStock = `<p class="stock stock-agotado">${esColor ? 'Este color está agotado' : 'Agotado'}</p>`;
  else if (p.tallas && !talla) mensajeStock = '<p class="stock">Elige tu talla</p>';
  else {
    const s = stockDe(v, talla);
    mensajeStock = s <= 3
      ? `<p class="stock stock-bajo">¡Quedan solo ${s}!</p>`
      : '<p class="stock stock-ok">Disponible</p>';
  }

  const relacionados = (p.relacionados || []).map(buscarProducto).filter(Boolean);
  const pregunta = `¡Hola, Zapatería Brazil! Me interesa este producto: ${p.nombre} (${v.nombre}${talla ? `, talla ${talla}` : ''}). ${location.origin}${urlProducto(p)}`;

  $('#detalle-producto').innerHTML = `
    <nav class="migas" aria-label="Estás en">
      <button class="enlace" data-volver>← Volver</button>
      <span class="migas-ruta">
        <a href="/" data-categoria="todos">Inicio</a> ›
        ${cat ? `<a href="/" data-categoria="${cat.id}">${cat.nombre}</a> ›` : ''}
        <span aria-current="page">${p.nombre}</span>
      </span>
    </nav>
    <div class="detalle">
      <div class="detalle-img">${imagen(p, v)}${badges(p)}</div>
      <div class="detalle-info">
        <p class="tarjeta-meta">${p.marca} · ${p.sub}</p>
        <h1>${p.nombre}</h1>
        <p class="precio precio-grande">${htmlPrecio(p, v)}</p>
        <p>${p.descripcion}</p>
        <dl class="ficha">
          <dt>Material</dt><dd>${p.material}</dd>
          ${p.calce ? `<dt>Calce</dt><dd>${p.calce}</dd>` : ''}
        </dl>

        <div class="opcion">
          <p class="opcion-titulo">${p.etiquetaVariante}: <strong>${v.nombre}</strong></p>
          ${esColor ? `
          <div class="swatches">
            ${p.variantes.map((vv, i) => `<button class="swatch ${i === vi ? 'activo' : ''} ${stockVariante(vv) === 0 ? 'tachado' : ''}" style="--c:${vv.hex}" data-detalle-variante="${i}" title="${vv.nombre}" aria-label="${vv.nombre}" aria-pressed="${i === vi}"></button>`).join('')}
          </div>` : `
          <div class="chips">
            ${p.variantes.map((vv, i) => `<button class="chip ${i === vi ? 'activo' : ''}" data-detalle-variante="${i}" aria-pressed="${i === vi}" ${stockVariante(vv) === 0 ? 'disabled' : ''}>${vv.nombre}${vv.precio != null ? ` · ${dinero(vv.precio)}` : ''}</button>`).join('')}
          </div>`}
        </div>

        ${p.tallas ? `
        <div class="opcion">
          <p class="opcion-titulo">Talla${/^\d/.test(p.tallas[0]) ? ' (MX)' : ''}: <strong>${talla || '—'}</strong>
            <button class="enlace" data-guia>Guía de tallas</button></p>
          <div class="chips">
            ${p.tallas.map((t) => `<button class="chip ${talla === t ? 'activo' : ''}" data-detalle-talla="${t}" aria-pressed="${talla === t}" ${stockDe(v, t) === 0 ? 'disabled title="Agotada"' : ''}>${t}</button>`).join('')}
          </div>
        </div>` : ''}

        ${mensajeStock}

        <div class="comprar">
          <div class="cantidad" aria-label="Cantidad">
            <button data-detalle-cant="-1" aria-label="Menos" ${cant <= 1 ? 'disabled' : ''}>−</button>
            <span>${cant}</span>
            <button data-detalle-cant="1" aria-label="Más" ${cant >= disponible ? 'disabled' : ''}>+</button>
          </div>
          <button class="btn btn-verde btn-agregar" id="agregar-carrito" ${disponible < 1 ? 'disabled' : ''}>
            ${p.tallas && !talla ? 'Elige una talla' : disponible < 1 && !sinStock ? 'Ya tienes todo el stock' : 'Agregar al carrito'}
          </button>
        </div>

        <p class="nota-tienda">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>
          <span><strong>Recógelo gratis en tienda</strong> · ${TIENDA.colonia}, ${TIENDA.municipio}. ${TIENDA.horario}.</span>
        </p>

        <div class="compartir">
          <button class="btn btn-claro btn-chico" id="compartir">Compartir</button>
          <a class="btn btn-claro btn-chico" href="${enlaceWhatsApp(pregunta)}" target="_blank" rel="noopener">Preguntar por WhatsApp</a>
        </div>

        ${relacionados.length ? `
        <div class="relacionados">
          <h2>Complementa tu compra</h2>
          ${relacionados.map((r) => `
            <a class="relacionado" href="${urlProducto(r)}" data-abrir="${r.id}">
              <span class="relacionado-img">${imagen(r, r.variantes[0])}</span>
              <span><span class="relacionado-nombre">${r.nombre}</span><span class="texto-suave">${dinero(precioDe(r, r.variantes[0]))}</span></span>
            </a>`).join('')}
        </div>` : ''}
      </div>
    </div>`;
}

async function compartirProducto() {
  const { p } = detalle;
  const url = location.origin + urlProducto(p);
  if (navigator.share) {
    try { await navigator.share({ title: p.nombre, text: `${p.nombre} en Zapatería Brazil`, url }); } catch { /* cancelado */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado. Pégalo donde quieras compartirlo.');
  } catch {
    toast(url);
  }
}

// ---------- Carrito ----------
const CLAVE_CARRITO = 'zapateria-brazil-carrito';
const CLAVE_ENTREGA = 'zapateria-brazil-entrega';
const CLAVE_CLIENTE = 'zapateria-brazil-cliente';
const claveItem = (id, variante, talla) => `${id}|${variante}|${talla || ''}`;

const leerLocal = (clave, otro) => {
  try { return JSON.parse(localStorage.getItem(clave)) ?? otro; } catch { return otro; }
};
const guardarLocal = (clave, valor) => {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
};

function cargarCarrito() {
  const datos = leerLocal(CLAVE_CARRITO, []);
  // Descarta productos o variantes que ya no existan en el catálogo
  return Array.isArray(datos) ? datos.filter((i) => buscarProducto(i.id)?.variantes.some((v) => v.nombre === i.variante)) : [];
}

let carrito = [];
let entrega = leerLocal(CLAVE_ENTREGA, 'envio') === 'tienda' ? 'tienda' : 'envio';
let pasoCarrito = 'carrito'; // 'carrito' → 'datos' → 'listo'
let ultimoPedido = null;

const guardarCarrito = () => guardarLocal(CLAVE_CARRITO, carrito);

function datosItem(item) {
  const p = buscarProducto(item.id);
  const v = p.variantes.find((x) => x.nombre === item.variante);
  return { p, v, precio: precioDe(p, v), max: stockDe(v, item.talla) };
}

function totales() {
  const subtotal = carrito.reduce((a, i) => a + datosItem(i).precio * i.cant, 0);
  const envio = subtotal === 0 || entrega === 'tienda' || subtotal >= TIENDA.envioGratisDesde ? 0 : TIENDA.costoEnvio;
  return { subtotal, envio, total: subtotal + envio, piezas: carrito.reduce((a, i) => a + i.cant, 0) };
}

function agregarAlCarrito() {
  const { p, vi, talla, cant } = detalle;
  const v = p.variantes[vi];
  const key = claveItem(p.id, v.nombre, talla);
  const existente = carrito.find((i) => i.key === key);
  if (existente) existente.cant += cant;
  else carrito.push({ key, id: p.id, variante: v.nombre, talla, cant });
  guardarCarrito();
  pasoCarrito = 'carrito';
  renderCarrito();
  detalle.cant = 1;
  renderDetalle();
  toast(`${p.nombre} agregado al carrito`);
}

const htmlTotales = ({ subtotal, envio, total }) => `
  <dl class="totales">
    <dt>Subtotal</dt><dd>${dinero(subtotal)}</dd>
    <dt>${entrega === 'tienda' ? 'Recoger en tienda' : 'Envío'}</dt><dd>${envio ? dinero(envio) : 'Gratis'}</dd>
    <dt class="total">Total</dt><dd class="total">${dinero(total)}</dd>
  </dl>`;

const notaLegal = '<p class="texto-suave nota-legal">Al hacer tu pedido aceptas nuestra <a href="/cambios-y-devoluciones">política de cambios</a> y el <a href="/aviso-de-privacidad">aviso de privacidad</a>.</p>';

function renderCarrito() {
  const t = totales();
  const contador = $('#contador-carrito');
  contador.textContent = t.piezas;
  contador.hidden = t.piezas === 0;
  $('#carrito-titulo').textContent = { carrito: 'Tu carrito', datos: 'Datos del pedido', listo: '¡Pedido registrado!' }[pasoCarrito];

  if (pasoCarrito === 'listo') return renderPedidoListo();

  if (!carrito.length) {
    pasoCarrito = 'carrito';
    $('#carrito-titulo').textContent = 'Tu carrito';
    $('#carrito-items').innerHTML = `
      <div class="vacio">
        <p>Tu carrito está vacío.</p>
        <button class="btn btn-verde" id="seguir-comprando">Ver productos</button>
      </div>`;
    $('#carrito-pie').innerHTML = '';
    return;
  }

  if (pasoCarrito === 'datos') return renderDatosPedido(t);

  $('#carrito-items').innerHTML = carrito.map((item) => {
    const { p, v, precio, max } = datosItem(item);
    return `
      <div class="item">
        <span class="item-img">${imagen(p, v)}</span>
        <div class="item-info">
          <p class="item-nombre">${p.nombre}</p>
          <p class="texto-suave">${p.etiquetaVariante}: ${v.nombre}${item.talla ? ` · Talla ${item.talla}` : ''}</p>
          <div class="item-fila">
            <div class="cantidad cantidad-chica">
              <button data-item-cant="-1" data-key="${item.key}" aria-label="Menos">−</button>
              <span>${item.cant}</span>
              <button data-item-cant="1" data-key="${item.key}" aria-label="Más" ${item.cant >= max ? 'disabled' : ''}>+</button>
            </div>
            <strong>${dinero(precio * item.cant)}</strong>
          </div>
          <button class="enlace enlace-quitar" data-quitar="${item.key}">Quitar</button>
        </div>
      </div>`;
  }).join('');

  const falta = TIENDA.envioGratisDesde - t.subtotal;
  $('#carrito-pie').innerHTML = `
    <fieldset class="entrega">
      <legend>¿Cómo quieres recibirlo?</legend>
      <label class="opcion-entrega">
        <input type="radio" name="entrega" value="envio" ${entrega === 'envio' ? 'checked' : ''}>
        <span><strong>Envío a domicilio</strong><span class="texto-suave">Gratis desde ${dinero(TIENDA.envioGratisDesde)}; si no, ${dinero(TIENDA.costoEnvio)}</span></span>
      </label>
      <label class="opcion-entrega">
        <input type="radio" name="entrega" value="tienda" ${entrega === 'tienda' ? 'checked' : ''}>
        <span><strong>Recoger en tienda · Gratis</strong><span class="texto-suave">${TIENDA.calle}, ${TIENDA.colonia}, ${TIENDA.municipio}</span></span>
      </label>
    </fieldset>
    ${entrega === 'envio' ? `
    <div class="envio-progreso">
      <p>${falta > 0 ? `Te faltan <strong>${dinero(falta)}</strong> para envío gratis` : '¡Tienes <strong>envío gratis</strong>!'}</p>
      <div class="barra"><span style="width:${Math.min(100, (t.subtotal / TIENDA.envioGratisDesde) * 100)}%"></span></div>
    </div>` : ''}
    ${htmlTotales(t)}
    <button class="btn btn-verde btn-bloque" id="continuar-pedido">Continuar</button>
    <button class="enlace" id="vaciar-carrito">Vaciar carrito</button>`;
}

function renderDatosPedido(t) {
  const c = leerLocal(CLAVE_CLIENTE, {}) || {};
  const campo = (nombre, etiqueta, extra = '') =>
    `<label class="campo"><span>${etiqueta}</span><input name="${nombre}" value="${esc(c[nombre] || '')}" ${extra}></label>`;
  $('#carrito-items').innerHTML = `
    <form id="form-pedido" class="form-pedido" novalidate>
      <button type="button" class="enlace" data-paso="carrito">← Volver al carrito</button>
      <h3>Tus datos</h3>
      ${campo('nombre', 'Nombre completo *', 'autocomplete="name" maxlength="80" required')}
      ${campo('telefono', 'WhatsApp o teléfono (10 dígitos) *', 'type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" required')}
      ${entrega === 'envio' ? `
      <h3>Dirección de envío</h3>
      ${campo('calle', 'Calle y número *', 'autocomplete="address-line1" maxlength="120"')}
      ${campo('colonia', 'Colonia *', 'maxlength="80"')}
      <div class="fila-campos">
        ${campo('cp', 'Código postal *', 'inputmode="numeric" autocomplete="postal-code" maxlength="5"')}
        ${campo('municipio', 'Municipio o ciudad *', 'autocomplete="address-level2" maxlength="80"')}
      </div>
      <label class="campo"><span>Estado *</span><input name="estado" value="${esc(c.estado || 'Morelos')}" autocomplete="address-level1" maxlength="40"></label>
      ${campo('referencias', 'Referencias <small>(opcional)</small>', 'maxlength="200" placeholder="Ej. portón verde, entre calles…"')}` : `
      <div class="aviso-recoger">
        <strong>Recoges en nuestra tienda</strong>
        <p>${TIENDA.direccion}<br>${TIENDA.horario}</p>
        <p class="texto-suave">Te avisamos por WhatsApp cuando tu pedido esté listo.</p>
      </div>`}
      <label class="campo"><span>Notas <small>(opcional)</small></span><textarea name="notas" maxlength="300" rows="2"></textarea></label>
      <p class="error" id="pedido-error" role="alert"></p>
    </form>`;
  $('#carrito-pie').innerHTML = `
    ${htmlTotales(t)}
    <button type="submit" form="form-pedido" class="btn btn-verde btn-bloque" id="enviar-pedido">Hacer pedido</button>
    ${notaLegal}`;
}

function mensajePedido(p) {
  const c = p.cliente;
  return [
    `¡Hola, Zapatería Brazil! Acabo de hacer el pedido ${p.folio}:`,
    '',
    ...p.articulos.map((a) => `• ${a.cant} x ${a.nombre} (${a.variante}${a.talla ? `, talla ${a.talla}` : ''}) — ${dinero(a.precio * a.cant)}`),
    '',
    `Subtotal: ${dinero(p.subtotal)}`,
    `${p.entrega === 'tienda' ? 'Recoger en tienda' : 'Envío'}: ${p.envio ? dinero(p.envio) : 'Gratis'}`,
    `Total: ${dinero(p.total)}`,
    '',
    `Nombre: ${c.nombre}`,
    p.entrega === 'tienda'
      ? 'Entrega: recojo en tienda'
      : `Enviar a: ${c.calle}, ${c.colonia}, C.P. ${c.cp}, ${c.municipio}, ${c.estado}${c.referencias ? ` (${c.referencias})` : ''}`,
    ...(p.notas ? [`Notas: ${p.notas}`] : []),
  ].join('\n');
}

function renderPedidoListo() {
  const p = ultimoPedido;
  $('#carrito-items').innerHTML = `
    <div class="pedido-listo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--verde)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p class="pedido-folio">Folio <strong>${p.folio}</strong></p>
      <p>Último paso: <strong>envíanos el mensaje por WhatsApp</strong> para confirmar tu pedido
        ${p.entrega === 'tienda' ? 'y avisarte cuando esté listo para recoger.' : 'y acordar el pago y el envío.'}</p>
      ${htmlTotales(p)}
      <a class="btn btn-verde btn-bloque" id="abrir-whatsapp" href="${enlaceWhatsApp(mensajePedido(p))}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
      <button class="enlace" id="seguir-comprando">Seguir comprando</button>
    </div>`;
  $('#carrito-pie').innerHTML = '';
}

async function enviarPedido(form) {
  const datos = Object.fromEntries(new FormData(form));
  const boton = $('#enviar-pedido');
  const errorEl = $('#pedido-error');
  const { notas, ...cliente } = datos;
  guardarLocal(CLAVE_CLIENTE, { ...leerLocal(CLAVE_CLIENTE, {}), ...cliente }); // para no volver a escribirlos
  boton.disabled = true;
  errorEl.textContent = '';
  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entrega,
        cliente,
        notas,
        articulos: carrito.map(({ id, variante, talla, cant }) => ({ id, variante, talla, cant })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'No pudimos registrar tu pedido. Intenta de nuevo.');
    ultimoPedido = json;
    carrito = [];
    guardarCarrito();
    pasoCarrito = 'listo';
    renderCarrito();
    $('#abrir-whatsapp').focus();
  } catch (err) {
    errorEl.textContent = err.message === 'Failed to fetch' ? 'Sin conexión. Revisa tu internet e intenta de nuevo.' : err.message;
    errorEl.scrollIntoView({ block: 'nearest' });
  } finally {
    boton.disabled = false;
  }
}

function cambiarCantidadItem(key, delta) {
  const item = carrito.find((i) => i.key === key);
  if (!item) return;
  item.cant = Math.min(item.cant + delta, datosItem(item).max);
  if (item.cant <= 0) carrito = carrito.filter((i) => i.key !== key);
  guardarCarrito();
  renderCarrito();
}

function abrirCarrito() {
  $('#carrito').classList.add('abierto');
  $('#carrito').setAttribute('aria-hidden', 'false');
  $('#capa-carrito').hidden = false;
  document.body.classList.add('sin-scroll');
  $('#cerrar-carrito').focus();
}

function cerrarCarrito() {
  $('#carrito').classList.remove('abierto');
  $('#carrito').setAttribute('aria-hidden', 'true');
  $('#capa-carrito').hidden = true;
  document.body.classList.remove('sin-scroll');
  if (pasoCarrito === 'listo') {
    pasoCarrito = 'carrito';
    renderCarrito();
  }
}

// ---------- Aviso flotante ----------
let temporizadorToast;
function toast(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.classList.add('visible');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => t.classList.remove('visible'), 2200);
}

// ---------- Eventos ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a');
  if (!el) {
    // Clic en el fondo oscuro (fuera del recuadro) de un <dialog> lo cierra
    if (e.target.tagName === 'DIALOG') {
      const r = e.target.getBoundingClientRect();
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (fuera) e.target.close();
    }
    return;
  }
  const d = el.dataset;
  // Ctrl/⌘ + clic o clic central en un enlace: dejar que el navegador abra otra pestaña
  const nuevaPestana = el.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0);

  if (d.categoria) {
    if (nuevaPestana) return;
    e.preventDefault();
    if (el.closest('dialog')) el.closest('dialog').close();
    return cambiarCategoria(d.categoria);
  }

  if (d.abrir) {
    if (nuevaPestana) return;
    e.preventDefault();
    const tarjeta = el.closest('.tarjeta');
    return navegar(`/producto/${d.abrir}`, { vi: tarjeta ? Number(tarjeta.dataset.vi) : 0 });
  }

  if (d.volver !== undefined) {
    if (navegoDentro) return history.back();
    return navegar('/');
  }

  if (d.visitanos !== undefined) {
    if (nuevaPestana) return;
    e.preventDefault();
    irAlCatalogo();
    renderCatalogo();
    return $('#visitanos').scrollIntoView({ behavior: 'smooth' });
  }

  // Cambiar color desde la tarjeta sin abrir el producto
  if (d.tarjetaVariante) {
    const tarjeta = el.closest('.tarjeta');
    const p = buscarProducto(tarjeta.dataset.id);
    const vi = Number(d.tarjetaVariante);
    tarjeta.dataset.vi = vi;
    tarjeta.querySelector('.tarjeta-img').innerHTML = imagen(p, p.variantes[vi]) + badges(p);
    tarjeta.querySelectorAll('[data-tarjeta-variante]').forEach((b) => b.classList.toggle('activo', b === el));
    return;
  }

  if (d.guia !== undefined) return $('#modal-guia').showModal();
  if (d.cerrar !== undefined) return el.closest('dialog').close();

  // Filtros
  if (d.filtroTalla) {
    estado.talla = estado.talla === d.filtroTalla ? null : d.filtroTalla;
    return renderCatalogo();
  }
  if (d.filtroColor) {
    estado.color = estado.color === d.filtroColor ? null : d.filtroColor;
    return renderCatalogo();
  }
  if (el.id === 'limpiar-filtros' || el.id === 'limpiar-filtros-vacio') {
    Object.assign(estado, filtrosIniciales());
    return renderCatalogo();
  }
  if (el.id === 'btn-filtros') {
    const abierto = $('#filtros').classList.toggle('abierto');
    return el.setAttribute('aria-expanded', abierto);
  }

  // Página de producto
  if (d.detalleVariante) {
    detalle.vi = Number(d.detalleVariante);
    const v = detalle.p.variantes[detalle.vi];
    if (detalle.talla && stockDe(v, detalle.talla) === 0) detalle.talla = null;
    detalle.cant = 1;
    return renderDetalle();
  }
  if (d.detalleTalla) {
    detalle.talla = d.detalleTalla;
    detalle.cant = 1;
    return renderDetalle();
  }
  if (d.detalleCant) {
    detalle.cant = Math.max(1, Math.min(detalle.cant + Number(d.detalleCant), disponibleDetalle()));
    return renderDetalle();
  }
  if (el.id === 'agregar-carrito') return agregarAlCarrito();
  if (el.id === 'compartir') return compartirProducto();

  // Carrito
  if (el.id === 'abrir-carrito') return abrirCarrito();
  if (el.id === 'cerrar-carrito') return cerrarCarrito();
  if (el.id === 'seguir-comprando') {
    cerrarCarrito();
    if (document.body.dataset.vista === 'catalogo') $('#catalogo').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (d.itemCant) return cambiarCantidadItem(d.key, Number(d.itemCant));
  if (d.quitar) {
    carrito = carrito.filter((i) => i.key !== d.quitar);
    guardarCarrito();
    return renderCarrito();
  }
  if (el.id === 'vaciar-carrito') {
    carrito = [];
    guardarCarrito();
    return renderCarrito();
  }
  if (el.id === 'continuar-pedido') {
    pasoCarrito = 'datos';
    renderCarrito();
    $('#carrito-items').scrollTop = 0;
    return $('#form-pedido [name="nombre"]').focus();
  }
  if (d.paso) {
    pasoCarrito = d.paso;
    return renderCarrito();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.sub) {
    t.checked ? estado.subs.add(t.dataset.sub) : estado.subs.delete(t.dataset.sub);
    renderProductos();
  } else if (t.id === 'solo-ofertas') {
    estado.soloOfertas = t.checked;
    renderProductos();
  } else if (t.id === 'orden') {
    estado.orden = t.value;
    renderProductos();
  } else if (t.name === 'entrega') {
    entrega = t.value;
    guardarLocal(CLAVE_ENTREGA, entrega);
    renderCarrito();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'filtro-precio') {
    const valor = Number(t.value);
    estado.precioMax = valor >= Number(t.max) ? null : valor;
    $('#valor-precio').textContent = dinero(valor);
    renderProductos();
  } else if (t.id === 'busqueda') {
    estado.busqueda = t.value;
    if (idEnRuta()) { irAlCatalogo(); renderCatalogo(); }
    else renderProductos();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-pedido') {
    e.preventDefault();
    enviarPedido(e.target);
  }
});

$('#form-busqueda').addEventListener('submit', (e) => {
  e.preventDefault();
  irAlCatalogo();
  renderCatalogo();
  $('#catalogo').scrollIntoView({ behavior: 'smooth' });
});

$('#capa-carrito').addEventListener('click', cerrarCarrito);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#carrito').classList.contains('abierto')) cerrarCarrito();
});
window.addEventListener('popstate', aplicarRuta);

// ---------- Inicio ----------
$('#hero-figura').innerHTML = figura('tenis', '#FFDF00');

async function iniciar() {
  try {
    const res = await fetch('/api/catalogo');
    if (!res.ok) throw new Error(res.status);
    ({ categorias: CATEGORIAS, productos: PRODUCTOS, tienda: TIENDA } = await res.json());
  } catch {
    const aviso = '<div class="vacio"><p>No pudimos cargar el catálogo. Intenta recargar la página.</p></div>';
    $('#grid-productos').innerHTML = aviso;
    $('#detalle-producto').innerHTML = aviso;
    return;
  }
  carrito = cargarCarrito();
  // El botón del hero apunta a "cuidado"; si esa categoría ya no existe, se oculta.
  document.querySelectorAll('#hero [data-categoria]').forEach((b) => {
    b.hidden = !CATEGORIAS.some((c) => c.id === b.dataset.categoria);
  });
  renderGridCategorias();
  aplicarRuta();
  renderCarrito();
}

iniciar();
