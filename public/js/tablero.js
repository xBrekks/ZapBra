'use strict';
// Tablero del panel: ventas, lo más vendido, inventario y clientes.
// Los números salen de tablero-calculos.js; aquí solo se dibujan. Usa las utilidades de admin.js.

const calc = CalculosTablero;
const PERIODOS = { hoy: 'Hoy', '7d': '7 días', '30d': '30 días', mes: 'Este mes' };
const CLAVE_PERIODO = 'zapateria-brazil-tablero-periodo';
const CLIENTES_POR_PAGINA = 25;

const estadoTablero = {
  periodo: (() => {
    try {
      const guardado = localStorage.getItem(CLAVE_PERIODO);
      return guardado in PERIODOS ? guardado : '30d';
    } catch {
      return '30d';
    }
  })(),
  categoriaMapa: null,
  soloAgotadas: false,
  buscarCliente: '',
  clientesVisibles: CLIENTES_POR_PAGINA,
  comoTabla: new Set(), // gráficas que se están viendo como tabla
};
let pedidosTablero = null;
let avisoTablero = '';
let contextoTablero = null; // periodo calculado y clientes, para los redibujos parciales

// ---------- Formatos ----------
const pesos = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const cifra = (n, decimales = 0) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: decimales }).format(n);
const porciento = (x) => `${Math.round(x * 100)}%`;
const plural = (n, uno, varios) => `${cifra(n)} ${n === 1 ? uno : varios}`;
const diaCorto = (d) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(d);
const diaLargo = (d) => new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const fechaSimple = (d) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(d));
// Eje en pesos: completo debajo de 10,000 y compacto (10K, 20K) cuando el eje llega ahí.
const pesosEje = (n, compacto) => (compacto && n ? `$${cifra(n / 1000, 1)}K` : pesos(n));
// Municipio como lo escribió el cliente, pero sin TODO MAYÚSCULAS ni todo minúsculas.
const municipioBonito = (s) =>
  s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|\s)(\p{Ll})/gu, (_, e, l) => e + l.toUpperCase()) : s;

// ---------- Carga y estructura ----------
async function cargarTablero() {
  const contenido = $('#tablero-contenido');
  contenido.classList.add('actualizando'); // mantiene lo anterior visible mientras llega lo nuevo
  try {
    pedidosTablero = await api('/api/pedidos?todos=1');
    avisoTablero = '';
  } catch (err) {
    // Sin pedidos (por ejemplo, si falta la tabla en Supabase) el inventario se muestra igual.
    pedidosTablero ??= [];
    avisoTablero = `No se pudieron cargar los pedidos: ${err.message}`;
  } finally {
    contenido.classList.remove('actualizando');
  }
  renderTablero();
}

function renderTablero() {
  if (!pedidosTablero) return;
  const enfocado = document.activeElement?.dataset?.periodo;
  const rango = calc.rangoPeriodo(estadoTablero.periodo);
  const actual = calc.resumenVentas(pedidosTablero, rango.inicio, rango.fin, catalogo);
  const anterior = calc.resumenVentas(pedidosTablero, rango.anteriorInicio, rango.anteriorFin, catalogo);
  const listaClientes = calc.clientes(pedidosTablero);
  contextoTablero = { rango, listaClientes };

  $('#tablero-contenido').innerHTML = `
    ${avisoTablero ? `<p class="aviso-tablero" role="alert">${esc(avisoTablero)}</p>` : ''}
    ${htmlPendientes()}

    <div class="tablero-filtros">
      <div class="segmentado" role="group" aria-label="Periodo">
        ${Object.entries(PERIODOS).map(([id, nombre]) =>
          `<button data-periodo="${id}" aria-pressed="${id === estadoTablero.periodo}">${nombre}</button>`).join('')}
      </div>
      <span class="texto-suave">Comparado con ${esc(rango.comparacion)} · solo pedidos de la tienda en línea</span>
    </div>

    <section class="tablero-seccion" aria-labelledby="t-ventas">
      <h2 id="t-ventas">Ventas</h2>
      <div class="kpis">${kpisVentas(actual, anterior, listaClientes, rango)}</div>
      <div class="tablero-grid">
        ${tarjetaGrafica('ventas', rango.unidad === 'hora' ? 'Ventas por hora' : 'Ventas por día', 'Pedidos confirmados y entregados')}
        <div class="tarjeta-grafica">
          <div class="tg-encabezado"><span><strong>Cómo se entregan</strong><span class="texto-suave">Pedidos vendidos en el periodo</span></span></div>
          ${htmlEntrega(actual)}
        </div>
      </div>
    </section>

    <section class="tablero-seccion" aria-labelledby="t-top">
      <h2 id="t-top">Lo más vendido</h2>
      <div class="tablero-grid tablero-grid-2">
        <div class="tarjeta-grafica">
          <div class="tg-encabezado"><span><strong>Productos</strong><span class="texto-suave">Por piezas vendidas</span></span></div>
          ${listaBarras(calc.topProductos(pedidosTablero, rango.inicio, rango.fin), {
            valor: (f) => f.piezas, cifra: (f) => plural(f.piezas, 'pieza', 'piezas'), detalle: (f) => pesos(f.dinero),
          })}
        </div>
        <div class="tarjeta-grafica">
          <div class="tg-encabezado"><span><strong>Categorías</strong><span class="texto-suave">Por dinero vendido</span></span></div>
          ${listaBarras(calc.ventasPorCategoria(pedidosTablero, rango.inicio, rango.fin, catalogo), {
            valor: (f) => f.dinero, cifra: (f) => pesos(f.dinero), detalle: (f) => `${porciento(f.parte)} · ${plural(f.piezas, 'pieza', 'piezas')}`,
          })}
        </div>
        ${tarjetaGrafica('tallas', 'Tallas', 'Piezas vendidas por talla')}
        <div class="tarjeta-grafica">
          <div class="tg-encabezado"><span><strong>De dónde te compran</strong><span class="texto-suave">Por número de pedidos</span></span></div>
          ${listaBarras(calc.ventasPorZona(pedidosTablero, rango.inicio, rango.fin), {
            valor: (f) => f.pedidos, cifra: (f) => plural(f.pedidos, 'pedido', 'pedidos'), detalle: (f) => pesos(f.vendido),
          })}
        </div>
      </div>
    </section>

    <section class="tablero-seccion" aria-labelledby="t-inventario">
      <div class="ts-encabezado"><h2 id="t-inventario">Inventario</h2><span class="texto-suave">Cómo está hoy; no depende del periodo</span></div>
      <div class="kpis">${kpisInventario()}</div>
      <div class="tarjeta-grafica">
        <div class="tg-encabezado">
          <span><strong>Mapa de tallas</strong><span class="texto-suave">Piezas por modelo, color y talla</span></span>
          <label class="check"><input type="checkbox" data-solo-agotadas ${estadoTablero.soloAgotadas ? 'checked' : ''}> Solo modelos con tallas agotadas</label>
        </div>
        <div id="mapa-tallas"></div>
      </div>
      <div class="tarjeta-grafica">${htmlSinVentas()}</div>
    </section>

    <section class="tablero-seccion" aria-labelledby="t-clientes">
      <div class="ts-encabezado"><h2 id="t-clientes">Clientes</h2><span class="texto-suave">Desde el primer pedido; no depende del periodo</span></div>
      <div class="kpis">${kpisClientes(listaClientes)}</div>
      <div class="tarjeta-grafica">
        <div class="tg-encabezado">
          <span><strong>Tus clientes</strong><span class="texto-suave">Primero los que más te han comprado</span></span>
          <input type="search" class="buscar-cliente" data-buscar-cliente value="${esc(estadoTablero.buscarCliente)}"
            placeholder="Buscar por nombre o teléfono…" aria-label="Buscar clientes">
        </div>
        <div id="tabla-clientes"></div>
      </div>
    </section>`;

  dibujarGraficas();
  renderMapaTallas();
  renderTablaClientes();
  if (enfocado) $(`[data-periodo="${enfocado}"]`)?.focus();
}

function htmlPendientes() {
  const nuevos = pedidosTablero.filter((p) => p.estado === 'nuevo').length;
  const porEntregar = pedidosTablero.filter((p) => p.estado === 'confirmado').length;
  if (!nuevos && !porEntregar) return '';
  const partes = [
    nuevos && plural(nuevos, 'pedido nuevo por revisar', 'pedidos nuevos por revisar'),
    porEntregar && plural(porEntregar, 'pedido por entregar', 'pedidos por entregar'),
  ].filter(Boolean);
  return `
    <div class="pendientes-tablero" role="status">
      <span>Tienes <strong>${partes.join('</strong> y <strong>')}</strong>.</span>
      <button class="btn btn-verde btn-chico" data-ir-pedidos>Ver pedidos</button>
    </div>`;
}

// ---------- Tarjetas de cifras ----------
// La flecha y el color dicen si subió o bajó y si eso es bueno; el texto lo repite para quien no ve el color.
function htmlCambio(x, comparacion, subeEsBueno) {
  if (x === null || (typeof x === 'number' && Math.round(x * 100) === 0)) {
    return `<span class="kpi-cambio">Sin cambio <span class="kpi-vs">vs ${esc(comparacion)}</span></span>`;
  }
  const sube = x === 'nuevo' || x > 0;
  const clase = sube === subeEsBueno ? 'bien' : 'mal';
  const flecha = `<span aria-hidden="true">${sube ? '▲' : '▼'}</span><span class="solo-lectores">${sube ? 'Sube' : 'Baja'}</span>`;
  if (x === 'nuevo') return `<span class="kpi-cambio ${clase}">${flecha} Nuevo <span class="kpi-vs">· en ${esc(comparacion)} fue 0</span></span>`;
  return `<span class="kpi-cambio ${clase}">${flecha} ${Math.round(Math.abs(x) * 100)}% <span class="kpi-vs">vs ${esc(comparacion)}</span></span>`;
}

// `cambio` undefined = la tarjeta no se compara con otro periodo.
function kpi(etiqueta, valor, { cambio, comparacion = '', subeEsBueno = true, nota = '' } = {}) {
  return `
    <div class="kpi">
      <span class="kpi-etiqueta">${etiqueta}</span>
      <span class="kpi-valor">${valor}</span>
      ${cambio === undefined ? '' : htmlCambio(cambio, comparacion, subeEsBueno)}
      ${nota ? `<span class="kpi-nota">${nota}</span>` : ''}
    </div>`;
}

function kpisVentas(a, b, listaClientes, rango) {
  const comparacion = rango.comparacion;
  const nuevos = calc.clientesNuevos(listaClientes, rango.inicio, rango.fin);
  const nuevosAntes = calc.clientesNuevos(listaClientes, rango.anteriorInicio, rango.anteriorFin);
  const conCosto = a.piezasConCosto > 0;
  return [
    kpi('Vendido', pesos(a.vendido), {
      cambio: calc.cambio(a.vendido, b.vendido), comparacion,
      nota: a.envios ? `Incluye ${pesos(a.envios)} de envíos` : '',
    }),
    kpi('Pedidos vendidos', cifra(a.pedidos), {
      cambio: calc.cambio(a.pedidos, b.pedidos), comparacion,
      nota: a.porConfirmar ? `Y ${plural(a.porConfirmar, 'pedido', 'pedidos')} sin confirmar` : '',
    }),
    kpi('Ticket promedio', pesos(a.ticket), { cambio: calc.cambio(a.ticket, b.ticket), comparacion }),
    kpi('Piezas vendidas', cifra(a.piezas), { cambio: calc.cambio(a.piezas, b.piezas), comparacion }),
    conCosto
      ? kpi('Ganancia estimada', pesos(a.ganancia), {
        cambio: calc.cambio(a.ganancia, b.ganancia), comparacion,
        nota: `Margen ${porciento(a.margen)}${a.piezasConCosto < a.piezas ? ` · con el costo de ${porciento(a.piezasConCosto / a.piezas)} de las piezas` : ''}`,
      })
      : kpi('Ganancia estimada', '—', {
        nota: '<button class="enlace" data-ir-productos>Agrega el costo de tus productos</button> para verla',
      }),
    kpi('Clientes nuevos', cifra(nuevos), {
      cambio: calc.cambio(nuevos, nuevosAntes), comparacion, nota: 'Su primera compra fue en el periodo',
    }),
    kpi('Cancelados', cifra(a.cancelados), {
      cambio: calc.cambio(a.cancelados, b.cancelados), comparacion, subeEsBueno: false,
      nota: a.creados ? `${porciento(a.tasaCancelacion)} de los pedidos del periodo` : '',
    }),
  ].join('');
}

function kpisInventario() {
  const r = calc.resumenInventario(catalogo, STOCK_BAJO);
  let notaInversion = '<button class="enlace" data-ir-productos>Agrega el costo de tus productos</button> para verla';
  if (r.piezasConCosto) {
    notaInversion = r.piezasConCosto < r.piezas
      ? `Con el costo de ${porciento(r.piezasConCosto / r.piezas)} de las piezas`
      : 'Lo que te costó la mercancía que tienes';
  }
  return [
    kpi('Mercancía a precio de venta', pesos(r.valorVenta), { nota: 'Lo que valdría si vendieras todo' }),
    kpi('Inversión en mercancía', r.piezasConCosto ? pesos(r.inversion) : '—', { nota: notaInversion }),
    kpi('Piezas en inventario', cifra(r.piezas), { nota: `En ${plural(r.modelos, 'modelo', 'modelos')}` }),
    kpi('Modelos agotados', cifra(r.agotados), {
      nota: r.bajos ? `Y ${plural(r.bajos, 'modelo', 'modelos')} con ${STOCK_BAJO} piezas o menos` : `Ningún modelo con ${STOCK_BAJO} piezas o menos`,
    }),
  ].join('');
}

function kpisClientes(lista) {
  const r = calc.resumenClientes(lista);
  return [
    kpi('Clientes', cifra(r.clientes), { nota: 'Con al menos una compra' }),
    kpi('Compran más de una vez', cifra(r.recurrentes), { nota: r.clientes ? `${porciento(r.tasaRecompra)} de tus clientes` : '' }),
    kpi('Gasto promedio por cliente', pesos(r.gastoPromedio), { nota: 'Sumando todas sus compras' }),
  ].join('');
}

// ---------- Listas con barras (ranking) ----------
function listaBarras(filas, { valor, cifra: textoCifra, detalle }) {
  if (!filas.length) return '<p class="tg-vacio">Sin ventas en este periodo.</p>';
  const max = Math.max(...filas.map(valor));
  return `
    <ol class="lista-barras">
      ${filas.map((f) => `
        <li>
          <span class="lb-nombre">${esc(f.nombre)}</span>
          <span class="lb-barra" aria-hidden="true"><span style="width:${max ? Math.max(2, (valor(f) / max) * 100) : 0}%"></span></span>
          <span class="lb-cifras"><strong>${textoCifra(f)}</strong><span>${detalle(f)}</span></span>
        </li>`).join('')}
    </ol>`;
}

// ---------- Envío o tienda (una barra partida en dos) ----------
function htmlEntrega(r) {
  if (!r.pedidos) return '<p class="tg-vacio">Sin ventas en este periodo.</p>';
  const partes = [
    { clase: 'serie-1', nombre: 'Envío a domicilio', ...r.entrega.envio },
    { clase: 'serie-2', nombre: 'Recogen en tienda', ...r.entrega.tienda },
  ];
  const resumen = partes.map((p) => `${p.nombre}: ${porciento(p.pedidos / r.pedidos)}`).join(', ');
  return `
    <div class="barra-partes" role="img" aria-label="${esc(resumen)}">
      ${partes.filter((p) => p.pedidos).map((p) => `
        <span class="parte ${p.clase}" style="flex-grow:${p.pedidos}"
          data-tip-valor="${esc(porciento(p.pedidos / r.pedidos))}" data-tip-etiqueta="${esc(`${p.nombre} · ${plural(p.pedidos, 'pedido', 'pedidos')}`)}"></span>`).join('')}
    </div>
    <ul class="leyenda-partes">
      ${partes.map((p) => `
        <li>
          <span class="muestra ${p.clase}" aria-hidden="true"></span>
          <span>${p.nombre}</span>
          <span class="lb-cifras"><strong>${plural(p.pedidos, 'pedido', 'pedidos')}</strong><span>${porciento(p.pedidos / r.pedidos)} · ${pesos(p.vendido)}</span></span>
        </li>`).join('')}
    </ul>
    ${r.envios ? `<p class="tg-nota">Cobrado por envíos: ${pesos(r.envios)}</p>` : ''}`;
}

// ---------- Gráficas de columnas ----------
const tarjetaGrafica = (id, titulo, subtitulo) => `
  <figure class="tarjeta-grafica">
    <figcaption class="tg-encabezado">
      <span><strong>${titulo}</strong><span class="texto-suave">${subtitulo}</span></span>
      <button class="enlace" data-como-tabla="${id}">${estadoTablero.comoTabla.has(id) ? 'Ver gráfica' : 'Ver tabla'}</button>
    </figcaption>
    <div class="grafica" data-grafica="${id}"></div>
  </figure>`;

function dibujarGraficas() {
  if (!contextoTablero) return;
  const { rango } = contextoTablero;
  const porHora = rango.unidad === 'hora';
  const serie = calc.serieVentas(pedidosTablero, rango);
  const nombre = (c) => (porHora ? `${c.inicio.getHours()}:00` : diaCorto(c.inicio));
  dibujar('ventas', serie.map((c) => ({
    etiqueta: nombre(c),
    valor: c.vendido,
    tip: pesos(c.vendido),
    tipEtiqueta: `${porHora ? `De ${c.inicio.getHours()}:00 a ${c.inicio.getHours() + 1}:00` : diaLargo(c.inicio)} · ${plural(c.pedidos, 'pedido', 'pedidos')}`,
  })), {
    formatoEje: pesosEje,
    formatoValor: pesos,
    descripcion: `${porHora ? 'Ventas por hora' : 'Ventas por día'}: ${pesos(serie.reduce((s, c) => s + c.vendido, 0))} en total`,
    tabla: {
      columnas: [porHora ? 'Hora' : 'Día', 'Vendido', 'Pedidos'],
      filas: serie.map((c) => [nombre(c), pesos(c.vendido), cifra(c.pedidos)]),
    },
  });

  const tallas = calc.ventasPorTalla(pedidosTablero, rango.inicio, rango.fin);
  dibujar('tallas', tallas.map((t) => ({
    etiqueta: t.talla,
    valor: t.piezas,
    tip: plural(t.piezas, 'pieza', 'piezas'),
    tipEtiqueta: `Talla ${t.talla}`,
  })), {
    entero: true,
    formatoEje: (n) => cifra(n),
    formatoValor: (n) => cifra(n),
    descripcion: `Piezas vendidas por talla: ${tallas.map((t) => `talla ${t.talla}, ${t.piezas}`).join('; ')}`,
    tabla: { columnas: ['Talla', 'Piezas'], filas: tallas.map((t) => [t.talla, cifra(t.piezas)]) },
  });
}

function dibujar(id, datos, { formatoEje, formatoValor, entero = false, descripcion, tabla }) {
  const caja = $(`[data-grafica="${id}"]`);
  if (!caja) return;
  if (!datos.some((d) => d.valor > 0)) {
    caja.innerHTML = '<p class="tg-vacio">Sin ventas en este periodo.</p>';
  } else if (estadoTablero.comoTabla.has(id)) {
    caja.innerHTML = tablaDatos(tabla.columnas, tabla.filas);
  } else {
    caja.innerHTML = svgColumnas(datos, { ancho: caja.clientWidth, formatoEje, formatoValor, entero, descripcion });
  }
}

const tablaDatos = (columnas, filas) => `
  <div class="tabla-datos-envoltura">
    <table class="tabla-datos">
      <thead><tr>${columnas.map((c, i) => `<th scope="col"${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((f) => `<tr>${f.map((v, i) => (i ? `<td class="num">${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;

// Columna con la punta redondeada (4px) y la base recta.
function trazoColumna(x, base, grosor, alto) {
  const r = Math.min(4, alto, grosor / 2);
  const arriba = base - alto;
  return `M${x},${base} V${arriba + r} Q${x},${arriba} ${x + r},${arriba} H${x + grosor - r} Q${x + grosor},${arriba} ${x + grosor},${arriba + r} V${base} Z`;
}

function svgColumnas(datos, { ancho, alto = 220, formatoEje, formatoValor, entero, descripcion }) {
  const m = { arriba: 24, derecha: 8, abajo: 30, izquierda: 58 };
  const w = Math.max(ancho, 260);
  const anchoPlot = w - m.izquierda - m.derecha;
  const altoPlot = alto - m.arriba - m.abajo;
  const max = Math.max(...datos.map((d) => d.valor));
  const ticks = calc.ticksLimpios(max, { entero });
  const tope = ticks[ticks.length - 1];
  const compacto = tope >= 10000;
  const base = m.arriba + altoPlot;
  const y = (v) => base - (v / tope) * altoPlot;
  const banda = anchoPlot / datos.length;
  const grosor = Math.max(2, Math.min(24, banda - 2)); // 2px de aire entre columnas vecinas
  const cadaCuantas = Math.ceil(datos.length / Math.max(1, Math.floor(anchoPlot / 54))); // etiquetas que caben
  const iMax = datos.findIndex((d) => d.valor === max);

  let svg = `<svg class="svg-grafica" width="${w}" height="${alto}" viewBox="0 0 ${w} ${alto}" role="img" aria-label="${esc(descripcion)}">`;
  for (const t of ticks) {
    svg += `<line class="rejilla" x1="${m.izquierda}" x2="${w - m.derecha}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="eje" x="${m.izquierda - 8}" y="${y(t) + 4}" text-anchor="end">${esc(formatoEje(t, compacto))}</text>`;
  }
  svg += `<line class="base" x1="${m.izquierda}" x2="${w - m.derecha}" y1="${base}" y2="${base}"/>`;
  datos.forEach((d, i) => {
    const x = m.izquierda + i * banda + (banda - grosor) / 2;
    const h = (d.valor / tope) * altoPlot;
    svg += '<g class="col">';
    if (h > 0) svg += `<path class="columna" d="${trazoColumna(x, base, grosor, h)}"/>`;
    // La zona activa ocupa toda la franja de la columna: más fácil de señalar que la barra
    svg += `<rect class="zona" x="${m.izquierda + i * banda}" y="${m.arriba}" width="${banda}" height="${altoPlot}" tabindex="0"
      data-tip-valor="${esc(d.tip)}" data-tip-etiqueta="${esc(d.tipEtiqueta)}" aria-label="${esc(`${d.tipEtiqueta}: ${d.tip}`)}"/>`;
    svg += '</g>';
    if (i % cadaCuantas === 0) {
      svg += `<text class="eje" x="${x + grosor / 2}" y="${base + 18}" text-anchor="middle">${esc(d.etiqueta)}</text>`;
    }
    if (i === iMax) {
      svg += `<text class="dato" x="${x + grosor / 2}" y="${base - h - 7}" text-anchor="middle">${esc(formatoValor(d.valor))}</text>`;
    }
  });
  return `${svg}</svg>`;
}

// ---------- Mapa de tallas ----------
function renderMapaTallas() {
  const caja = $('#mapa-tallas');
  if (!caja) return;
  const categorias = catalogo.categorias.filter((c) => catalogo.productos.some((p) => p.categoria === c.id));
  if (!categorias.some((c) => c.id === estadoTablero.categoriaMapa)) estadoTablero.categoriaMapa = categorias[0]?.id ?? null;
  if (!estadoTablero.categoriaMapa) {
    caja.innerHTML = '<p class="tg-vacio">Todavía no hay productos.</p>';
    return;
  }
  const actual = estadoTablero.categoriaMapa;
  const { columnas, filas } = calc.mapaTallas(catalogo, actual);
  const visibles = estadoTablero.soloAgotadas ? filas.filter((f) => f.agotadas) : filas;
  const celda = (n, talla, f) => {
    if (n === null) return '<td class="na" title="Esta talla no se maneja">·</td>';
    const clase = n === 0 ? 'agotada' : n <= calc.POCAS_PIEZAS ? 'poca' : '';
    const donde = talla === calc.SIN_TALLA ? 'sin talla' : `talla ${talla}`;
    return `<td class="${clase}" data-tip-valor="${esc(plural(n, 'pieza', 'piezas'))}" data-tip-etiqueta="${esc(`${f.producto} · ${f.variante} · ${donde}`)}">${cifra(n)}</td>`;
  };

  caja.innerHTML = `
    <div class="chips mapa-categorias" role="group" aria-label="Categoría del mapa">
      ${categorias.map((c) => `<button class="chip ${c.id === actual ? 'activo' : ''}" data-mapa-categoria="${esc(c.id)}" aria-pressed="${c.id === actual}">${esc(c.nombre)}</button>`).join('')}
    </div>
    ${visibles.length ? `
    <div class="tabla-mapa-envoltura">
      <table class="tabla-mapa">
        <caption class="solo-lectores">Inventario por talla de ${esc(nombreCategoria(actual))}</caption>
        <thead><tr><th scope="col">Modelo y color</th>${columnas.map((t) => `<th scope="col">${esc(t)}</th>`).join('')}<th scope="col">Total</th></tr></thead>
        <tbody>
          ${visibles.map((f) => `
            <tr>
              <th scope="row"><span class="mapa-modelo"><span class="punto" style="--c:${esc(f.hex)}" aria-hidden="true"></span>
                <span>${esc(f.producto)}<span class="texto-suave">${esc(f.variante)}</span></span></span></th>
              ${f.celdas.map((n, i) => celda(n, columnas[i], f)).join('')}
              <td class="total">${cifra(f.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="leyenda-mapa">
      <span><span class="muestra-celda agotada">0</span> Agotada</span>
      <span><span class="muestra-celda poca">1–${calc.POCAS_PIEZAS}</span> Poca</span>
      <span><span class="muestra-celda">${calc.POCAS_PIEZAS + 1}+</span> Suficiente</span>
      <span><span class="muestra-celda na">·</span> No se maneja esa talla</span>
    </p>` : '<p class="tg-vacio">Ningún modelo de esta categoría tiene tallas agotadas.</p>'}`;
}

// ---------- Sin ventas ----------
function htmlSinVentas() {
  const lista = calc.sinVentas(pedidosTablero, catalogo, 30);
  const encabezado = `
    <div class="tg-encabezado"><span><strong>Sin ventas en los últimos 30 días</strong>
      <span class="texto-suave">Productos con inventario que no se han vendido en línea; primero los que tienen más dinero detenido. Buenos candidatos para una oferta.</span></span></div>`;
  if (!lista.length) return `${encabezado}<p class="tg-vacio">Todos tus productos con inventario se vendieron en los últimos 30 días.</p>`;
  const visibles = lista.slice(0, 10);
  return `${encabezado}
    <div class="tabla-envoltura">
      <table class="tabla-admin tabla-compacta">
        <thead><tr><th>Producto</th><th class="num">En inventario</th><th class="num">A precio de venta</th><th>Última venta</th></tr></thead>
        <tbody>
          ${visibles.map((p) => `
            <tr>
              <td><strong>${esc(p.nombre)}</strong></td>
              <td class="num">${plural(p.piezas, 'pieza', 'piezas')}</td>
              <td class="num">${pesos(p.valor)}</td>
              <td>${p.ultimaVenta ? fechaSimple(p.ultimaVenta) : 'Nunca'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${lista.length > visibles.length ? `<p class="tg-nota">Y ${plural(lista.length - visibles.length, 'producto más', 'productos más')}.</p>` : ''}`;
}

// ---------- Clientes ----------
function renderTablaClientes() {
  const caja = $('#tabla-clientes');
  if (!caja) return;
  const todos = contextoTablero.listaClientes;
  if (!todos.length) {
    caja.innerHTML = '<p class="tg-vacio">Aquí aparecerán tus clientes cuando lleguen pedidos.</p>';
    return;
  }
  const q = normalizar(estadoTablero.buscarCliente.trim());
  const digitos = q.replace(/\D/g, '');
  const lista = todos.filter((c) => !q || normalizar(c.nombre).includes(q) || (digitos && c.telefono.includes(digitos)));
  const visibles = lista.slice(0, estadoTablero.clientesVisibles);
  caja.innerHTML = `
    <div class="tabla-envoltura">
      <table class="tabla-admin tabla-compacta">
        <thead><tr><th>Cliente</th><th class="num">Compras</th><th class="num">Total gastado</th><th>Último pedido</th><th>Municipio</th><th><span class="solo-lectores">Contacto</span></th></tr></thead>
        <tbody>
          ${visibles.map((c) => `
            <tr>
              <td><strong>${esc(c.nombre)}</strong><span class="texto-suave">${telefonoBonito(esc(c.telefono))}</span></td>
              <td class="num">${cifra(c.compras)}${c.porConfirmar ? `<span class="texto-suave">+${cifra(c.porConfirmar)} sin confirmar</span>` : ''}</td>
              <td class="num">${pesos(c.gastado)}</td>
              <td>${fechaSimple(c.ultimoPedido)}</td>
              <td>${c.municipio ? esc(municipioBonito(c.municipio)) : '<span class="texto-suave">Recoge en tienda</span>'}</td>
              <td><a class="btn btn-claro btn-chico" href="https://wa.me/52${esc(c.telefono)}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(c.nombre)}">WhatsApp</a></td>
            </tr>`).join('') || '<tr><td colspan="6" class="vacio">Ningún cliente coincide con la búsqueda.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${lista.length > visibles.length ? `<button class="btn btn-claro btn-chico mas-clientes" data-mas-clientes>Mostrar más (${cifra(lista.length - visibles.length)} restantes)</button>` : ''}`;
}

// ---------- Tooltip (al pasar el mouse o al enfocar con el teclado) ----------
const tooltipTablero = document.createElement('div');
tooltipTablero.className = 'tooltip-tablero';
tooltipTablero.hidden = true;
tooltipTablero.append(document.createElement('strong'), document.createElement('span'));
document.body.append(tooltipTablero);

function mostrarTooltip(el, x, y) {
  // textContent: los nombres vienen de datos capturados por personas, nunca se insertan como HTML
  tooltipTablero.firstChild.textContent = el.dataset.tipValor;
  tooltipTablero.lastChild.textContent = el.dataset.tipEtiqueta;
  tooltipTablero.hidden = false;
  const { width, height } = tooltipTablero.getBoundingClientRect();
  tooltipTablero.style.left = `${Math.min(Math.max(8, x - width / 2), innerWidth - width - 8)}px`;
  tooltipTablero.style.top = `${y - height - 12 < 8 ? y + 18 : y - height - 12}px`;
}
const ocultarTooltip = () => { tooltipTablero.hidden = true; };

// ---------- Eventos ----------
const seccionTablero = $('#tablero');

seccionTablero.addEventListener('pointermove', (e) => {
  const el = e.target.closest('[data-tip-valor]');
  if (el) mostrarTooltip(el, e.clientX, e.clientY);
  else ocultarTooltip();
});
seccionTablero.addEventListener('pointerleave', ocultarTooltip);
seccionTablero.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip-valor]');
  if (!el) return ocultarTooltip();
  const r = el.getBoundingClientRect();
  mostrarTooltip(el, r.left + r.width / 2, r.top + 28);
});
seccionTablero.addEventListener('focusout', ocultarTooltip);
window.addEventListener('scroll', ocultarTooltip, { passive: true });

seccionTablero.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;
  if (el.id === 'btn-actualizar-tablero') return cargarTablero().then(() => toast('Tablero actualizado'));
  if (d.periodo) {
    estadoTablero.periodo = d.periodo;
    try { localStorage.setItem(CLAVE_PERIODO, d.periodo); } catch { /* sin almacenamiento */ }
    return renderTablero();
  }
  if (d.comoTabla) {
    const { comoTabla } = estadoTablero;
    if (comoTabla.has(d.comoTabla)) comoTabla.delete(d.comoTabla);
    else comoTabla.add(d.comoTabla);
    el.textContent = comoTabla.has(d.comoTabla) ? 'Ver gráfica' : 'Ver tabla';
    return dibujarGraficas();
  }
  if (d.mapaCategoria) {
    estadoTablero.categoriaMapa = d.mapaCategoria;
    renderMapaTallas();
    return $(`[data-mapa-categoria="${d.mapaCategoria}"]`)?.focus();
  }
  if (d.masClientes !== undefined) {
    estadoTablero.clientesVisibles += CLIENTES_POR_PAGINA;
    return renderTablaClientes();
  }
  if (d.irPedidos !== undefined) {
    mostrar('pedidos');
    return cargarPedidos();
  }
  if (d.irProductos !== undefined) return mostrar('listado');
});

seccionTablero.addEventListener('change', (e) => {
  if (e.target.dataset.soloAgotadas === undefined) return;
  estadoTablero.soloAgotadas = e.target.checked;
  renderMapaTallas();
});

seccionTablero.addEventListener('input', (e) => {
  if (e.target.dataset.buscarCliente === undefined) return;
  estadoTablero.buscarCliente = e.target.value;
  estadoTablero.clientesVisibles = CLIENTES_POR_PAGINA;
  renderTablaClientes();
});

// Las gráficas se dibujan al ancho de su tarjeta: al cambiar el tamaño de la ventana se vuelven a dibujar.
let temporizadorTablero;
window.addEventListener('resize', () => {
  clearTimeout(temporizadorTablero);
  temporizadorTablero = setTimeout(() => {
    if (!seccionTablero.hidden && pedidosTablero) dibujarGraficas();
  }, 150);
});
