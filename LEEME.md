# Zapatería Brazil

Tienda en línea de calzado y productos para su cuidado (Temixco, Morelos, México), con panel de administración.

## Usarla en tu computadora

Requisito: [Node.js](https://nodejs.org) 20.12 o superior. No hay que instalar paquetes.

```
npm start
```

- Tienda: http://localhost:3000
- Panel: http://localhost:3000/admin (la primera vez pide crear la contraseña)

Al arrancar, la consola dice dónde se están guardando los datos: **Supabase** o la carpeta `data/`.

## Pruebas automáticas

```
npm test
```

Revisa en unos segundos la tienda, el panel, los pedidos, los cálculos del tablero y la verificación anti-bots. Las pruebas arrancan su propio servidor en una carpeta temporal y **nunca tocan Supabase ni la carpeta `data/`** (tampoco necesitan internet). Conviene correrlas después de cada cambio.

## Panel de administración

| Pestaña | Para qué sirve |
|---|---|
| **Tablero** | Ventas del periodo (hoy, 7 días, 30 días o el mes) comparadas con el periodo anterior, lo más vendido (productos, tallas, categorías y municipios), inventario con mapa de tallas, productos sin ventas y lista de clientes |
| **Pedidos** | Confirmar (descuenta inventario), cancelar (lo regresa) y marcar como entregados |
| **Productos** | Alta y edición de productos, variantes, fotos, inventario por talla y costo |
| **Categorías** | Crear, editar y ordenar el menú de la tienda |

- El tablero solo cuenta pedidos de la tienda en línea, y como ventas solo los **confirmados y entregados**.
- El **costo por pieza** de cada producto es opcional y solo lo ve el panel: la tienda nunca lo recibe. Con él, el tablero calcula la ganancia y la inversión en mercancía. Cada pedido guarda el costo del momento, así la ganancia de ventas pasadas no cambia si después cambias el costo.

## Verificación anti-bots al entrar al panel (opcional)

El acceso al panel puede pedir, además de la contraseña, la verificación gratuita de Cloudflare (**Turnstile**). Casi siempre se resuelve sola en uno o dos segundos; a veces pide marcar una casilla. Frena a los programas que prueban contraseñas desde muchas IP distintas, algo que el bloqueo por intentos fallidos (5 intentos por IP) no alcanza a detener.

Sin las claves, el panel pide solo la contraseña.

**Activarla** (cuando tengas el dominio donde vas a publicar):

1. Crea una cuenta gratis en [Cloudflare](https://dash.cloudflare.com). No hace falta mover tu dominio a Cloudflare.
2. En el menú busca **Turnstile** y crea un widget (**Add widget**). Ponle un nombre, agrega tu dominio en **Hostnames** (por ejemplo `zapateriabrazil.mx`) y deja el modo **Managed**.
3. Copia la **Site Key** y la **Secret Key** a las variables `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` del hosting, y reinicia el servidor. Al arrancar, la consola dice si la verificación está activa.

**Probarla en tu computadora:** Cloudflare publica claves de prueba que siempre pasan. Copia a tu `.env` las dos líneas de Turnstile que vienen en `.env.example` (sin el `#`) y reinicia. El recuadro aparece con la leyenda "Solo para pruebas". Esas claves no protegen nada: no las uses en el sitio publicado.

**Si algún día no puedes entrar** porque Cloudflare falla, quita las dos variables y reinicia: el panel vuelve a pedir solo la contraseña.

El recuadro protege el acceso al panel. No impide que los bots vean la tienda, y está bien así: Google y WhatsApp necesitan leerla para mostrar tus productos.

## Dónde se guardan los datos

| Con Supabase (archivo `.env` con las claves) | Sin Supabase |
|---|---|
| Categorías y productos en las tablas `categorias` y `productos` | `data/catalogo.json` |
| Contraseña del panel (cifrada) en la tabla `ajustes` | `data/admin.json` |
| Fotos en el almacenamiento `productos` | `data/imagenes/` |
| Pedidos en la tabla `pedidos` | `data/pedidos.json` |

El archivo `.env` contiene la clave secreta de Supabase. **No lo compartas ni lo subas a Git** (ya está en `.gitignore`). Usa `.env.example` como modelo.

### Configurar Supabase desde cero

1. En Supabase → **SQL Editor** → New query, pega el contenido de `supabase/esquema.sql` y presiona **Run**.
2. Crea el archivo `.env` con `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (Project Settings → API Keys → Secret keys).
3. Para copiar el catálogo, fotos y contraseña que tengas en `data/`: `npm run migrar` (solo funciona con la base vacía).
4. `npm start`.

## Subir el proyecto a GitHub

Crea el repositorio como **privado**. Desde la carpeta del proyecto:

```
git init
git add .
git status
```

Antes de continuar, revisa que en la lista de `git status` **no** aparezcan `.env`, `api.txt`, `data/admin.json` ni `data/pedidos.json`. El archivo `.gitignore` ya los excluye. Después:

```
git commit -m "Primera versión de la tienda"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPOSITORIO.git
git push -u origin main
```

Si por error llegaras a subir el archivo `.env`, genera una clave secreta nueva en Supabase (Project Settings → API Keys) y borra la anterior: borrar el archivo del repositorio no basta, porque queda en el historial.

## Estructura

| Carpeta / archivo | Qué contiene |
|---|---|
| `server.js` | Servidor: sirve la tienda y la API del panel |
| `almacen.js` | Guarda y lee los datos, en Supabase o en `data/` |
| `supabase/` | Esquema de la base de datos y script de migración |
| `public/` | Páginas, estilos y JavaScript de la tienda y del panel (`js/tablero.js` dibuja el tablero y `js/tablero-calculos.js` hace sus cuentas) |
| `pruebas/` | Pruebas automáticas (`npm test`) |
| `data/` | Catálogo inicial; sin Supabase, también los datos de la tienda |

## Publicarla en internet

Hosting que ejecute **Node.js**: Render, Railway, Fly.io, un VPS, etc. Con Supabase **no hace falta disco persistente**, porque los datos y fotos viven en Supabase.

Configuración en el hosting:

| Variable | Valor |
|---|---|
| Comando de inicio | `npm start` |
| `SUPABASE_URL` | URL del proyecto de Supabase |
| `SUPABASE_SECRET_KEY` | Clave secreta de Supabase (como variable secreta del hosting, nunca en el código) |
| `TRUST_PROXY` | `1` si el hosting pone HTTPS delante del servidor (casi siempre). Así la sesión del panel solo viaja cifrada y el bloqueo por intentos fallidos usa la IP real |
| `SITIO_URL` | La dirección pública, por ejemplo `https://zapateriabrazil.mx`. Se usa en los enlaces que aparecen al compartir productos y en `sitemap.xml` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Opcional: las claves de tu widget de Cloudflare Turnstile (ver "Verificación anti-bots"). La secreta, como variable secreta |
| `PORT` | Normalmente lo define el hosting |
| `DATA_DIR` | Solo sin Supabase: ruta del disco persistente, por ejemplo `/data` |

Antes de publicar:

1. Entra a `/admin` y crea la contraseña **antes** de compartir el enlace (si migraste, ya es la que tenías).
2. Llena los datos marcados en amarillo en `public/cambios-y-devoluciones.html` y `public/aviso-de-privacidad.html`.
3. Revisa los datos de la tienda en `server.js` (`const TIENDA`): WhatsApp, dirección, horario y costos de envío.
4. En Supabase, el plan gratuito pausa los proyectos sin actividad durante una semana. Para la tienda en producción conviene el plan de pago (incluye respaldos diarios).
5. Activa la verificación anti-bots del panel con las claves de tu widget de Cloudflare.

## Pedidos

1. El cliente llena sus datos en el carrito y elige **envío a domicilio** o **recoger en tienda** (gratis).
2. El pedido se guarda con un folio (`ZB-0001`) y se abre WhatsApp con el resumen para que el cliente lo envíe.
3. En el panel, pestaña **Pedidos**: *Confirmar* descuenta el inventario, *Cancelar* lo regresa si ya se había descontado y *Entregado* cierra el pedido.

Los precios y el costo de envío los calcula el servidor, no el navegador. Dirección, horario, WhatsApp y costos de envío están en `server.js` (`const TIENDA`).

## Páginas de producto

Cada producto tiene su dirección, `/producto/<id>`, para compartirla. El servidor agrega título, descripción, precio y foto al HTML, así WhatsApp y Facebook muestran la vista previa y Google puede indexarla. Si el producto no tiene foto, se usa `public/img/compartir.png`.

## Notas

- Las fotos que ya no usa ningún producto se borran solas. Las recién subidas se conservan una hora, para darte tiempo de guardar el producto.
- Una categoría solo se puede eliminar cuando ya no tiene productos.
- Si editas productos directamente en el panel de Supabase, la tienda muestra el cambio en menos de 30 segundos.
- Al reiniciar el servidor se cierran las sesiones abiertas del panel; solo hay que volver a iniciar sesión.
