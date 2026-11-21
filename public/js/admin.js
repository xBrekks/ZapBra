'use strict';

// ---------- Utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const dinero = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const normalizar = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRESETS_TALLAS = {
  'Hombre (25–30)': ['25', '26', '27', '28', '29', '30'],
  'Mujer (22–26)': ['22', '23', '24', '25', '26'],
  'Niños (15–21)': ['15', '16', '17', '18', '19', '20', '21'],
  'Ropa (CH, M, G)': ['CH', 'M', 'G'],
};
const PRESET_POR_CATEGORIA = {
  hombre: 'Hombre (25–30)',
  mujer: 'Mujer (22–26)',
  ninos: 'Niños (15–21)',
  accesorios: 'Ropa (CH, M, G)',
};
const STOCK_BAJO = 5; // un producto con este total o menos se marca como "stock bajo"
const MAX_RELACIONADOS = 6;

const stockVariante = (v) =>
  typeof v.stock === 'number' ? v.stock : Object.values(v.stock).reduce((a, b) => a + b, 0);
const stockTotal = (p) => p.variantes.reduce((a, v) => a + stockVariante(v), 0);
const stockVacio = (tallas) => Object.fromEntries(tallas.map((t) => [t, 0]));

function estadoStock(p) {
  const total = stockTotal(p);
  return total === 0 ? 'agotado' : total <= STOCK_BAJO ? 'bajo' : 'ok';
}

function imagen(p, v) {
  return v.imagen
    ? `<img src="${esc(v.imagen)}" alt="${esc(p.nombre)} ${esc(v.nombre)}">`
    : figura(p.tipo, v.hex);
}

// ---------- Estado ----------
let catalogo = { categorias: [], productos: [] };
let borrador = null; // producto que se está editando
let editandoId = null; // null = producto nuevo
let sinGuardar = false;
let modoConfigurar = false;
let porEliminar = null;
const filtros = { q: '', categoria: '', stock: '' };

const nombreCategoria = (id) => catalogo.categorias.find((c) => c.id === id)?.nombre || id;

// ---------- API ----------
async function api(ruta, { metodo = 'GET', datos } = {}) {
  const opciones = { method: metodo, headers: {} };
  if (datos !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(datos);
  }
  const res = await fetch(ruta, opciones);
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/api/login') {
    sinGuardar = false;
    mostrarAcceso(true);
  }
  if (!res.ok) throw new Error(json.error || 'Ocurrió un error. Intenta de nuevo.');
  return json;
}

async function cargarCatalogo() {
  catalogo = await api('/api/catalogo');
}

// ---------- Vistas ----------
function mostrar(vista) {
  ['acceso', 'tablero', 'pedidos', 'listado', 'editor', 'categorias'].forEach((id) => { $(`#${id}`).hidden = id !== vista; });
  $('#admin-menu').hidden = vista === 'acceso';
  $('#pestanas').hidden = vista === 'acceso' || vista === 'editor';
  document.querySelectorAll('#pestanas [data-vista]').forEach((b) => {
    const activa = b.dataset.vista === vista;
    b.classList.toggle('activo', activa);
    if (activa) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

$('#pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vista]');
  if (!b) return;
  mostrar(b.dataset.vista);
  if (b.dataset.vista === 'tablero') cargarTablero();
  if (b.dataset.vista === 'pedidos') cargarPedidos();
});

let temporizadorToast;
function toast(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.classList.add('visible');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => t.classList.remove('visible'), 2600);
}

// ---------- Acceso ----------
function mostrarAcceso(configurado) {
  modoConfigurar = !configurado;
  $('#acceso-titulo').textContent = modoConfigurar ? 'Crea tu contraseña' : 'Iniciar sesión';
  $('#acceso-texto').textContent = modoConfigurar
    ? 'Es la primera vez que entras. Elige una contraseña de al menos 8 caracteres para proteger el panel.'
    : 'Ingresa la contraseña del panel.';
  $('#campo-confirmar').hidden = !modoConfigurar;
  $('#acceso-password').autocomplete = modoConfigurar ? 'new-password' : 'current-password';
  $('#acceso-boton').textContent = modoConfigurar ? 'Crear contraseña y entrar' : 'Entrar';
  $('#acceso-error').textContent = '';
  mostrar('acceso');
  $('#acceso-password').focus();
}

$('#form-acceso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#acceso-password').value;
  try {
    if (modoConfigurar) {
      if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
      if (password !== $('#acceso-confirmar').value) throw new Error('Las contraseñas no coinciden');
      await api('/api/configurar', { metodo: 'POST', datos: { password } });
    } else {
      await api('/api/login', { metodo: 'POST', datos: { password } });
    }
    e.target.reset();
    await entrarAlPanel();
  } catch (err) {
    $('#acceso-error').textContent = err.message;
  }
});

async function entrarAlPanel() {
  await recargarTodo();
  mostrar('tablero');
  await Promise.all([cargarTablero(), cargarPedidos()]); // los pedidos también llenan el contador de la pestaña
}

// Vuelve a leer el catálogo y repinta todo lo que depende de él.
async function recargarTodo() {
  await cargarCatalogo();
  if (!catalogo.categorias.some((c) => c.id === filtros.categoria)) filtros.categoria = '';
  $('#filtro-categoria').innerHTML = '<option value="">Todas las categorías</option>' +
    catalogo.categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');
  $('#filtro-categoria').value = filtros.categoria;
  renderListado();
  renderCategorias();
}

// ---------- Listado ----------
function renderListado() {
  const ps = catalogo.productos;
  const unidades = ps.reduce((a, p) => a + stockTotal(p), 0);
  const bajos = ps.filter((p) => estadoStock(p) === 'bajo').length;
  const agotados = ps.filter((p) => estadoStock(p) === 'agotado').length;
  $('#resumen').innerHTML = `
    <div class="dato"><strong>${ps.length}</strong><span>Productos</span></div>
    <div class="dato"><strong>${unidades}</strong><span>Unidades en inventario</span></div>
    <button class="dato dato-alerta" data-ver-stock="bajo"><strong>${bajos}</strong><span>Con stock bajo (${STOCK_BAJO} o menos)</span></button>
    <button class="dato dato-peligro" data-ver-stock="agotado"><strong>${agotados}</strong><span>Agotados</span></button>`;

  const q = normalizar(filtros.q.trim());
  const lista = ps.filter((p) =>
    (!filtros.categoria || p.categoria === filtros.categoria) &&
    (!filtros.stock || estadoStock(p) === filtros.stock) &&
    (!q || normalizar(`${p.nombre} ${p.marca} ${p.sub}`).includes(q)));

  const etiquetas = {
    ok: '<span class="etiqueta etiqueta-ok">OK</span>',
    bajo: '<span class="etiqueta etiqueta-bajo">Bajo</span>',
    agotado: '<span class="etiqueta etiqueta-agotado">Agotado</span>',
  };

  $('#tabla-productos').innerHTML = lista.length ? lista.map((p) => `
    <tr>
      <td>
        <div class="celda-producto">
          <span class="miniatura">${imagen(p, p.variantes[0])}</span>
          <span><strong>${esc(p.nombre)}</strong><span class="texto-suave">${esc(p.marca)} · ${esc(p.sub)}</span></span>
        </div>
      </td>
      <td>${esc(nombreCategoria(p.categoria))}</td>
      <td>${p.precioOferta != null
        ? `<strong>${dinero(p.precioOferta)}</strong><br><s class="texto-suave">${dinero(p.precio)}</s>`
        : `<strong>${dinero(p.precio)}</strong>`}</td>
      <td>${p.etiquetaVariante === 'Color'
        ? `<div class="puntos">${p.variantes.map((v) => `<span class="punto" style="--c:${esc(v.hex)}" title="${esc(v.nombre)}"></span>`).join('')}</div>`
        : `<span class="texto-suave">${p.variantes.map((v) => esc(v.nombre)).join(', ')}</span>`}</td>
      <td>${stockTotal(p)} uds. ${etiquetas[estadoStock(p)]}</td>
      <td>
        <div class="acciones">
          <button class="btn btn-claro btn-chico" data-editar="${esc(p.id)}">Editar</button>
          <button class="btn btn-claro btn-chico" data-duplicar="${esc(p.id)}">Duplicar</button>
          <button class="btn btn-claro btn-chico" data-eliminar="${esc(p.id)}" aria-label="Eliminar ${esc(p.nombre)}">Eliminar</button>
        </div>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="vacio">No hay productos que coincidan con la búsqueda.</td></tr>';
}

$('#listado').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;
  if (el.id === 'btn-nuevo') return abrirEditor(null);
  if (d.editar) return abrirEditor(d.editar);
  if (d.duplicar) return abrirEditor(d.duplicar, true);
  if (d.verStock) {
    filtros.stock = filtros.stock === d.verStock ? '' : d.verStock;
    $('#filtro-stock').value = filtros.stock;
    return renderListado();
  }
  if (d.eliminar) {
    const p = catalogo.productos.find((x) => x.id === d.eliminar);
    confirmarEliminar({ tipo: 'productos', id: p.id, nombre: p.nombre },
      '¿Eliminar producto?', `"${p.nombre}" se quitará de la tienda. Esta acción no se puede deshacer.`);
  }
});

function confirmarEliminar(objetivo, titulo, textoConfirmacion) {
  porEliminar = objetivo;
  $('#confirmar-titulo').textContent = titulo;
  $('#confirmar-texto').textContent = textoConfirmacion;
  $('#modal-confirmar').showModal();
}

$('#buscar').addEventListener('input', (e) => { filtros.q = e.target.value; renderListado(); });
$('#filtro-categoria').addEventListener('change', (e) => { filtros.categoria = e.target.value; renderListado(); });
$('#filtro-stock').addEventListener('change', (e) => { filtros.stock = e.target.value; renderListado(); });

$('#confirmar-si').addEventListener('click', async () => {
  try {
    await api(`/api/${porEliminar.tipo}/${porEliminar.id}`, { metodo: 'DELETE' });
    $('#modal-confirmar').close();
    toast(`"${porEliminar.nombre}" eliminado`);
    await recargarTodo();
  } catch (err) {
    $('#modal-confirmar').close();
    toast(err.message);
  }
});

// ---------- Editor ----------
function nuevoBorrador() {
  const categoria = catalogo.categorias[0]?.id || '';
  const tallas = [...PRESETS_TALLAS[PRESET_POR_CATEGORIA[categoria] || 'Hombre (25–30)']];
  return {
    nombre: '', marca: '', categoria, sub: '', tipo: 'tenis',
    precio: null, precioOferta: null, costo: null, nuevo: true,
    material: '', calce: '', descripcion: '',
    tallas, etiquetaVariante: 'Color',
    variantes: [{ nombre: '', hex: '#1f2937', stock: stockVacio(tallas) }],
    relacionados: [],
  };
}

function abrirEditor(id, duplicar = false) {
  if (id) {
    const p = structuredClone(catalogo.productos.find((x) => x.id === id));
    if (duplicar) p.nombre += ' (copia)';
    borrador = { precioOferta: null, costo: null, calce: '', tallas: null, relacionados: [], ...p };
    editandoId = duplicar ? null : id;
  } else {
    borrador = nuevoBorrador();
    editandoId = null;
  }
  sinGuardar = duplicar;
  renderEditor();
  mostrar('editor');
}

function imagenBorrador(v) {
  return imagen(borrador, v);
}

function htmlVariante(v, i) {
  const b = borrador;
  const esColor = b.etiquetaVariante === 'Color';
  return `
    <div class="variante">
      <div class="variante-cabecera">
        <div>
          <div class="variante-imagen">${imagenBorrador(v)}</div>
          <div class="variante-botones">
            <label class="btn btn-claro btn-chico">${v.imagen ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/jpeg,image/png,image/webp" data-subir="${i}" hidden>
            </label>
            ${v.imagen ? `<button type="button" class="btn btn-claro btn-chico" data-quitar-foto="${i}">Quitar foto</button>` : ''}
          </div>
        </div>
        <div class="fila-campos">
          <label class="campo"><span>Nombre *</span>
            <input data-var="${i}" data-vcampo="nombre" value="${esc(v.nombre)}" placeholder="${esColor ? 'Ej. Negro' : 'Ej. 150 ml'}" maxlength="60"></label>
          <label class="campo"><span>${esColor ? 'Color' : 'Color de la ilustración'}</span>
            <span class="color-campo"><input type="color" data-var="${i}" data-vcampo="hex" value="${esc(v.hex)}"><code>${esc(v.hex)}</code></span></label>
          <label class="campo"><span>Precio propio <small>(opcional)</small></span>
            <input type="number" min="0" step="1" data-var="${i}" data-vcampo="precio" value="${v.precio ?? ''}" placeholder="El del producto"></label>
          <label class="campo"><span>Costo propio <small>(opcional)</small></span>
            <input type="number" min="0" step="1" data-var="${i}" data-vcampo="costo" value="${v.costo ?? ''}" placeholder="El del producto"></label>
        </div>
      </div>
      ${b.tallas ? `
      <div class="stock-grid">
        ${b.tallas.map((t) => {
          const n = v.stock[t] ?? 0;
          return `<label class="stock-celda"><span>${esc(t)}</span>
            <input type="number" min="0" step="1" inputmode="numeric" data-var="${i}" data-talla="${esc(t)}" value="${n}" class="${n === 0 ? 'cero' : ''}" aria-label="Inventario talla ${esc(t)}"></label>`;
        }).join('')}
      </div>` : `
      <label class="campo" style="max-width:220px"><span>Unidades en inventario</span>
        <input type="number" min="0" step="1" inputmode="numeric" data-var="${i}" data-talla="" value="${v.stock}"></label>`}
      <p class="stock-total"><span id="total-${i}">Total: ${stockVariante(v)} uds.</span>
        ${b.variantes.length > 1 ? ` · <button type="button" class="enlace enlace-quitar" data-quitar-variante="${i}">Eliminar variante</button>` : ''}</p>
    </div>`;
}

function renderEditor() {
  const b = borrador;
  const subs = [...new Set(catalogo.productos.map((p) => p.sub))].sort((x, y) => x.localeCompare(y, 'es'));
  const otros = catalogo.productos.filter((p) => p.id !== editandoId);

  $('#editor').innerHTML = `
    <div class="editor-encabezado">
      <button type="button" class="btn btn-claro btn-chico" data-accion="volver">← Volver</button>
      <h1>${editandoId ? `Editar: ${esc(b.nombre)}` : 'Nuevo producto'}</h1>
    </div>
    <form id="form-producto" novalidate>
      <div class="editor-grid">
        <div>
          <fieldset class="tarjeta-form">
            <legend>Información general</legend>
            <label class="campo"><span>Nombre del producto *</span>
              <input data-campo="nombre" value="${esc(b.nombre)}" maxlength="120" placeholder="Ej. Tenis Runner Pro"></label>
            <div class="fila-campos">
              <label class="campo"><span>Marca</span>
                <input data-campo="marca" value="${esc(b.marca)}" maxlength="60"></label>
              <label class="campo"><span>Categoría *</span>
                <select data-campo="categoria">${catalogo.categorias.map((c) =>
                  `<option value="${esc(c.id)}" ${c.id === b.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
              <label class="campo"><span>Tipo * <small>(ej. Deportivo, Botas)</small></span>
                <input data-campo="sub" value="${esc(b.sub)}" list="lista-subs" maxlength="60"></label>
            </div>
            <datalist id="lista-subs">${subs.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
            <label class="campo"><span>Descripción</span>
              <textarea data-campo="descripcion" maxlength="1000">${esc(b.descripcion)}</textarea></label>
            <div class="fila-campos">
              <label class="campo"><span>Material</span>
                <input data-campo="material" value="${esc(b.material)}" maxlength="160" placeholder="Ej. Piel genuina"></label>
              <label class="campo"><span>Calce <small>(opcional)</small></span>
                <input data-campo="calce" value="${esc(b.calce)}" maxlength="80" placeholder="Ej. Pide media talla más"></label>
            </div>
          </fieldset>

          <fieldset class="tarjeta-form">
            <legend>Precio</legend>
            <div class="fila-campos">
              <label class="campo"><span>Precio normal (MXN) *</span>
                <input type="number" min="0" step="1" inputmode="decimal" data-campo="precio" data-numero value="${b.precio ?? ''}"></label>
              <label class="campo"><span>Precio de oferta <small>(vacío = sin oferta)</small></span>
                <input type="number" min="0" step="1" inputmode="decimal" data-campo="precioOferta" data-numero value="${b.precioOferta ?? ''}"></label>
              <label class="campo"><span>Costo por pieza <small>(opcional)</small></span>
                <input type="number" min="0" step="1" inputmode="decimal" data-campo="costo" data-numero value="${b.costo ?? ''}"></label>
            </div>
            <p class="ayuda" id="ganancia-pieza" aria-live="polite"></p>
            <label class="check"><input type="checkbox" data-campo="nuevo" ${b.nuevo ? 'checked' : ''}> Mostrar etiqueta "Nuevo"</label>
          </fieldset>

          <fieldset class="tarjeta-form">
            <legend>Tallas</legend>
            <label class="check"><input type="checkbox" data-accion="usar-tallas" ${b.tallas ? 'checked' : ''}> Este producto se vende por tallas</label>
            ${b.tallas ? `
              <p class="ayuda" style="margin-top:.5rem">Elige un grupo de tallas o escríbelas separadas por coma. El inventario que ya capturaste se conserva.</p>
              <div class="presets">${Object.keys(PRESETS_TALLAS).map((n) =>
                `<button type="button" class="chip" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div>
              <label class="campo"><span>Tallas</span>
                <input data-accion="tallas" value="${esc(b.tallas.join(', '))}"></label>`
            : '<p class="ayuda" style="margin-top:.5rem">Sin tallas: el inventario se cuenta por unidades (ideal para cremas, cepillos, etc.).</p>'}
          </fieldset>

          <fieldset class="tarjeta-form">
            <legend>Variantes e inventario</legend>
            <label class="campo" style="max-width:260px"><span>Las variantes son por…</span>
              <select data-campo="etiquetaVariante">
                <option ${b.etiquetaVariante === 'Color' ? 'selected' : ''}>Color</option>
                <option ${b.etiquetaVariante === 'Presentación' ? 'selected' : ''}>Presentación</option>
              </select></label>
            <p class="ayuda">Color: Negro, Café… · Presentación: 150 ml, 300 ml… Cada variante tiene su foto, su inventario y, si quieres, su propio precio.</p>
            <div id="variantes">${b.variantes.map(htmlVariante).join('')}</div>
            <button type="button" class="btn btn-claro" data-accion="agregar-variante">+ Agregar variante</button>
          </fieldset>

          <fieldset class="tarjeta-form">
            <legend>Productos relacionados</legend>
            <p class="ayuda">Se sugieren en la ficha del producto, en "Complementa tu compra". Máximo ${MAX_RELACIONADOS}.</p>
            <div class="lista-relacionados">
              ${otros.map((o) => `
                <label class="check"><input type="checkbox" data-relacionado="${esc(o.id)}" ${b.relacionados.includes(o.id) ? 'checked' : ''}>
                  ${esc(o.nombre)} <span class="texto-suave">· ${esc(nombreCategoria(o.categoria))}</span></label>`).join('')}
            </div>
          </fieldset>
        </div>

        <aside class="vista-previa">
          <h2>Vista previa</h2>
          <div id="vista-previa"></div>
          <label class="campo" style="margin-top:1rem"><span>Ilustración (cuando no hay foto)</span>
            <select data-campo="tipo">${Object.entries(TIPOS_FIGURA).map(([k, n]) =>
              `<option value="${k}" ${k === b.tipo ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </aside>
      </div>

      <div class="editor-acciones">
        <p class="error" id="editor-error" role="alert"></p>
        <button type="button" class="btn btn-claro" data-accion="volver">Cancelar</button>
        <button type="submit" class="btn btn-verde" id="btn-guardar">${editandoId ? 'Guardar cambios' : 'Crear producto'}</button>
      </div>
    </form>`;
  renderVistaPrevia();
}

function renderVistaPrevia() {
  const b = borrador;
  const v = b.variantes[0];
  const precio = v.precio ?? b.precioOferta ?? b.precio;
  const antes = v.precio == null && b.precioOferta != null && b.precio ? b.precio : null;
  const badges = [];
  if (b.precioOferta != null && b.precio > b.precioOferta) {
    badges.push(`<span class="badge badge-oferta">-${Math.round((1 - b.precioOferta / b.precio) * 100)}%</span>`);
  }
  if (b.nuevo) badges.push('<span class="badge badge-nuevo">Nuevo</span>');

  $('#vista-previa').innerHTML = `
    <article class="tarjeta">
      <div class="tarjeta-img">${imagenBorrador(v)}${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}</div>
      <div class="tarjeta-cuerpo">
        <p class="tarjeta-meta">${esc(b.marca || 'Marca')} · ${esc(b.sub || 'Tipo')}</p>
        <h3>${esc(b.nombre || 'Nombre del producto')}</h3>
        ${b.etiquetaVariante === 'Color' && b.variantes.length > 1
          ? `<div class="swatches swatches-chicos">${b.variantes.map((x, i) =>
              `<span class="swatch ${i === 0 ? 'activo' : ''}" style="--c:${esc(x.hex)}"></span>`).join('')}</div>`
          : `<p class="texto-suave tarjeta-variantes">${b.variantes.map((x) => esc(x.nombre || '—')).join(' · ')}</p>`}
        <p class="precio"><span class="precio-actual">${precio ? dinero(precio) : '$ —'}</span>${antes ? ` <s class="precio-antes">${dinero(antes)}</s>` : ''}</p>
      </div>
    </article>`;

  // Ganancia por pieza con el precio que paga el cliente (el de oferta, si hay)
  const venta = b.precioOferta ?? b.precio;
  $('#ganancia-pieza').textContent = b.costo != null && venta > 0
    ? `Ganas ${dinero(venta - b.costo)} por pieza (${Math.round(((venta - b.costo) / venta) * 100)}% del precio${b.precioOferta != null ? ' de oferta' : ''}).`
    : 'El costo es lo que te cuesta cada pieza. Solo lo ves tú y sirve para calcular tu ganancia en el tablero.';
}

function aplicarTallas(nuevas) {
  borrador.variantes.forEach((v) => {
    const previo = typeof v.stock === 'object' ? v.stock : {};
    v.stock = Object.fromEntries(nuevas.map((t) => [t, previo[t] ?? 0]));
  });
  borrador.tallas = nuevas;
  sinGuardar = true;
}

const leerNumero = (valor) => (valor === '' ? null : Number(valor));

$('#editor').addEventListener('input', (e) => {
  const t = e.target;
  const d = t.dataset;
  if (d.campo) {
    borrador[d.campo] = t.type === 'checkbox' ? t.checked : d.numero !== undefined ? leerNumero(t.value) : t.value;
  } else if (d.var !== undefined) {
    const i = Number(d.var);
    const v = borrador.variantes[i];
    if (d.vcampo === 'precio' || d.vcampo === 'costo') {
      v[d.vcampo] = leerNumero(t.value);
    } else if (d.vcampo) {
      v[d.vcampo] = t.value;
      if (d.vcampo === 'hex') {
        t.nextElementSibling.textContent = t.value;
        if (!v.imagen) t.closest('.variante').querySelector('.variante-imagen').innerHTML = imagenBorrador(v);
      }
    } else if ('talla' in d) {
      const n = Math.max(0, parseInt(t.value, 10) || 0);
      if (d.talla === '') v.stock = n;
      else v.stock[d.talla] = n;
      t.classList.toggle('cero', n === 0);
      $(`#total-${i}`).textContent = `Total: ${stockVariante(v)} uds.`;
    }
  } else {
    return;
  }
  sinGuardar = true;
  renderVistaPrevia();
});

$('#editor').addEventListener('change', (e) => {
  const t = e.target;
  const d = t.dataset;

  // Campos que cambian la estructura del formulario
  if (d.campo === 'etiquetaVariante' || d.campo === 'tipo') return renderEditor();

  if (d.accion === 'usar-tallas') {
    if (t.checked) {
      aplicarTallas([...PRESETS_TALLAS[PRESET_POR_CATEGORIA[borrador.categoria] || 'Hombre (25–30)']]);
    } else {
      borrador.variantes.forEach((v) => { v.stock = stockVariante(v); });
      borrador.tallas = null;
      sinGuardar = true;
    }
    return renderEditor();
  }

  if (d.accion === 'tallas') {
    const nuevas = [...new Set(t.value.split(',').map((x) => x.trim()).filter(Boolean))];
    if (!nuevas.length) {
      toast('Escribe al menos una talla');
      t.value = borrador.tallas.join(', ');
      return;
    }
    aplicarTallas(nuevas);
    return renderEditor();
  }

  if (d.relacionado) {
    const lista = borrador.relacionados;
    if (t.checked) {
      if (lista.length >= MAX_RELACIONADOS) {
        t.checked = false;
        return toast(`Máximo ${MAX_RELACIONADOS} productos relacionados`);
      }
      lista.push(d.relacionado);
    } else {
      borrador.relacionados = lista.filter((r) => r !== d.relacionado);
    }
    sinGuardar = true;
    return;
  }

  if (d.subir !== undefined) subirFoto(Number(d.subir), t.files[0]);
});

$('#editor').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;

  if (d.accion === 'volver') {
    if (sinGuardar && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
    sinGuardar = false;
    return mostrar('listado');
  }
  if (d.preset) {
    aplicarTallas([...PRESETS_TALLAS[d.preset]]);
    return renderEditor();
  }
  if (d.accion === 'agregar-variante') {
    borrador.variantes.push({
      nombre: '',
      hex: '#1f2937',
      stock: borrador.tallas ? stockVacio(borrador.tallas) : 0,
    });
    sinGuardar = true;
    renderEditor();
    const nombres = document.querySelectorAll('[data-vcampo="nombre"]');
    return nombres[nombres.length - 1].focus();
  }
  if (d.quitarVariante) {
    borrador.variantes.splice(Number(d.quitarVariante), 1);
    sinGuardar = true;
    return renderEditor();
  }
  if (d.quitarFoto) {
    delete borrador.variantes[Number(d.quitarFoto)].imagen;
    sinGuardar = true;
    return renderEditor();
  }
});

function validarBorrador() {
  const b = borrador;
  if (!b.nombre.trim()) return 'Escribe el nombre del producto';
  if (!b.sub.trim()) return 'Escribe el tipo del producto (ej. Deportivo)';
  if (!(b.precio > 0)) return 'Escribe un precio mayor a 0';
  if (b.precioOferta != null && !(b.precioOferta < b.precio)) return 'El precio de oferta debe ser menor al precio normal';
  const nombres = b.variantes.map((v) => v.nombre.trim());
  if (nombres.some((n) => !n)) return 'Cada variante necesita un nombre';
  if (new Set(nombres).size !== nombres.length) return 'Hay variantes con el mismo nombre';
  if (b.variantes.some((v) => v.precio != null && !(v.precio > 0))) return 'El precio propio de una variante debe ser mayor a 0';
  if (b.costo != null && !(b.costo >= 0)) return 'El costo no puede ser negativo';
  if (b.variantes.some((v) => v.costo != null && !(v.costo >= 0))) return 'El costo propio de una variante no puede ser negativo';
  return null;
}

$('#editor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('#editor-error');
  const mensaje = validarBorrador();
  if (mensaje) {
    errorEl.textContent = mensaje;
    return;
  }
  errorEl.textContent = '';
  const boton = $('#btn-guardar');
  boton.disabled = true;
  try {
    const { id, ...datos } = borrador;
    if (editandoId) await api(`/api/productos/${editandoId}`, { metodo: 'PUT', datos });
    else await api('/api/productos', { metodo: 'POST', datos });
    sinGuardar = false;
    toast(editandoId ? 'Cambios guardados' : 'Producto creado');
    await recargarTodo();
    mostrar('listado');
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

// ---------- Fotos ----------
// Reduce la foto a 1200 px como máximo antes de subirla, para que la tienda cargue rápido.
function reducirImagen(archivo, max = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      let datos = lienzo.toDataURL('image/webp', 0.85);
      if (!datos.startsWith('data:image/webp')) datos = lienzo.toDataURL('image/jpeg', 0.85);
      resolve(datos);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

async function subirFoto(i, archivo) {
  if (!archivo) return;
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) return toast('Usa una imagen JPG, PNG o WEBP');
  try {
    toast('Subiendo foto…');
    const datos = await reducirImagen(archivo);
    const { ruta } = await api('/api/imagenes', { metodo: 'POST', datos: { datos } });
    borrador.variantes[i].imagen = ruta;
    sinGuardar = true;
    renderEditor();
    toast('Foto lista. Recuerda guardar el producto.');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Categorías ----------
let categoriaEditando = null; // id, o null si es nueva

function renderCategorias() {
  const total = catalogo.categorias.length;
  $('#lista-categorias').innerHTML = catalogo.categorias.map((c, i) => {
    const productos = catalogo.productos.filter((p) => p.categoria === c.id).length;
    return `
      <div class="fila-categoria">
        <span class="miniatura">${figura(c.tipo, c.hex)}</span>
        <div>
          <strong>${esc(c.nombre)}</strong>
          <p class="texto-suave">${esc(c.desc || 'Sin descripción')} · ${productos} ${productos === 1 ? 'producto' : 'productos'}</p>
        </div>
        <div class="acciones">
          <span class="orden-botones">
            <button class="btn btn-claro btn-chico" data-mover="${i}" data-dir="-1" aria-label="Subir ${esc(c.nombre)}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-claro btn-chico" data-mover="${i}" data-dir="1" aria-label="Bajar ${esc(c.nombre)}" ${i === total - 1 ? 'disabled' : ''}>↓</button>
          </span>
          <button class="btn btn-claro btn-chico" data-editar-cat="${esc(c.id)}">Editar</button>
          <button class="btn btn-claro btn-chico" data-eliminar-cat="${esc(c.id)}">Eliminar</button>
        </div>
      </div>`;
  }).join('');
}

function vistaCategoria() {
  $('#categoria-vista').innerHTML = figura($('#cat-tipo').value, $('#cat-hex').value);
}

function abrirCategoria(id) {
  const c = id ? catalogo.categorias.find((x) => x.id === id) : { nombre: '', desc: '', tipo: 'tenis', hex: '#009c3b' };
  categoriaEditando = id;
  $('#titulo-categoria').textContent = id ? `Editar: ${c.nombre}` : 'Nueva categoría';
  $('#cat-tipo').innerHTML = Object.entries(TIPOS_FIGURA).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('#cat-nombre').value = c.nombre;
  $('#cat-desc').value = c.desc || '';
  $('#cat-tipo').value = c.tipo;
  $('#cat-hex').value = c.hex;
  $('#cat-error').textContent = '';
  vistaCategoria();
  $('#modal-categoria').showModal();
  $('#cat-nombre').focus();
}

$('#cat-tipo').addEventListener('change', vistaCategoria);
$('#cat-hex').addEventListener('input', vistaCategoria);

$('#form-categoria').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = {
    nombre: $('#cat-nombre').value.trim(),
    desc: $('#cat-desc').value.trim(),
    tipo: $('#cat-tipo').value,
    hex: $('#cat-hex').value,
  };
  if (!datos.nombre) {
    $('#cat-error').textContent = 'Escribe el nombre de la categoría';
    return;
  }
  const boton = $('#cat-guardar');
  boton.disabled = true;
  try {
    if (categoriaEditando) await api(`/api/categorias/${categoriaEditando}`, { metodo: 'PUT', datos });
    else await api('/api/categorias', { metodo: 'POST', datos });
    $('#modal-categoria').close();
    toast(categoriaEditando ? 'Categoría actualizada' : 'Categoría creada');
    await recargarTodo();
  } catch (err) {
    $('#cat-error').textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

$('#categorias').addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;
  if (el.id === 'btn-nueva-categoria') return abrirCategoria(null);
  if (d.editarCat) return abrirCategoria(d.editarCat);

  if (d.eliminarCat) {
    const c = catalogo.categorias.find((x) => x.id === d.eliminarCat);
    const enUso = catalogo.productos.filter((p) => p.categoria === c.id).length;
    if (enUso) {
      return toast(`"${c.nombre}" tiene ${enUso} producto(s). Muévelos a otra categoría antes de eliminarla.`);
    }
    return confirmarEliminar({ tipo: 'categorias', id: c.id, nombre: c.nombre },
      '¿Eliminar categoría?', `"${c.nombre}" se quitará del menú de la tienda.`);
  }

  if (d.mover) {
    const i = Number(d.mover);
    const j = i + Number(d.dir);
    const ids = catalogo.categorias.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('/api/categorias/orden', { metodo: 'POST', datos: { ids } });
      await recargarTodo();
      // Mantener el foco en la flecha de la categoría que se movió
      const mismo = document.querySelector(`[data-mover="${j}"][data-dir="${d.dir}"]`);
      (mismo && !mismo.disabled ? mismo : document.querySelector(`[data-mover="${j}"]`))?.focus();
    } catch (err) {
      toast(err.message);
    }
  }
});

// ---------- Pedidos ----------
const ESTADOS_PEDIDO = { nuevo: 'Nuevo', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado' };
const fecha = (iso) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const telefonoBonito = (t) => t.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
const etiquetaEstado = (e) => `<span class="etiqueta etiqueta-${e}">${ESTADOS_PEDIDO[e]}</span>`;
const filtrosPedidos = { q: '', estado: '' };
let pedidos = [];
let pedidoAbierto = null;

async function cargarPedidos() {
  try {
    pedidos = await api('/api/pedidos');
    renderPedidos();
  } catch (err) {
    $('#tabla-pedidos').innerHTML = `<tr><td colspan="7" class="vacio">${esc(err.message)}</td></tr>`;
  }
}

function renderPedidos() {
  const nuevos = pedidos.filter((p) => p.estado === 'nuevo').length;
  const porEntregar = pedidos.filter((p) => p.estado === 'confirmado').length;
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const ventasMes = pedidos
    .filter((p) => ['confirmado', 'entregado'].includes(p.estado) && new Date(p.creado) >= inicioMes)
    .reduce((s, p) => s + p.total, 0);
  $('#contador-pedidos').textContent = nuevos;
  $('#contador-pedidos').hidden = !nuevos;
  $('#resumen-pedidos').innerHTML = `
    <button class="dato dato-alerta" data-ver-estado="nuevo"><strong>${nuevos}</strong><span>Nuevos por revisar</span></button>
    <button class="dato" data-ver-estado="confirmado"><strong>${porEntregar}</strong><span>Confirmados por entregar</span></button>
    <div class="dato"><strong>${dinero(ventasMes)}</strong><span>Vendido este mes (confirmados y entregados)</span></div>
    <div class="dato"><strong>${pedidos.length}</strong><span>Pedidos en total</span></div>`;

  const q = normalizar(filtrosPedidos.q.trim());
  const lista = pedidos.filter((p) =>
    (!filtrosPedidos.estado || p.estado === filtrosPedidos.estado) &&
    (!q || normalizar(`${p.folio} ${p.cliente.nombre} ${p.cliente.telefono}`).includes(q)));

  $('#tabla-pedidos').innerHTML = lista.length ? lista.map((p) => `
    <tr class="${p.estado === 'nuevo' ? 'fila-nueva' : ''}">
      <td><strong>${esc(p.folio)}</strong></td>
      <td>${fecha(p.creado)}</td>
      <td><strong>${esc(p.cliente.nombre)}</strong><span class="texto-suave">${telefonoBonito(esc(p.cliente.telefono))}</span></td>
      <td>${p.entrega === 'tienda' ? 'Recoge en tienda' : `Envío · ${esc(p.cliente.municipio)}`}</td>
      <td><strong>${dinero(p.total)}</strong><span class="texto-suave">${p.articulos.reduce((s, a) => s + a.cant, 0)} pza.</span></td>
      <td>${etiquetaEstado(p.estado)}</td>
      <td><div class="acciones"><button class="btn btn-claro btn-chico" data-ver-pedido="${p.id}">Ver</button></div></td>
    </tr>`).join('')
    : `<tr><td colspan="7" class="vacio">${pedidos.length ? 'No hay pedidos que coincidan.' : 'Todavía no hay pedidos. Aparecerán aquí cuando un cliente compre en la tienda.'}</td></tr>`;
}

function renderDetallePedido() {
  const p = pedidoAbierto;
  const c = p.cliente;
  const mensaje = `¡Hola, ${c.nombre}! Te escribimos de Zapatería Brazil sobre tu pedido ${p.folio}.`;
  const acciones = {
    nuevo: `
      <button class="btn btn-claro" data-estado-pedido="cancelado">Cancelar pedido</button>
      <button class="btn btn-verde" data-estado-pedido="confirmado">Confirmar y descontar inventario</button>`,
    confirmado: `
      <button class="btn btn-claro" data-estado-pedido="cancelado">Cancelar y regresar inventario</button>
      <button class="btn btn-verde" data-estado-pedido="entregado">Marcar como entregado</button>`,
  }[p.estado] || '';

  $('#detalle-pedido').innerHTML = `
    <button type="button" class="cerrar" data-cerrar aria-label="Cerrar">&times;</button>
    <h2 id="titulo-pedido">Pedido ${esc(p.folio)} ${etiquetaEstado(p.estado)}</h2>
    <p class="texto-suave">${fecha(p.creado)}</p>

    <div class="pedido-columnas">
      <div>
        <h3>Cliente</h3>
        <p><strong>${esc(c.nombre)}</strong><br>${telefonoBonito(esc(c.telefono))}</p>
        <p class="pedido-contacto">
          <a class="btn btn-verde btn-chico" href="https://wa.me/52${esc(c.telefono)}?text=${encodeURIComponent(mensaje)}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn btn-claro btn-chico" href="tel:+52${esc(c.telefono)}">Llamar</a>
        </p>
      </div>
      <div>
        <h3>Entrega</h3>
        ${p.entrega === 'tienda'
          ? '<p><strong>Recoge en tienda</strong></p>'
          : `<p><strong>Envío a domicilio</strong><br>${esc(c.calle)}, ${esc(c.colonia)}<br>C.P. ${esc(c.cp)}, ${esc(c.municipio)}, ${esc(c.estado)}
              ${c.referencias ? `<br><span class="texto-suave">Ref.: ${esc(c.referencias)}</span>` : ''}</p>`}
      </div>
    </div>
    ${p.notas ? `<p class="pedido-notas"><strong>Notas del cliente:</strong> ${esc(p.notas)}</p>` : ''}

    <table class="tabla-pedido">
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
      <tbody>
        ${p.articulos.map((a) => `
          <tr>
            <td><strong>${esc(a.nombre)}</strong><span class="texto-suave">${esc(a.variante)}${a.talla ? ` · Talla ${esc(a.talla)}` : ''}</span></td>
            <td>${a.cant}</td><td>${dinero(a.precio)}</td><td>${dinero(a.precio * a.cant)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="3">Subtotal</td><td>${dinero(p.subtotal)}</td></tr>
        <tr><td colspan="3">${p.entrega === 'tienda' ? 'Recoger en tienda' : 'Envío'}</td><td>${p.envio ? dinero(p.envio) : 'Gratis'}</td></tr>
        <tr class="total"><td colspan="3">Total</td><td>${dinero(p.total)}</td></tr>
      </tfoot>
    </table>

    <p class="texto-suave">
      ${p.inventarioDescontado ? 'El inventario de este pedido ya se descontó.' : p.estado === 'nuevo' ? 'Al confirmar, las piezas se descuentan del inventario.' : 'Este pedido no tiene inventario descontado.'}
      Historial: ${p.historial.map((h) => `${ESTADOS_PEDIDO[h.estado]} (${fecha(h.fecha)})`).join(' → ')}
    </p>
    <p class="error" id="pedido-error" role="alert"></p>
    ${acciones ? `<div class="confirmar-acciones">${acciones}</div>` : ''}`;
}

$('#pedidos').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.id === 'btn-actualizar-pedidos') return cargarPedidos().then(() => toast('Pedidos actualizados'));
  if (el.dataset.verEstado) {
    filtrosPedidos.estado = filtrosPedidos.estado === el.dataset.verEstado ? '' : el.dataset.verEstado;
    $('#filtro-estado').value = filtrosPedidos.estado;
    return renderPedidos();
  }
  if (el.dataset.verPedido) {
    pedidoAbierto = pedidos.find((p) => p.id === Number(el.dataset.verPedido));
    renderDetallePedido();
    $('#modal-pedido').showModal();
  }
});

$('#buscar-pedido').addEventListener('input', (e) => { filtrosPedidos.q = e.target.value; renderPedidos(); });
$('#filtro-estado').addEventListener('change', (e) => { filtrosPedidos.estado = e.target.value; renderPedidos(); });

$('#modal-pedido').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-estado-pedido]');
  if (!el) return;
  const estado = el.dataset.estadoPedido;
  if (estado === 'cancelado' && !confirm(`¿Cancelar el pedido ${pedidoAbierto.folio}?`)) return;
  el.disabled = true;
  try {
    const actualizado = await api(`/api/pedidos/${pedidoAbierto.id}/estado`, { metodo: 'POST', datos: { estado } });
    pedidos = pedidos.map((p) => (p.id === actualizado.id ? actualizado : p));
    pedidoAbierto = actualizado;
    renderPedidos();
    renderDetallePedido();
    toast(`Pedido ${actualizado.folio}: ${ESTADOS_PEDIDO[estado].toLowerCase()}`);
    if (estado !== 'entregado') await recargarTodo(); // el inventario cambió
  } catch (err) {
    $('#pedido-error').textContent = err.message;
    el.disabled = false;
  }
});

// ---------- Sesión y contraseña ----------
$('#btn-salir').addEventListener('click', async () => {
  if (sinGuardar && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
  sinGuardar = false;
  await api('/api/logout', { metodo: 'POST' }).catch(() => {});
  mostrarAcceso(true);
});

$('#btn-password').addEventListener('click', () => {
  $('#form-password').reset();
  $('#pass-error').textContent = '';
  $('#modal-password').showModal();
});

$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const actual = $('#pass-actual').value;
  const nueva = $('#pass-nueva').value;
  try {
    if (nueva.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
    if (nueva !== $('#pass-confirmar').value) throw new Error('Las contraseñas no coinciden');
    await api('/api/cambiar-password', { metodo: 'POST', datos: { actual, nueva } });
    $('#modal-password').close();
    toast('Contraseña actualizada');
  } catch (err) {
    $('#pass-error').textContent = err.message;
  }
});

// Cerrar diálogos con el botón × o al hacer clic en el fondo oscuro
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-cerrar]')) return e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG') {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (sinGuardar && !$('#editor').hidden) e.preventDefault();
});

// ---------- Inicio ----------
(async function iniciar() {
  try {
    const sesion = await api('/api/sesion');
    if (!sesion.autenticado) return mostrarAcceso(sesion.configurado);
    await entrarAlPanel();
  } catch {
    document.body.insertAdjacentHTML('beforeend',
      '<p class="vacio">No se pudo conectar con el servidor. ¿Está corriendo <code>node server.js</code>?</p>');
  }
})();
