'use strict';
/*
 * Ayudantes para las pruebas: arrancan la tienda en una carpeta temporal (con una copia del
 * catálogo de ejemplo) y SIEMPRE sin Supabase, para que las pruebas nunca toquen los datos reales.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const PASSWORD = 'clave-de-prueba';

async function iniciarServidor(entorno = {}) {
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'zapateria-prueba-'));
  const proceso = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0', // el sistema elige un puerto libre: las pruebas pueden correr en paralelo
      DATA_DIR: datos,
      ALMACEN: 'archivos',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      TRUST_PROXY: '',
      // Sin verificación de Cloudflare, aunque el .env tenga claves (verificacion.test.js la prueba aparte)
      TURNSTILE_SITE_KEY: '',
      TURNSTILE_SECRET_KEY: '',
      TURNSTILE_VERIFY_URL: '',
      ...entorno,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const base = await new Promise((resolve, reject) => {
    let salida = '';
    const tiempo = setTimeout(() => reject(new Error(`El servidor no arrancó a tiempo:\n${salida}`)), 15000);
    proceso.stdout.on('data', (d) => {
      salida += d;
      const m = salida.match(/lista en (http:\/\/localhost:\d+) \(datos en (.+)\)/);
      if (!m) return;
      clearTimeout(tiempo);
      // Doble seguro: el servidor debe estar usando la carpeta temporal, nunca Supabase ni data/
      if (path.resolve(m[2].trim()) !== path.resolve(datos)) reject(new Error(`El servidor de prueba usa otros datos: ${m[2]}`));
      else resolve(m[1]);
    });
    proceso.stderr.on('data', (d) => { salida += d; });
    proceso.on('exit', (codigo) => {
      clearTimeout(tiempo);
      reject(new Error(`El servidor terminó (código ${codigo}):\n${salida}`));
    });
  });

  return {
    base,
    datos,
    cliente: (cabecerasFijas) => crearCliente(base, cabecerasFijas),
    async cerrar() {
      if (proceso.exitCode === null && proceso.signalCode === null) {
        const terminado = new Promise((r) => proceso.once('exit', r));
        proceso.kill();
        await terminado;
      }
      fs.rmSync(datos, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

// Cliente HTTP que guarda la cookie de sesión, como un navegador.
function crearCliente(base, cabecerasFijas = {}) {
  let cookie = '';
  return async function pedir(ruta, { metodo = 'GET', datos, cabeceras = {} } = {}) {
    const opciones = { method: metodo, headers: { ...cabecerasFijas, ...cabeceras }, redirect: 'manual' };
    if (cookie) opciones.headers.Cookie = cookie;
    if (datos !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(datos);
    }
    const res = await fetch(base + ruta, opciones);
    const nuevaCookie = res.headers.get('set-cookie');
    if (nuevaCookie) cookie = nuevaCookie.split(';')[0];
    const texto = await res.text();
    let cuerpo = texto;
    try { cuerpo = JSON.parse(texto); } catch { /* no es JSON */ }
    return { estado: res.status, cuerpo, cabeceras: res.headers };
  };
}

// Crea la contraseña del panel (primer uso) y deja la sesión abierta en ese cliente.
async function entrarAlPanel(pedir, password = PASSWORD) {
  const r = await pedir('/api/configurar', { metodo: 'POST', datos: { password } });
  if (r.estado !== 200) throw new Error(`No se pudo configurar la contraseña: ${JSON.stringify(r.cuerpo)}`);
}

// Espera a que algo se cumpla (por ejemplo, que se borre una foto en segundo plano).
async function esperarHasta(condicion, ms = 3000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return condicion();
}

const stockDe = (v, talla) => (typeof v.stock === 'number' ? v.stock : v.stock[talla] || 0);

module.exports = { iniciarServidor, entrarAlPanel, esperarHasta, stockDe, PASSWORD };
