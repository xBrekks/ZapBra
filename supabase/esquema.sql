-- Esquema de Zapatería Brazil en Supabase.
-- Pégalo completo en Supabase → SQL Editor → New query → Run. Se puede ejecutar más de una vez.

create table if not exists public.categorias (
  id     text primary key,
  nombre text not null,
  descr  text not null default '',
  tipo   text not null,
  hex    text not null,
  orden  integer not null default 0
);

create table if not exists public.productos (
  id        text primary key,
  categoria text not null references public.categorias (id),
  datos     jsonb not null,                                        -- el producto completo (variantes, tallas, inventario…)
  nombre    text generated always as (datos ->> 'nombre') stored,  -- solo para leerlo fácil en el panel de Supabase
  creado    timestamptz not null default now()                     -- orden en que se muestran
);

create index if not exists productos_categoria_idx on public.productos (categoria);

-- Ajustes del servidor (por ahora, la contraseña cifrada del panel).
create table if not exists public.ajustes (
  clave text primary key,
  valor jsonb not null
);

-- Pedidos hechos desde la tienda. El folio que ve el cliente es "ZB-" + id (ZB-0001).
create table if not exists public.pedidos (
  id     bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  estado text not null default 'nuevo' check (estado in ('nuevo', 'confirmado', 'entregado', 'cancelado')),
  datos  jsonb not null  -- cliente, forma de entrega, artículos, totales e historial
);

create index if not exists pedidos_estado_idx on public.pedidos (estado);

-- Seguridad: sin políticas, nadie puede leer ni escribir con la clave pública.
-- Solo el servidor de la tienda, con la clave secreta, tiene acceso.
alter table public.categorias enable row level security;
alter table public.productos  enable row level security;
alter table public.ajustes    enable row level security;
alter table public.pedidos    enable row level security;
