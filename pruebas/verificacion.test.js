'use strict';
// Verificación anti-bots de Cloudflare (Turnstile) al entrar al panel. Se prueba contra un Cloudflare
// falso que corre en esta computadora: las pruebas no necesitan internet ni claves reales.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { iniciarServidor, PASSWORD } = require('./servidor');

const SITEKEY = '0x4AAAAAAA-clave-publica-de-prueba';
const SECRETO = 'clave-secreta-de-prueba';

// Responde como "siteverify" de Cloudflare según el token que recibe, y anota cada consulta.
function cloudflareFalso() {
  const consultas = [];
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const datos = JSON.parse(cuerpo);
      consultas.push({ tipo: req.headers['content-type'], ...datos });
      const responder = (json) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (datos.secret !== SECRETO) return responder({ success: false, 'error-codes': ['invalid-input-secret'] });
      switch (datos.response) {
        case 'token-bueno': return responder({ success: true, 'error-codes': [], hostname: 'localhost', action: 'panel' });
        // Las claves de prueba de Cloudflare responden sin acción
        case 'token-de-prueba': return responder({ success: true, 'error-codes': [], hostname: 'example.com' });
        case 'token-de-otro-formulario': return responder({ success: true, 'error-codes': [], action: 'pedido' });
        case 'token-error-interno': return responder({ success: false, 'error-codes': ['internal-error'] });
        case 'token-caido':
          res.writeHead(502, { 'Content-Type': 'text/html' });
          return res.end('<html>Bad gateway</html>');
        default: return responder({ success: false, 'error-codes': ['invalid-input-response'] });
      }
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${servidor.address().port}/siteverify`,
      consultas,
      cerrar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }),
    }));
  });
}

let cf;
before(async () => { cf = await cloudflareFalso(); });
after(() => cf?.cerrar());

const conVerificacion = (extra = {}) => ({
  TRUST_PROXY: '1', // permite simular IPs distintas con X-Forwarded-For
  TURNSTILE_SITE_KEY: SITEKEY,
  TURNSTILE_SECRET_KEY: SECRETO,
  TURNSTILE_VERIFY_URL: cf.url,
  ...extra,
});
const configurar = (pedir, extra) => pedir('/api/configurar', { metodo: 'POST', datos: { password: PASSWORD, ...extra } });
const entrar = (pedir, extra) => pedir('/api/login', { metodo: 'POST', datos: { password: PASSWORD, ...extra } });

describe('Verificación anti-bots al entrar al panel (Cloudflare Turnstile)', () => {
  let servidor;
  before(async () => { servidor = await iniciarServidor(conVerificacion()); });
  after(() => servidor?.cerrar());
  const cliente = (ip) => servidor.cliente({ 'X-Forwarded-For': ip });

  test('el panel recibe la clave pública, nunca la secreta', async () => {
    const r = await cliente('198.51.100.20')('/api/sesion');
    assert.equal(r.cuerpo.sitekeyTurnstile, SITEKEY);
    assert.ok(!JSON.stringify(r.cuerpo).includes(SECRETO));
  });

  test('crear la contraseña también pide la verificación', async () => {
    const pedir = cliente('198.51.100.21');
    assert.equal((await configurar(pedir)).estado, 403, 'sin token');
    assert.equal((await configurar(pedir, { tokenTurnstile: 'token-malo' })).estado, 403);
    assert.equal((await pedir('/api/sesion')).cuerpo.configurado, false, 'sin verificación no se crea la contraseña');
    assert.equal((await configurar(pedir, { tokenTurnstile: 'token-bueno' })).estado, 200);
    assert.equal((await pedir('/api/sesion')).cuerpo.autenticado, true);
    // A Cloudflare solo se le manda la clave secreta y el token
    assert.deepEqual(cf.consultas.at(-1), { tipo: 'application/json', secret: SECRETO, response: 'token-bueno' });
  });

  test('iniciar sesión pide la verificación, y la verificación no reemplaza la contraseña', async () => {
    const pedir = cliente('198.51.100.22');
    const r = await entrar(pedir);
    assert.equal(r.estado, 403, 'sin token');
    assert.match(r.cuerpo.error, /verificación/);
    assert.equal((await entrar(pedir, { tokenTurnstile: 'token-malo' })).estado, 403);
    assert.equal((await entrar(pedir, { tokenTurnstile: 'token-de-otro-formulario' })).estado, 403);
    assert.equal((await pedir('/api/login', { metodo: 'POST', datos: { password: 'equivocada', tokenTurnstile: 'token-bueno' } })).estado, 401);
    assert.equal((await entrar(pedir, { tokenTurnstile: 'token-bueno' })).estado, 200);
    assert.equal((await pedir('/api/sesion')).cuerpo.autenticado, true);
  });

  test('las respuestas de las claves de prueba de Cloudflare (sin acción) se aceptan', async () => {
    assert.equal((await entrar(cliente('198.51.100.23'), { tokenTurnstile: 'token-de-prueba' })).estado, 200);
  });

  test('si Cloudflare no responde no se entra, y no cuenta como intento fallido', async () => {
    const pedir = cliente('198.51.100.24');
    for (const token of ['token-caido', 'token-error-interno', 'token-caido', 'token-error-interno', 'token-caido']) {
      const r = await entrar(pedir, { tokenTurnstile: token });
      assert.equal(r.estado, 503);
      assert.match(r.cuerpo.error, /Intenta de nuevo en un momento/);
    }
    assert.equal((await entrar(pedir, { tokenTurnstile: 'token-bueno' })).estado, 200, 'la IP no quedó bloqueada');
  });

  test('los tokens inválidos cuentan para el bloqueo; ya bloqueada la IP, ni se consulta a Cloudflare', async () => {
    const atacante = cliente('203.0.113.30');
    for (let i = 0; i < 5; i++) assert.equal((await entrar(atacante, { tokenTurnstile: `token-falso-${i}` })).estado, 403);
    const antes = cf.consultas.length;
    assert.equal((await entrar(atacante, { tokenTurnstile: 'token-bueno' })).estado, 429);
    assert.equal(cf.consultas.length, antes);
    assert.equal((await entrar(cliente('203.0.113.31'), { tokenTurnstile: 'token-bueno' })).estado, 200, 'las demás IP siguen entrando');
  });

  test('un token vacío o demasiado largo se rechaza sin consultar a Cloudflare', async () => {
    const antes = cf.consultas.length;
    const pedir = cliente('198.51.100.25');
    for (const token of ['', 'x'.repeat(2049), 12345]) assert.equal((await entrar(pedir, { tokenTurnstile: token })).estado, 403);
    assert.equal(cf.consultas.length, antes);
  });

  test('la página del panel le dice a Cloudflare de qué sitio viene (sin la ruta); la tienda no', async () => {
    const pedir = cliente('198.51.100.26');
    assert.equal((await pedir('/admin')).cabeceras.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal((await pedir('/')).cabeceras.get('referrer-policy'), 'same-origin');
  });
});

describe('Verificación anti-bots mal configurada', () => {
  let servidor;
  before(async () => { servidor = await iniciarServidor(conVerificacion({ TURNSTILE_SECRET_KEY: 'clave-secreta-equivocada' })); });
  after(() => servidor?.cerrar());

  test('con la clave secreta equivocada nadie entra y el aviso dice qué revisar', async () => {
    const r = await configurar(servidor.cliente({ 'X-Forwarded-For': '198.51.100.40' }), { tokenTurnstile: 'token-bueno' });
    assert.equal(r.estado, 503);
    assert.match(r.cuerpo.error, /TURNSTILE_SECRET_KEY/);
  });
});

describe('Sin las claves de Turnstile', () => {
  let servidor;
  before(async () => { servidor = await iniciarServidor({ TURNSTILE_SITE_KEY: SITEKEY }); }); // falta la secreta
  after(() => servidor?.cerrar());

  test('el panel pide solo la contraseña, como antes', async () => {
    const pedir = servidor.cliente();
    assert.equal((await pedir('/api/sesion')).cuerpo.sitekeyTurnstile, undefined);
    assert.equal((await configurar(pedir)).estado, 200);
    assert.equal((await pedir('/admin')).cabeceras.get('referrer-policy'), 'same-origin');
  });
});
