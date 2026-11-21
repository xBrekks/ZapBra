'use strict';
/*
 * Cálculos del tablero del panel. Son funciones puras (no tocan la pantalla), así se pueden
 * probar con `npm test` y tablero.js solo se encarga de dibujar.
 * Las fechas se manejan en la hora local del navegador, que es la de la tienda.
 */
const CalculosTablero = (() => {
  const ESTADOS_VENTA = ['confirmado', 'entregado']; // un pedido cuenta como venta cuando ya se confirmó
  const POCAS_PIEZAS = 2; // en el mapa de tallas, 1 o 2 piezas se marcan como "poca"
  const SIN_TALLA = 'Sin talla'; // columna del mapa para productos que no se venden por talla
  const ORDEN_TALLAS_ROPA = ['XCH', 'CH', 'M', 'G', 'XG'];

  const esVenta = (p) => ESTADOS_VENTA.includes(p.estado);
  const inicioDelDia = (f) => new Date(f.getFullYear(), f.getMonth(), f.getDate());
  const sumarDias = (f, n) => {
    const d = new Date(f);
    d.setDate(d.getDate() + n);
    return d;
  };
  const diasEntre = (a, b) => Math.round((inicioDelDia(b) - inicioDelDia(a)) / 86400000);
  const enRango = (p, inicio, fin) => {
    const t = new Date(p.creado);
    return t >= inicio && t <= fin;
  };
  const normalizar = (s) =>
    String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const mayusculaInicial = (s) => s.replace(/(^|\s)(\p{Ll})/gu, (_, espacio, letra) => espacio + letra.toUpperCase());

  const precioDe = (p, v) => v.precio ?? p.precioOferta ?? p.precio;
  const stockVariante = (v) => (typeof v.stock === 'number' ? v.stock : Object.values(v.stock).reduce((a, b) => a + b, 0));
  const stockTotal = (p) => p.variantes.reduce((s, v) => s + stockVariante(v), 0);
  const mapaProductos = (catalogo) => new Map(catalogo.productos.map((p) => [p.id, p]));

  function ordenTallas(a, b) {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    const ra = ORDEN_TALLAS_ROPA.indexOf(a);
    const rb = ORDEN_TALLAS_ROPA.indexOf(b);
    if (ra !== -1 && rb !== -1) return ra - rb;
    if (ra !== -1) return -1;
    if (rb !== -1) return 1;
    return String(a).localeCompare(String(b), 'es');
  }

  // Costo de una pieza vendida: el que se guardó con el pedido o, en pedidos anteriores
  // a que existiera el costo, el costo actual del producto.
  function costoDe(articulo, productos) {
    if (articulo.costo != null) return articulo.costo;
    const p = productos.get(articulo.id);
    const v = p?.variantes.find((x) => x.nombre === articulo.variante);
    return v?.costo ?? p?.costo ?? null;
  }

  // El periodo elegido y el anterior del mismo largo, para comparar.
  function rangoPeriodo(periodo, ahora = new Date()) {
    const hoy = inicioDelDia(ahora);
    if (periodo === 'hoy') {
      return {
        inicio: hoy, fin: ahora, anteriorInicio: sumarDias(hoy, -1), anteriorFin: sumarDias(ahora, -1),
        unidad: 'hora', comparacion: 'ayer a esta hora',
      };
    }
    if (periodo === '7d' || periodo === '30d') {
      const dias = periodo === '7d' ? 7 : 30;
      const inicio = sumarDias(hoy, -(dias - 1));
      return {
        inicio, fin: ahora, anteriorInicio: sumarDias(inicio, -dias), anteriorFin: sumarDias(ahora, -dias),
        unidad: 'dia', comparacion: `los ${dias} días anteriores`,
      };
    }
    // Este mes: del día 1 a hoy, contra los mismos días del mes pasado.
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const ultimoDiaAnterior = new Date(ahora.getFullYear(), ahora.getMonth(), 0).getDate();
    const anteriorFin = new Date(ahora.getFullYear(), ahora.getMonth() - 1, Math.min(ahora.getDate(), ultimoDiaAnterior),
      ahora.getHours(), ahora.getMinutes(), ahora.getSeconds(), ahora.getMilliseconds());
    return {
      inicio, fin: ahora, anteriorInicio: new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1), anteriorFin,
      unidad: 'dia', comparacion: 'los mismos días del mes pasado',
    };
  }

  // Cambio contra el periodo anterior: 0.12 = +12 %, 'nuevo' si antes era 0, null si los dos son 0.
  function cambio(actual, anterior) {
    if (!anterior) return actual ? 'nuevo' : null;
    return (actual - anterior) / anterior;
  }

  function resumenVentas(pedidos, inicio, fin, catalogo) {
    const productos = mapaProductos(catalogo);
    const creados = pedidos.filter((p) => enRango(p, inicio, fin));
    const r = {
      vendido: 0, envios: 0, pedidos: 0, piezas: 0,
      ganancia: 0, ventaConCosto: 0, piezasConCosto: 0,
      creados: creados.length,
      porConfirmar: creados.filter((p) => p.estado === 'nuevo').length,
      cancelados: creados.filter((p) => p.estado === 'cancelado').length,
      entrega: { envio: { pedidos: 0, vendido: 0 }, tienda: { pedidos: 0, vendido: 0 } },
    };
    for (const p of creados.filter(esVenta)) {
      r.pedidos += 1;
      r.vendido += p.total;
      r.envios += p.envio;
      const entrega = r.entrega[p.entrega === 'tienda' ? 'tienda' : 'envio'];
      entrega.pedidos += 1;
      entrega.vendido += p.total;
      for (const a of p.articulos) {
        r.piezas += a.cant;
        const costo = costoDe(a, productos);
        if (costo != null) {
          r.ganancia += (a.precio - costo) * a.cant;
          r.ventaConCosto += a.precio * a.cant;
          r.piezasConCosto += a.cant;
        }
      }
    }
    r.ticket = r.pedidos ? r.vendido / r.pedidos : 0;
    r.margen = r.ventaConCosto ? r.ganancia / r.ventaConCosto : null;
    r.tasaCancelacion = r.creados ? r.cancelados / r.creados : 0;
    return r;
  }

  // Ventas por hora (hoy) o por día (los demás periodos), incluyendo los días sin ventas.
  function serieVentas(pedidos, { inicio, fin, unidad }) {
    const cubetas = [];
    if (unidad === 'hora') {
      for (let h = 0; h <= fin.getHours(); h++) {
        cubetas.push({ inicio: new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), h), vendido: 0, pedidos: 0 });
      }
    } else {
      for (let d = inicioDelDia(inicio); d <= fin; d = sumarDias(d, 1)) cubetas.push({ inicio: d, vendido: 0, pedidos: 0 });
    }
    for (const p of pedidos) {
      if (!esVenta(p) || !enRango(p, inicio, fin)) continue;
      const t = new Date(p.creado);
      const cubeta = cubetas[unidad === 'hora' ? t.getHours() : diasEntre(inicio, t)];
      if (cubeta) {
        cubeta.vendido += p.total;
        cubeta.pedidos += 1;
      }
    }
    return cubetas;
  }

  // Recorre cada pieza vendida dentro del periodo.
  function cadaArticuloVendido(pedidos, inicio, fin, fn) {
    for (const p of pedidos) {
      if (!esVenta(p) || !enRango(p, inicio, fin)) continue;
      for (const a of p.articulos) fn(a, p);
    }
  }

  function topProductos(pedidos, inicio, fin, cuantos = 7) {
    const porId = new Map();
    cadaArticuloVendido(pedidos, inicio, fin, (a) => {
      const r = porId.get(a.id) || { id: a.id, nombre: a.nombre, piezas: 0, dinero: 0 };
      r.piezas += a.cant;
      r.dinero += a.precio * a.cant;
      porId.set(a.id, r);
    });
    return [...porId.values()].sort((x, y) => y.piezas - x.piezas || y.dinero - x.dinero).slice(0, cuantos);
  }

  function ventasPorTalla(pedidos, inicio, fin) {
    const porTalla = new Map();
    cadaArticuloVendido(pedidos, inicio, fin, (a) => {
      if (a.talla) porTalla.set(a.talla, (porTalla.get(a.talla) || 0) + a.cant);
    });
    return [...porTalla].map(([talla, piezas]) => ({ talla, piezas })).sort((x, y) => ordenTallas(x.talla, y.talla));
  }

  function ventasPorCategoria(pedidos, inicio, fin, catalogo) {
    const productos = mapaProductos(catalogo);
    const nombres = new Map(catalogo.categorias.map((c) => [c.id, c.nombre]));
    const porCategoria = new Map();
    let total = 0;
    cadaArticuloVendido(pedidos, inicio, fin, (a) => {
      const id = productos.get(a.id)?.categoria;
      const clave = nombres.has(id) ? id : '_otros';
      const r = porCategoria.get(clave) || { id: clave, nombre: nombres.get(id) || 'Productos eliminados', dinero: 0, piezas: 0 };
      r.dinero += a.precio * a.cant;
      r.piezas += a.cant;
      total += a.precio * a.cant;
      porCategoria.set(clave, r);
    });
    return [...porCategoria.values()]
      .map((r) => ({ ...r, parte: total ? r.dinero / total : 0 }))
      .sort((x, y) => y.dinero - x.dinero);
  }

  // De dónde compran: "Recogen en tienda" o el municipio de envío (escrito por el cliente, se agrupa sin
  // importar mayúsculas ni acentos). Los municipios después de los primeros se juntan en "Otros municipios".
  function ventasPorZona(pedidos, inicio, fin, cuantos = 6) {
    const zonas = new Map();
    for (const p of pedidos) {
      if (!esVenta(p) || !enRango(p, inicio, fin)) continue;
      const enTienda = p.entrega === 'tienda';
      const escrito = String(p.cliente?.municipio ?? '').trim();
      const clave = enTienda ? '_tienda' : normalizar(escrito) || '_sin_dato';
      const z = zonas.get(clave) || { clave, pedidos: 0, vendido: 0, escrituras: new Map() };
      z.pedidos += 1;
      z.vendido += p.total;
      if (!enTienda && escrito) z.escrituras.set(escrito, (z.escrituras.get(escrito) || 0) + 1);
      zonas.set(clave, z);
    }
    const lista = [...zonas.values()].map((z) => {
      let nombre = 'Recogen en tienda';
      if (z.clave === '_sin_dato') nombre = 'Sin municipio';
      else if (z.clave !== '_tienda') {
        // La forma más común en que la escribieron, con mayúscula inicial
        nombre = mayusculaInicial([...z.escrituras].sort((x, y) => y[1] - x[1])[0][0].toLowerCase());
      }
      return { nombre, pedidos: z.pedidos, vendido: z.vendido };
    }).sort((x, y) => y.pedidos - x.pedidos || y.vendido - x.vendido);
    if (lista.length <= cuantos) return lista;
    const resto = lista.slice(cuantos - 1);
    return [...lista.slice(0, cuantos - 1), {
      nombre: `Otros ${resto.length} municipios`,
      pedidos: resto.reduce((s, z) => s + z.pedidos, 0),
      vendido: resto.reduce((s, z) => s + z.vendido, 0),
    }];
  }

  function resumenInventario(catalogo, umbralBajo = 5) {
    const r = { modelos: catalogo.productos.length, piezas: 0, valorVenta: 0, inversion: 0, piezasConCosto: 0, agotados: 0, bajos: 0 };
    for (const p of catalogo.productos) {
      const total = stockTotal(p);
      r.piezas += total;
      if (total === 0) r.agotados += 1;
      else if (total <= umbralBajo) r.bajos += 1;
      for (const v of p.variantes) {
        const n = stockVariante(v);
        r.valorVenta += n * precioDe(p, v);
        const costo = v.costo ?? p.costo;
        if (costo != null) {
          r.inversion += n * costo;
          r.piezasConCosto += n;
        }
      }
    }
    return r;
  }

  // Inventario de una categoría por modelo, color y talla. Una celda null = esa talla no se maneja.
  function mapaTallas(catalogo, categoriaId) {
    const productos = catalogo.productos.filter((p) => p.categoria === categoriaId);
    const tallas = [...new Set(productos.flatMap((p) => p.tallas || []))].sort(ordenTallas);
    const columnas = productos.some((p) => !p.tallas) ? [...tallas, SIN_TALLA] : tallas;
    const filas = productos.flatMap((p) => p.variantes.map((v) => {
      const celdas = columnas.map((t) => {
        if (t === SIN_TALLA) return p.tallas ? null : v.stock;
        return p.tallas?.includes(t) ? v.stock[t] || 0 : null;
      });
      return {
        id: p.id, producto: p.nombre, variante: v.nombre, hex: v.hex, celdas,
        total: stockVariante(v), agotadas: celdas.filter((n) => n === 0).length,
      };
    }));
    return { columnas, filas };
  }

  // Productos con inventario que no se han vendido en los últimos `dias` días (o nunca).
  // Primero los que tienen más dinero detenido.
  function sinVentas(pedidos, catalogo, dias = 30, ahora = new Date()) {
    const ultimaVenta = new Map();
    for (const p of pedidos) {
      if (!esVenta(p)) continue;
      const t = new Date(p.creado);
      for (const a of p.articulos) if (!(ultimaVenta.get(a.id) >= t)) ultimaVenta.set(a.id, t);
    }
    const limite = sumarDias(inicioDelDia(ahora), -dias);
    return catalogo.productos
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        piezas: stockTotal(p),
        valor: p.variantes.reduce((s, v) => s + stockVariante(v) * precioDe(p, v), 0),
        ultimaVenta: ultimaVenta.get(p.id) || null,
      }))
      .filter((r) => r.piezas > 0 && (!r.ultimaVenta || r.ultimaVenta < limite))
      .sort((a, b) => b.valor - a.valor);
  }

  // Clientes agrupados por teléfono. Cuentan como compras los pedidos confirmados o entregados.
  function clientes(pedidos) {
    const porTelefono = new Map();
    const ordenados = [...pedidos].sort((a, b) => new Date(a.creado) - new Date(b.creado));
    for (const p of ordenados) {
      const tel = p.cliente?.telefono;
      if (!tel || p.estado === 'cancelado') continue;
      const c = porTelefono.get(tel) || { telefono: tel, compras: 0, gastado: 0, porConfirmar: 0, primeraCompra: null, ultimoPedido: null, municipio: '' };
      c.nombre = p.cliente.nombre; // el más reciente
      if (p.cliente.municipio) c.municipio = p.cliente.municipio;
      c.ultimoPedido = p.creado;
      if (esVenta(p)) {
        c.compras += 1;
        c.gastado += p.total;
        c.primeraCompra ??= p.creado;
      } else {
        c.porConfirmar += 1;
      }
      porTelefono.set(tel, c);
    }
    return [...porTelefono.values()].sort((a, b) => b.gastado - a.gastado || new Date(b.ultimoPedido) - new Date(a.ultimoPedido));
  }

  function resumenClientes(lista) {
    const compradores = lista.filter((c) => c.compras > 0);
    const recurrentes = compradores.filter((c) => c.compras >= 2).length;
    const gastado = compradores.reduce((s, c) => s + c.gastado, 0);
    return {
      clientes: compradores.length,
      recurrentes,
      tasaRecompra: compradores.length ? recurrentes / compradores.length : 0,
      gastoPromedio: compradores.length ? gastado / compradores.length : 0,
    };
  }

  // Clientes cuya primera compra cayó dentro del periodo.
  const clientesNuevos = (lista, inicio, fin) =>
    lista.filter((c) => c.primeraCompra && new Date(c.primeraCompra) >= inicio && new Date(c.primeraCompra) <= fin).length;

  // Marcas redondas para el eje de una gráfica: 0, 250, 500, 750… (enteros si `entero`).
  function ticksLimpios(max, { cuantos = 4, entero = false } = {}) {
    if (!(max > 0)) return [0];
    const bruto = max / cuantos;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    let paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto);
    if (entero) paso = Math.max(1, Math.ceil(paso));
    const ticks = [];
    for (let i = 0; i * paso < max + paso; i++) {
      ticks.push(Math.round(i * paso * 1e6) / 1e6);
      if (i * paso >= max) break;
    }
    return ticks;
  }

  return {
    ESTADOS_VENTA, POCAS_PIEZAS, SIN_TALLA,
    rangoPeriodo, cambio, resumenVentas, serieVentas, topProductos, ventasPorTalla, ventasPorCategoria,
    ventasPorZona, resumenInventario, mapaTallas, sinVentas, clientes, resumenClientes, clientesNuevos,
    ticksLimpios, ordenTallas, normalizar,
  };
})();

if (typeof module !== 'undefined') module.exports = CalculosTablero;
