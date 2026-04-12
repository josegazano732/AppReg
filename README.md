# AppReg

Aplicacion Angular con arquitectura modular y enfoque local-first para operacion diaria de caja.

## Manual de usuario

- Guia completa por pantalla y flujo operativo: `README-USUARIO.md`

## Estado actual

- Todo el proyecto usa CSS (sin SCSS).
- UI profesional y responsive para escritorio y movil.
- Estado de negocio centralizado en servicios de `core`.
- Persistencia local por `localStorage` para trabajar sin backend.
- Sincronizacion no bloqueante con Supabase para configuracion, ingresos, egresos, registros y cierres.
- Esquema profesional preparado para trazabilidad por detalle de conceptos y medios de pago.

## Estructura

- `src/app/core`: servicios singleton y logica transversal.
- `src/app/shared`: modelos y componentes reutilizables.
- `src/app/features`: modulos por funcionalidad.
- `src/app/layout`: shell principal del dashboard.

## Ejecucion

```bash
npm install
npm start
```

## Deploy a GitHub Pages (checklist rapido)

Este repo publica con GitHub Actions (no requiere rama `gh-pages`).

1. Confirmar que el branch de trabajo sea `master` o `main`.
2. Verificar que `Settings > Pages > Source` este en `GitHub Actions`.
3. Ejecutar build local de Pages:

```bash
npm run build:pages
```

4. Hacer push del commit.
5. Revisar workflow `Deploy GitHub Pages` en Actions.

URL esperada del sitio:

```text
https://josegazano732.github.io/AppReg/
```

Errores comunes evitados en esta configuracion:

- 404 en rutas internas: resuelto con `src/404.html` y restauracion de ruta en `src/index.html`.
- Base href incorrecto: usar `--base-href=/AppReg/`.
- Publicacion por rama equivocada: este repo usa artefacto de Actions, no branch `gh-pages`.

## Escalado a Supabase

1. Mantener `ConfigService` y `CajaService` como capa de aplicacion.
2. Conservar `localStorage` como continuidad operativa ante fallas remotas.
3. Agregar autenticacion y politicas RLS por sucursal/usuario cuando corresponda.
4. Mantener los componentes sin dependencia directa de infraestructura.

## Conexion Supabase (actual)

La app ya incluye cliente Supabase y sincronizacion no bloqueante desde `CajaService`.
Si Supabase falla o no existen tablas, la app sigue operando con `localStorage`.

### Variables de entorno

- `supabase.url`
- `supabase.anonKey`

Se configuran en:

- `src/environments/environment.ts`
- `src/environments/environment.prod.ts`

### Migrar esquema en Supabase

Opciones recomendadas:

1. Ejecutar la migracion consolidada [scripts/supabase-migration-profesional.sql](scripts/supabase-migration-profesional.sql) en el SQL Editor de Supabase.
2. O bien usar los scripts Node del repo si dispones de `SUPABASE_DB_URL`:

```bash
npm run db:supabase:schema
npm run db:supabase:relations
```

La migracion deja el modelo remoto alineado con el frontend actual:

- `public.registros.fecha` para fecha operativa.
- `public.registro_conceptos_detalle` para conceptos normalizados por registro.
- `public.registro_pagos_detalle` para medios de pago normalizados por registro.
- Tablas puente `cierre_registros`, `cierre_ingresos`, `cierre_gastos`.
- Indices para consultas por fecha, trazabilidad y correlatividad.

Si prefieres aplicar manualmente en SQL Editor, este es el archivo fuente a ejecutar:

```sql
-- Ejecutar el contenido completo de scripts/supabase-migration-profesional.sql
```

### Verificaciones recomendadas

Con `SUPABASE_URL` y `SUPABASE_ANON_KEY`:

```bash
npm run verify:supabase:config
npm run verify:supabase:gastos
npm run verify:supabase:registro:client
```

Con `SUPABASE_DB_URL`:

```bash
npm run verify:supabase:registro
npm run verify:supabase:trazabilidad
```

### Politicas RLS sugeridas (entorno interno)

Si no usan login por ahora, pueden dejar RLS deshabilitado temporalmente para pruebas.
Para produccion, habilitar RLS y politicas segun usuarios/sucursal.
