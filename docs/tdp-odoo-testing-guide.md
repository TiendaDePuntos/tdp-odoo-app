# Guía de testing E2E: Integración TDP × Odoo (v4.8)

> **Arquitectura actual:** no existe pairing HMAC, no hay addon Python. El módulo
> `tdp_loyalty` es importable (XML + JS). La conexión se hace con un POST desde el
> panel TDP pasando las credenciales de Odoo. El POS del browser llama directamente
> al IntegrationService.

---

## 0. Prerequisitos

- WebApi (`npm run start:dev` en `TiendaDePuntos.WebApi`, puerto 3000)
- IntegrationService (`npm run start:dev` en `TiendaDePuntos.IntegrationService`, puerto 3001)
- MySQL + Redis corriendo localmente
- Variables de entorno clave configuradas:
  - **WebApi**: `INTEGRATION_SERVICE_URL=http://localhost:3001`, `ODOO_INTERNAL_KEY=<secret>`, `ODOO_ALLOWED_PORTS=80,443,8069`
  - **IntegrationService**: `BACKEND_URL=http://localhost:3000`, `ODOO_INTERNAL_KEY=<mismo secret>`, `CORS_ALLOWED_ORIGINS=http://localhost:8069`

---

## 1. Perfil A — Local Odoo 17 (Docker)

### 1.1 Levantar Odoo

```bash
cd TiendaDePuntos.ExternalApps/odoo

# Serie 17 (por defecto), base 'tdp', http://localhost:8069
docker compose up -d
docker compose logs -f web
```

Cuando los logs digan `HTTP service (HTTPS off) running on 0.0.0.0:8069`, Odoo está listo.

### 1.2 Instalar el addon `tdp_loyalty`

**Opción A — Importar ZIP (simula flujo Online):**

```bash
cd addons/17.0
zip -r ../../tdp_loyalty-17.0.zip tdp_loyalty -x '*.pyc'
cd ../..
```

En Odoo: Ajustes → Modo desarrollador → Apps → **Import Module** → subir `tdp_loyalty-17.0.zip` → instalar.

**Opción B — Instalar desde addons montados:**

```bash
docker compose exec web odoo -d tdp -i tdp_loyalty --stop-after-init
```

### 1.3 Crear negocio y sucursal en TDP

1. Registrar un nuevo negocio en el panel (`http://localhost:4200`).
2. Completar onboarding.
3. Ir a **Configuración → Sucursales**, crear "Sucursal Centro". Anotar el **branchId**.
4. Crear un producto premio (ej. "Café gratis" = 100 puntos).

### 1.4 Conectar desde TDP (reemplaza el flujo de pairing)

Desde el panel de integraciones o directamente con la API:

```bash
curl -X POST http://localhost:3000/api/integration/odoo/connect \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Odoo Local 17",
    "branchId": <branchId>,
    "odooBaseUrl": "http://host.docker.internal:8069",
    "odooDatabase": "tdp",
    "odooApiKey": "<api-key-odoo>",
    "odooLogin": "admin",
    "gatewayUrl": "http://localhost:3001"
  }'
```

Para obtener la API key de Odoo: en Odoo ir a **Preferencias de usuario → Cuenta → Claves de API** → generar clave.

**Respuesta esperada:**

```json
{
  "status": 201,
  "data": {
    "integrationId": 1,
    "apiKeyPrefix": "tdp_odoo_live_xx",
    "posConfigsUpdated": 1,
    "scopedApiKeyOnce": "tdp_odoo_live_...",
    "posExternalRef": "odoo_branch_<branchId>",
    "credentialStatus": "active",
    "transport": "json-rpc",
    "posConfigWriteError": null
  }
}
```

Si `posConfigsUpdated = 0` y `posConfigWriteError != null`, el módulo no se importó todavía
(campos `x_tdp_*` inexistentes). Importarlo y volver a conectar.

### 1.5 Verificar campos en pos.config

En Odoo: **Punto de venta → Configuración → Ajustes del POS** → expandir el bloque
"Tienda de Puntos". Los cuatro campos deben estar llenos (en readonly):

| Campo | Valor esperado |
|---|---|
| `x_tdp_gateway_url` | `http://localhost:3001` |
| `x_tdp_api_key` | `tdp_odoo_live_...` |
| `x_tdp_branch_id` | `"<branchId>"` |
| `x_tdp_pos_external_ref` | `"odoo_branch_<branchId>"` |

### 1.6 Crear cliente TDP → verificar `res.partner`

1. En TDP, crear un cliente con email y DNI.
2. En Odoo: **Contactos** → buscar por el email. Debe aparecer el `res.partner`.

### 1.7 Venta con puntos

1. Abrir POS (Punto de venta → Abrir sesión).
2. Agregar un producto, seleccionar el cliente (con email o DNI cargado).
3. Confirmar el pago.
4. Pestaña **Network** del browser → verificar `POST http://localhost:3001/integration/odoo/sale` con status 200.
5. En TDP: **Movimientos** del cliente → debe aparecer la operación de puntos.
6. Repetir la misma venta → debe devolver 200 sin duplicar puntos (idempotencia por `pos_reference`).

### 1.8 Canje de premio desde POS

1. En TDP, crear un canje pendiente para el cliente (sin "Entregar ahora").
2. Anotar el **código de canje** (8 caracteres).
3. En Odoo POS: botón **"Validar premio TDP"** en la barra inferior.
4. Ingresar el código → Click **Buscar**:
   - Debe mostrar estado, nombre del premio, cliente, puntos.
5. Click **Canjear ahora** → confirmar → popup de éxito.
6. En TDP: verificar que el canje está en estado **DELIVERED**.
7. Volver al POS y buscar el mismo código: debe mostrar "Ya canjeado" con el botón deshabilitado.

### 1.9 Test del poll de backup

1. Detener el IntegrationService.
2. Hacer una venta en el POS (el fetch falla; el campo `x_tdp_last_sale_error` se llena en Ajustes POS).
3. Volver a levantar el IntegrationService.
4. Esperar hasta 5 minutos.
5. Verificar que la venta aparece en TDP Movimientos (el cron `OdooSalePollJob` la recuperó).

---

## 2. Perfil B — Odoo 18 local

```bash
cd TiendaDePuntos.ExternalApps/odoo

# Levanta Odoo 18 en puerto 8169, base 'tdp18'
docker compose --profile odoo18 up -d web18
```

Empaquetar e importar el ZIP de la serie 18:

```bash
cd addons/18.0
zip -r ../../tdp_loyalty-18.0.zip tdp_loyalty -x '*.pyc'
```

Repetir los pasos 1.4 a 1.9 con `odooBaseUrl: "http://host.docker.internal:8169"` y `odooDatabase: "tdp18"`.

> **Diferencia 18 vs 17:** el botón del POS usa `patch(ControlButtons.prototype, ...)`.
> El resto del contrato TDP es idéntico.

---

## 3. Perfil C — Odoo 19 local

```bash
docker compose --profile odoo19 up -d web19
# Puerto 8269, base 'tdp19'
```

En 19, el transporte es **JSON-2** (`/json/2/<model>/<method>`, `Authorization: Bearer`),
por lo que **`odooLogin` se puede omitir** en el connect.

---

## 4. Perfil D — Odoo Online (primer cliente / trial)

1. Confirmar versión del SaaS (generalmente 17 o 18 en 2026).
2. Verificar que el plan incluye acceso a API externa (**Custom** o superior).
3. Empaquetar el ZIP de la serie correspondiente.
4. En Odoo Online: Ajustes → Modo desarrollador → Apps → Import Module → subir el ZIP.
5. Obtener:
   - URL: `https://<db>.odoo.com`
   - Database: `<db>` (el mismo slug de la URL)
   - API key: Preferencias → Cuenta → Claves de API
6. Conectar desde TDP usando la URL pública del IntegrationService en `gatewayUrl`.
7. Repetir los casos de la sección 1.7 a 1.9.
8. **Verificación crítica:** en la pestaña Network del browser, confirmar que los `fetch` del POS apuntan al IntegrationService (no a `/pos_loyalty/` ni a rutas internas de Odoo).

> **Nota Online:** si el plan no incluye API externa, `POST /integration/odoo/connect` devolverá
> un error 503 de Odoo. El panel debe mostrar el mensaje y guiar al comercio a actualizar su plan.

---

## 5. Casos de error

| Caso | Comportamiento esperado |
|---|---|
| Código de canje vacío | Error: "El código de canje es obligatorio" |
| Código inexistente | 404 con mensaje desde TDP WebApi |
| Código ya canjeado | Panel del POS muestra "Ya canjeado", botón deshabilitado |
| Código expirado | Panel muestra "Vencido", botón deshabilitado |
| IntegrationService caído al pagar | Error silenciado; `x_tdp_last_sale_error` se llena; la caja no se bloquea |
| Venta sin email ni DNI del partner | IS responde `ok: false, error_code: CLIENT_IDENTIFICATION_MISSING`; no se suman puntos |
| Scoped key revocada | IS responde 401 `UNAUTHORIZED_API_KEY` |
| `odooBaseUrl` con IP privada | Connect devuelve 400 (anti-SSRF) |
| Odoo 17/18 sin `odooLogin` | Connect devuelve 422 con mensaje explicativo |
| Plan Online sin API externa | Connect devuelve 503 con error de Odoo |
| Módulo no importado (campos `x_tdp_*` inexistentes) | Connect devuelve `posConfigsUpdated: 0, posConfigWriteError: <mensaje>`. La scoped key se incluye igual para pegarla a mano. |

---

## 6. Endpoints del flujo actual

| Quién llama | Endpoint | Auth |
|---|---|---|
| Panel TDP → WebApi | `POST /api/integration/odoo/connect` | JWT |
| Panel TDP → WebApi | `POST /api/integration/odoo/:id/test` | JWT |
| Panel TDP → WebApi | `POST /api/integration/odoo/:id/rotate-key` | JWT |
| Panel TDP → WebApi | `POST /api/integration/odoo/:id/revoke-key` | JWT |
| Panel TDP → WebApi | `GET /api/integration/odoo/:id/credential-status` | JWT |
| Panel TDP → WebApi | `GET /api/integration/odoo/branch/:branchId/credential-status` | JWT |
| POS Odoo (browser) → IS | `POST /integration/odoo/sale` | `Bearer tdp_odoo_live_*` |
| POS Odoo (browser) → IS | `POST /integration/odoo/purchases/find-by-code` | `Bearer tdp_odoo_live_*` |
| POS Odoo (browser) → IS | `POST /integration/odoo/purchases/redeem` | `Bearer tdp_odoo_live_*` |
| IS → WebApi | `POST /integration/odoo/credentials/resolve` | `x-odoo-internal-key` |
| IS → WebApi | `POST /external/tags/add` | `x-api-key` del comercio |
| IS → WebApi | `GET /external/purchase/code/:code` | `x-api-key` del comercio |
| IS → WebApi | `POST /external/purchase/redeem/:code` | `x-api-key` del comercio |

**Endpoints eliminados en v4.8** (ya no existen):
- `POST /integration/odoo/pairing/start`
- `GET /integration/odoo/pairing/:code`
- `POST /integration/odoo/pairing/confirm`
- `POST /integration/odoo/:id/retry-callback`
- `POST /external/integration/odoo/pairing/start`
- `POST /pos_loyalty/store_tdp_credentials` (era del addon Python)
