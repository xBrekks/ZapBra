'use strict';
// Cálculos del tablero con datos fijos: así cada número que muestra el panel está comprobado.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../public/js/tablero-calculos.js');

const AHORA = new Date(2026, 10, 21, 15, 30); // sábado 21 de noviembre de 2026, 15:30 (hora local)
const fecha = (mes, dia, hora = 12) => new Date(2026, mes, dia, hora).toISOString();
const NOV = 10;
const OCT = 9;
const SEP = 8;

const catalogo = {
  categorias: [{ id: 'hombre', nombre: 'Hombre' }, { id: 'cuidado', nombre: 'Cuidado' }],
  productos: [
    {
      id: 'tenis', nombre: 'Tenis', categoria: 'hombre', precio: 1000, costo: 600, tallas: ['26', '27'],
      variantes: [
        { nombre: 'Negro', hex: '#111111', stock: { 26: 0, 27: 2 } },
        { nombre: 'Blanco', hex: '#ffffff', stock: { 26: 5, 27: 0 } },
      ],
    },
    {
      id: 'crema', nombre: 'Crema', categoria: 'cuidado', precio: 100,
      variantes: [
        { nombre: 'Neutro', hex: '#eeeeee', stock: 10 },
        { nombre: '300 ml', hex: '#dddddd', stock: 0, precio: 180, costo: 90 },
      ],
    },
    { id: 'botas', nombre: 'Botas', categoria: 'hombre', precio: 2000, tallas: ['27'], variantes: [{ nombre: 'Café', hex: '#663300', stock: { 27: 3 } }] },
  ],
};

function pedido(id, creado, estado, articulos, { entrega = 'tienda', envio = 0, nombre = 'Ana', telefono = '7770000001', municipio } = {}) {
  const subtotal = articulos.reduce((s, a) => s + a.precio * a.cant, 0);
  return {
    id, creado, estado, entrega, envio, subtotal, total: subtotal + envio, articulos,
    cliente: { nombre, telefono, ...(municipio && { municipio }) },
  };
}

const tenisNegro27 = { id: 'tenis', nombre: 'Tenis', variante: 'Negro', talla: '27', precio: 1000 };
const tenisBlanco26 = { id: 'tenis', nombre: 'Tenis', variante: 'Blanco', talla: '26', precio: 1000 };
const luis = { nombre: 'Luis', telefono: '7770000002' };

const pedidos = [
  pedido(1, fecha(NOV, 21, 10), 'entregado', [{ ...tenisNegro27, cant: 1, costo: 600 }]),
  pedido(2, fecha(NOV, 20), 'confirmado', [{ id: 'crema', nombre: 'Crema', variante: 'Neutro', precio: 100, cant: 2 }],
    { entrega: 'envio', envio: 149, ...luis, municipio: 'cuernavaca' }),
  pedido(3, fecha(NOV, 18), 'cancelado', [{ ...tenisNegro27, cant: 1 }]),
  pedido(4, fecha(NOV, 21, 14), 'nuevo', [{ ...tenisBlanco26, cant: 1 }], { nombre: 'Pepe', telefono: '7770000003' }),
  // Sin costo guardado (pedido viejo): se usa el costo actual del producto
  pedido(5, fecha(NOV, 10), 'entregado', [{ ...tenisBlanco26, cant: 2 }], { entrega: 'envio', ...luis, municipio: 'Cuernavaca ' }),
  // Periodo anterior; sin costo guardado: se usa el costo de la variante (90)
  pedido(6, fecha(OCT, 15), 'entregado', [{ id: 'crema', nombre: 'Crema', variante: '300 ml', precio: 180, cant: 1 }]),
  pedido(7, fecha(SEP, 1), 'entregado', [{ ...tenisNegro27, cant: 1 }]),
];

describe('Periodos', () => {
  test('hoy, 7 días, 30 días y este mes, cada uno contra su periodo anterior', () => {
    const hoy = calc.rangoPeriodo('hoy', AHORA);
    assert.deepEqual([hoy.inicio, hoy.anteriorInicio, hoy.anteriorFin],
      [new Date(2026, NOV, 21), new Date(2026, NOV, 20), new Date(2026, NOV, 20, 15, 30)]);
    assert.equal(hoy.unidad, 'hora');

    const siete = calc.rangoPeriodo('7d', AHORA);
    assert.deepEqual([siete.inicio, siete.anteriorInicio, siete.anteriorFin],
      [new Date(2026, NOV, 15), new Date(2026, NOV, 8), new Date(2026, NOV, 14, 15, 30)]);

    const treinta = calc.rangoPeriodo('30d', AHORA);
    assert.deepEqual([treinta.inicio, treinta.anteriorInicio, treinta.anteriorFin],
      [new Date(2026, OCT, 23), new Date(2026, SEP, 23), new Date(2026, OCT, 22, 15, 30)]);

    const mes = calc.rangoPeriodo('mes', AHORA);
    assert.deepEqual([mes.inicio, mes.anteriorInicio, mes.anteriorFin],
      [new Date(2026, NOV, 1), new Date(2026, OCT, 1), new Date(2026, OCT, 21, 15, 30)]);
  });

  test('"este mes" el 31 de marzo se compara contra el último día de febrero', () => {
    const r = calc.rangoPeriodo('mes', new Date(2026, 2, 31, 9, 0));
    assert.deepEqual(r.anteriorFin, new Date(2026, 1, 28, 9, 0));
  });

  test('cambio contra el periodo anterior', () => {
    assert.equal(calc.cambio(150, 100), 0.5);
    assert.equal(calc.cambio(50, 100), -0.5);
    assert.equal(calc.cambio(0, 0), null);
    assert.equal(calc.cambio(10, 0), 'nuevo');
  });
});

describe('Ventas', () => {
  const r = calc.rangoPeriodo('30d', AHORA);

  test('resumen: solo cuentan los pedidos confirmados y entregados', () => {
    const v = calc.resumenVentas(pedidos, r.inicio, r.fin, catalogo);
    assert.equal(v.vendido, 1000 + 349 + 2000);
    assert.equal(v.envios, 149);
    assert.equal(v.pedidos, 3);
    assert.equal(v.piezas, 5);
    assert.equal(v.ticket, 3349 / 3);
    assert.equal(v.creados, 5);
    assert.equal(v.porConfirmar, 1);
    assert.equal(v.cancelados, 1);
    assert.equal(v.tasaCancelacion, 0.2);
    assert.deepEqual(v.entrega, { envio: { pedidos: 2, vendido: 2349 }, tienda: { pedidos: 1, vendido: 1000 } });
  });

  test('ganancia: con el costo guardado o, si falta, el actual; las piezas sin costo no cuentan', () => {
    const v = calc.resumenVentas(pedidos, r.inicio, r.fin, catalogo);
    assert.equal(v.ganancia, 400 + 800); // la crema Neutro no tiene costo
    assert.equal(v.piezasConCosto, 3);
    assert.equal(v.margen, 0.4);
    const anterior = calc.resumenVentas(pedidos, r.anteriorInicio, r.anteriorFin, catalogo);
    assert.equal(anterior.vendido, 180);
    assert.equal(anterior.ganancia, 90, 'costo de la variante');
    assert.equal(anterior.margen, 0.5);
  });

  test('ventas por día (7 días) y por hora (hoy), con los días vacíos incluidos', () => {
    const dias = calc.serieVentas(pedidos, calc.rangoPeriodo('7d', AHORA));
    assert.equal(dias.length, 7);
    assert.deepEqual(dias.map((c) => c.vendido), [0, 0, 0, 0, 0, 349, 1000]);
    assert.deepEqual(dias[6].inicio, new Date(2026, NOV, 21));

    const horas = calc.serieVentas(pedidos, calc.rangoPeriodo('hoy', AHORA));
    assert.equal(horas.length, 16, 'de las 0:00 a las 15:00');
    assert.equal(horas[10].vendido, 1000);
    assert.equal(horas.reduce((s, c) => s + c.pedidos, 0), 1, 'el pedido nuevo de las 14:00 no es venta');

    assert.equal(calc.serieVentas(pedidos, calc.rangoPeriodo('mes', AHORA)).length, 21);
  });

  test('productos, tallas y categorías más vendidos', () => {
    assert.deepEqual(calc.topProductos(pedidos, r.inicio, r.fin), [
      { id: 'tenis', nombre: 'Tenis', piezas: 3, dinero: 3000 },
      { id: 'crema', nombre: 'Crema', piezas: 2, dinero: 200 },
    ]);
    assert.deepEqual(calc.ventasPorTalla(pedidos, r.inicio, r.fin), [{ talla: '26', piezas: 2 }, { talla: '27', piezas: 1 }]);
    const categorias = calc.ventasPorCategoria(pedidos, r.inicio, r.fin, catalogo);
    assert.deepEqual(categorias.map((c) => [c.nombre, c.dinero, c.piezas]), [['Hombre', 3000, 3], ['Cuidado', 200, 2]]);
    assert.equal(categorias[0].parte, 3000 / 3200);
  });

  test('un producto que ya se eliminó aparece como "Productos eliminados"', () => {
    const viejo = [pedido(9, fecha(NOV, 20), 'entregado', [{ id: 'ya-no-existe', nombre: 'Viejo', variante: 'X', precio: 50, cant: 1 }])];
    assert.equal(calc.ventasPorCategoria(viejo, r.inicio, r.fin, catalogo)[0].nombre, 'Productos eliminados');
  });

  test('de dónde compran: el municipio se agrupa sin importar mayúsculas ni espacios', () => {
    assert.deepEqual(calc.ventasPorZona(pedidos, r.inicio, r.fin), [
      { nombre: 'Cuernavaca', pedidos: 2, vendido: 2349 },
      { nombre: 'Recogen en tienda', pedidos: 1, vendido: 1000 },
    ]);
  });

  test('los municipios que no caben se juntan en "Otros"', () => {
    const muchos = ['Temixco', 'Jiutepec', 'Xochitepec', 'Emiliano Zapata', 'Yautepec', 'Cuautla', 'Jojutla', 'Tepoztlán']
      .map((m, i) => pedido(20 + i, fecha(NOV, 20), 'entregado', [{ ...tenisNegro27, cant: 1 }], { entrega: 'envio', municipio: m }));
    const zonas = calc.ventasPorZona(muchos, r.inicio, r.fin, 4);
    assert.equal(zonas.length, 4);
    assert.deepEqual(zonas[3], { nombre: 'Otros 5 municipios', pedidos: 5, vendido: 5000 });
  });
});

describe('Inventario', () => {
  test('resumen: valor a precio de venta, inversión a costo, agotados y bajos', () => {
    assert.deepEqual(calc.resumenInventario(catalogo, 5), {
      modelos: 3, piezas: 20, valorVenta: 7000 + 1000 + 6000, inversion: 4200, piezasConCosto: 7, agotados: 0, bajos: 1,
    });
  });

  test('mapa de tallas por modelo y color; null = esa talla no se maneja', () => {
    const hombre = calc.mapaTallas(catalogo, 'hombre');
    assert.deepEqual(hombre.columnas, ['26', '27']);
    assert.deepEqual(hombre.filas.map((f) => [f.producto, f.variante, f.celdas, f.agotadas]), [
      ['Tenis', 'Negro', [0, 2], 1],
      ['Tenis', 'Blanco', [5, 0], 1],
      ['Botas', 'Café', [null, 3], 0],
    ]);
    const cuidado = calc.mapaTallas(catalogo, 'cuidado');
    assert.deepEqual(cuidado.columnas, [calc.SIN_TALLA]);
    assert.deepEqual(cuidado.filas.map((f) => f.celdas), [[10], [0]]);
  });

  test('sin ventas en 30 días: primero lo que más dinero tiene detenido', () => {
    assert.deepEqual(calc.sinVentas(pedidos, catalogo, 30, AHORA).map((p) => [p.id, p.ultimaVenta]), [['botas', null]]);
    const sinLaDeNoviembre = pedidos.filter((p) => p.id !== 2);
    assert.deepEqual(calc.sinVentas(sinLaDeNoviembre, catalogo, 30, AHORA).map((p) => [p.id, p.valor]), [['botas', 6000], ['crema', 1000]]);
  });
});

describe('Clientes', () => {
  const lista = calc.clientes(pedidos);

  test('se agrupan por teléfono; los cancelados no cuentan y los nuevos quedan "sin confirmar"', () => {
    assert.deepEqual(lista.map((c) => [c.nombre, c.compras, c.gastado, c.porConfirmar]), [
      ['Luis', 2, 2349, 0],
      ['Ana', 3, 2180, 0],
      ['Pepe', 0, 0, 1],
    ]);
    const ana = lista.find((c) => c.nombre === 'Ana');
    assert.equal(ana.primeraCompra, fecha(SEP, 1));
    assert.equal(ana.ultimoPedido, fecha(NOV, 21, 10));
    assert.equal(lista[0].municipio, 'cuernavaca');
  });

  test('resumen y clientes nuevos del periodo', () => {
    assert.deepEqual(calc.resumenClientes(lista), { clientes: 2, recurrentes: 2, tasaRecompra: 1, gastoPromedio: (2349 + 2180) / 2 });
    const r = calc.rangoPeriodo('30d', AHORA);
    assert.equal(calc.clientesNuevos(lista, r.inicio, r.fin), 1, 'Luis compró por primera vez el 10 de noviembre');
    assert.equal(calc.clientesNuevos(lista, r.anteriorInicio, r.anteriorFin), 0);
  });
});

describe('Ejes y orden de tallas', () => {
  test('marcas redondas en el eje', () => {
    assert.deepEqual(calc.ticksLimpios(1234), [0, 500, 1000, 1500]);
    assert.deepEqual(calc.ticksLimpios(1000), [0, 250, 500, 750, 1000]);
    assert.deepEqual(calc.ticksLimpios(3, { entero: true }), [0, 1, 2, 3]);
    assert.deepEqual(calc.ticksLimpios(1, { entero: true }), [0, 1]);
    assert.deepEqual(calc.ticksLimpios(7, { entero: true }), [0, 2, 4, 6, 8]);
    assert.deepEqual(calc.ticksLimpios(0), [0]);
  });

  test('las tallas numéricas van primero y luego CH, M, G', () => {
    assert.deepEqual(['G', '27', 'CH', '25.5', 'M', '25'].sort(calc.ordenTallas), ['25', '25.5', '27', 'CH', 'M', 'G']);
  });
});
