'use strict';
// Pedidos: validaciones, precios calculados por el servidor, costo privado e inventario al confirmar o cancelar.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, entrarAlPanel, stockDe } = require('./servidor');

describe('Pedidos', () => {
  let servidor;
  let admin;
  let catalogo;
  let ipSiguiente = 1;
  // Cada pedido llega desde una IP distinta (X-Forwarded-For con TRUST_PROXY=1) para no topar el límite por IP,
  // salvo en la prueba de ese límite.
  const pedir = (datos, ip = `192.0.2.${ipSiguiente++}`) =>
    servidor.cliente({ 'X-Forwarded-For': ip })('/api/pedidos', { metodo: 'POST', datos });
  const cambiarEstado = (id, estado) => admin(`/api/pedidos/${id}/estado`, { metodo: 'POST', datos: { estado } });
  const precio = (p, v) => v.precio ?? p.precioOferta ?? p.precio;
  const producto = (id) => catalogo.productos.find((p) => p.id === id);
  const stockActual = async (id, variante, talla) => {
    const p = (await admin('/api/catalogo')).cuerpo.productos.find((x) => x.id === id);
    return stockDe(p.variantes.find((v) => v.nombre === variante), talla);
  };

  const cliente = { nombre: 'Ana <b>Pérez</b>', telefono: '+52 (777) 123-4567' };
  const domicilio = { calle: 'Morelos 10', colonia: 'Centro', cp: '62000', municipio: 'Cuernavaca', estado: 'Morelos', referencias: 'Portón verde' };
  // Tenis con talla (precio de oferta) y agujetas sin talla
  const tenis = { id: 'tenis-runner-pro', variante: 'Negro', talla: '27' };
  const agujetas = { id: 'agujetas-redondas', variante: 'Negro' };

  before(async () => {
    servidor = await iniciarServidor({ TRUST_PROXY: '1' });
    admin = servidor.cliente({ 'X-Forwarded-For': '198.51.100.50' });
    await entrarAlPanel(admin);
    // Las agujetas tienen costo: el pedido lo guarda, pero el cliente nunca debe verlo
    const p = (await admin('/api/catalogo')).cuerpo.productos.find((x) => x.id === agujetas.id);
    assert.equal((await admin(`/api/productos/${p.id}`, { metodo: 'PUT', datos: { ...p, costo: 25 } })).estado, 200);
    catalogo = (await admin('/api/catalogo')).cuerpo;
  });
  after(() => servidor.cerrar());

  test('validaciones del pedido', async () => {
    const articulos = [{ ...tenis, cant: 1 }];
    const casos = [
      [{ entrega: 'dron', cliente, articulos }, 400],
      [{ entrega: 'envio', cliente, articulos }, 400], // envío sin domicilio
      [{ entrega: 'envio', cliente: { ...cliente, ...domicilio, cp: '123' }, articulos }, 400],
      [{ entrega: 'tienda', cliente: { ...cliente, telefono: '123' }, articulos }, 400],
      [{ entrega: 'tienda', cliente: { ...cliente, nombre: 'A' }, articulos }, 400],
      [{ entrega: 'tienda', cliente, articulos: [] }, 400],
      [{ entrega: 'tienda', cliente, articulos: [{ ...tenis, talla: '99', cant: 1 }] }, 400],
      [{ entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: 0 }] }, 400],
      [{ entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: 1 }, { ...tenis, cant: 1 }] }, 400],
      [{ entrega: 'tienda', cliente, articulos: [{ id: 'inventado', variante: 'X', cant: 1 }] }, 409],
      [{ entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: 20 }] }, 409], // más piezas de las que hay
    ];
    for (const [datos, estado] of casos) {
      const r = await pedir(datos);
      assert.equal(r.estado, estado, JSON.stringify(datos));
      assert.ok(r.cuerpo.error, JSON.stringify(datos));
    }
  });

  test('recoger en tienda: precios del servidor, datos limpios y sin costos para el cliente', async () => {
    // El navegador manda un precio falso: el servidor lo ignora
    const r = await pedir({ entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: 2, precio: 1 }, { ...agujetas, cant: 3 }] });
    assert.equal(r.estado, 201);
    const p = r.cuerpo;
    const pt = producto(tenis.id);
    const pa = producto(agujetas.id);
    const esperado = precio(pt, pt.variantes[0]) * 2 + precio(pa, pa.variantes[0]) * 3;
    assert.match(p.folio, /^ZB-\d{4}$/);
    assert.equal(p.estado, 'nuevo');
    assert.equal(p.subtotal, esperado);
    assert.equal(p.envio, 0);
    assert.equal(p.total, esperado);
    assert.equal(p.cliente.telefono, '7771234567');
    assert.doesNotMatch(p.cliente.nombre, /[<>]/);
    assert.ok(!('calle' in p.cliente), 'recoger en tienda no guarda domicilio');
    assert.ok(!JSON.stringify(p).includes('costo'), 'el cliente no debe ver el costo');
  });

  test('envío: cuesta $149 debajo de $999 y es gratis desde $999', async () => {
    const barato = (await pedir({ entrega: 'envio', cliente: { ...cliente, ...domicilio }, articulos: [{ ...agujetas, cant: 1 }] })).cuerpo;
    assert.equal(barato.envio, 149);
    assert.equal(barato.total, barato.subtotal + 149);
    assert.equal(barato.cliente.cp, '62000');
    const caro = (await pedir({ entrega: 'envio', cliente: { ...cliente, ...domicilio }, articulos: [{ ...tenis, cant: 1 }] })).cuerpo;
    assert.ok(caro.subtotal >= 999);
    assert.equal(caro.envio, 0);
  });

  test('el panel lista los pedidos (más reciente primero) y ve el costo guardado', async () => {
    assert.equal((await servidor.cliente()('/api/pedidos')).estado, 401);
    const lista = (await admin('/api/pedidos')).cuerpo;
    assert.ok(lista.length >= 3);
    assert.ok(new Date(lista[0].creado) >= new Date(lista[lista.length - 1].creado));
    assert.ok(lista[0].id > lista[lista.length - 1].id);
    const conAgujetas = lista.find((p) => p.articulos.some((a) => a.id === agujetas.id));
    assert.equal(conAgujetas.articulos.find((a) => a.id === agujetas.id).costo, 25);
    assert.deepEqual((await admin('/api/pedidos?todos=1')).cuerpo.map((p) => p.id), lista.map((p) => p.id));
  });

  test('confirmar descuenta inventario; cancelar lo regresa; los estados finales no cambian', async () => {
    const p = (await pedir({ entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: 2 }, { ...agujetas, cant: 1 }] })).cuerpo;
    const t0 = await stockActual(tenis.id, tenis.variante, tenis.talla);
    const a0 = await stockActual(agujetas.id, agujetas.variante);

    assert.equal((await cambiarEstado(p.id, 'entregado')).estado, 409, 'no se entrega sin confirmar');
    assert.equal((await cambiarEstado(p.id, 'inventado')).estado, 400);
    const confirmado = await cambiarEstado(p.id, 'confirmado');
    assert.equal(confirmado.estado, 200);
    assert.equal(confirmado.cuerpo.inventarioDescontado, true);
    assert.equal(await stockActual(tenis.id, tenis.variante, tenis.talla), t0 - 2);
    assert.equal(await stockActual(agujetas.id, agujetas.variante), a0 - 1);
    assert.equal((await cambiarEstado(p.id, 'confirmado')).estado, 409, 'no se confirma dos veces');

    const cancelado = await cambiarEstado(p.id, 'cancelado');
    assert.equal(cancelado.cuerpo.inventarioDescontado, false);
    assert.equal(cancelado.cuerpo.historial.length, 3);
    assert.equal(await stockActual(tenis.id, tenis.variante, tenis.talla), t0);
    assert.equal(await stockActual(agujetas.id, agujetas.variante), a0);
    assert.equal((await cambiarEstado(p.id, 'confirmado')).estado, 409, 'cancelado es final');

    const otro = (await pedir({ entrega: 'tienda', cliente, articulos: [{ ...agujetas, cant: 1 }] })).cuerpo;
    await cambiarEstado(otro.id, 'confirmado');
    const entregado = await cambiarEstado(otro.id, 'entregado');
    assert.equal(entregado.cuerpo.estado, 'entregado');
    assert.equal(await stockActual(agujetas.id, agujetas.variante), a0 - 1, 'entregado conserva el descuento');
    assert.equal((await cambiarEstado(otro.id, 'cancelado')).estado, 409, 'entregado es final');
    assert.equal((await cambiarEstado(999999, 'confirmado')).estado, 404);
  });

  test('dos confirmaciones a la vez por las últimas piezas: solo una pasa y el inventario nunca queda negativo', async () => {
    const quedan = await stockActual(tenis.id, tenis.variante, tenis.talla);
    const datos = { entrega: 'tienda', cliente, articulos: [{ ...tenis, cant: quedan }] };
    const p1 = (await pedir(datos)).cuerpo;
    const p2 = (await pedir(datos)).cuerpo;
    const [r1, r2] = await Promise.all([cambiarEstado(p1.id, 'confirmado'), cambiarEstado(p2.id, 'confirmado')]);
    assert.deepEqual([r1.estado, r2.estado].sort(), [200, 409]);
    assert.equal(await stockActual(tenis.id, tenis.variante, tenis.talla), 0);
  });

  test('máximo 5 pedidos seguidos desde la misma IP', async () => {
    const estados = [];
    for (let i = 0; i < 6; i++) {
      estados.push((await pedir({ entrega: 'tienda', cliente, articulos: [{ ...agujetas, cant: 1 }] }, '192.0.2.250')).estado);
    }
    assert.deepEqual(estados, [201, 201, 201, 201, 201, 429]);
  });
});
