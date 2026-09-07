# TDP × Odoo POS — Cómo funciona (v4.8)

> **Este documento describe el estado actual** de la integración, post-rewrite v4.8.
> Si buscás el historial del addon Python `pos_custom_loyalty` o el pairing HMAC,
> ese código fue eliminado en v4.8.

---

## Arquitectura

```
┌───────────────────────────────────────────────────┐
│  Odoo Online / Odoo.sh / on-prem / Community     │
│  Módulo importable: tdp_loyalty (ZIP)            │
│                                                   │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  pos.config  │  │  POS del browser         │  │
│  │  x_tdp_*    │  │  sale_notify.js          │  │
│  │  (readonly) │  │  control_button + screen  │  │
│  └──────────────┘  └────────────┬─────────────┘  │
└───────────────────────────────────┼───────────────┘
                                    │ Bearer tdp_odoo_live_*
                                    │ x-odoo-pos-config-ref
                                    ▼
              ┌──────────────────────────────────────┐
              │  IntegrationService  (port 3001)     │
              │  CORS: *.odoo.com + custom origins   │
              │                                      │
              │  POST /integration/odoo/sale         │
              │  POST /integration/odoo/             │
              │       purchases/find-by-code         │
              │       purchases/redeem               │
              └────────────────────┬─────────────────┘
                                   │ x-api-key del comercio
                                   │ POST /integration/odoo/credentials/resolve
                                   ▼
              ┌──────────────────────────────────────┐
              │  WebApi (port 3000)                  │
              │                                      │
              │  POST /external/tags/add             │
              │  GET  /external/purchase/code/:code  │
              │  POST /external/purchase/redeem/:code│
              │  POST /integration/odoo/connect      │
              │  POST /integration/odoo/:id/test     │
              │  POST /integration/odoo/:id/rotate   │
              │  POST /integration/odoo/:id/revoke   │
              │  GET  /integration/odoo/:id/status   │
              │  Cron OdooSalePollJob (*/5 min)      │
              └──────────────────────────────────────┘
```

---

## Tres piezas

### 1. Módulo importable `tdp_loyalty`

Un addon Odoo sin Python: solo campos XML + assets JS/XML del POS. Hay una copia por serie
(`addons/17.0/`, `addons/18.0/`, `addons/19.0/`), todas con el mismo technical name.

**Campos declarados sobre `pos.config`** (todos `char`, por RPC se leen como strings):

| Campo | Descripción |
|---|---|
| `x_tdp_gateway_url` | URL pública del IntegrationService |
| `x_tdp_api_key` | Scoped key del POS (`tdp_odoo_live_*`) |
| `x_tdp_branch_id` | ID de sucursal TDP (string del número) |
| `x_tdp_pos_external_ref` | Identificador de la conexión (`odoo_branch_<branchId>`) |
| `x_tdp_last_sale_error` | Último error de venta (visible en Ajustes del POS, readonly) |

TDP escribe `x_tdp_gateway_url`, `x_tdp_api_key`, `x_tdp_branch_id` y `x_tdp_pos_external_ref`
al conectar por JSON-RPC/JSON-2. El POS los lee con `orm.read("pos.config", ...)` al abrir (no
vienen precargados en los datos del POS desde 18.0).

**Lo que difiere por serie:** el botón en la barra del POS.

| Serie | Mecanismo |
|---|---|
| 17 | Componente propio + `ProductScreen.addControlButton` |
| 18/19 | `patch(ControlButtons.prototype, ...)` + `t-inherit="point_of_sale.ControlButtons"` |

El resto del JS (`tdp_api.js`, `redeem_screen.*`, `sale_notify.js`) es idéntico en las tres series.

### 2. IntegrationService

Puerta pública del POS. El browser del cajero llama estos tres endpoints:

| Endpoint | Flujo |
|---|---|
| `POST /integration/odoo/sale` | Notifica una venta; IS resuelve la scoped key y reenvía a `/external/tags/add` |
| `POST /integration/odoo/purchases/find-by-code` | Busca un canje por código; IS reenvía a `GET /external/purchase/code/:code` |
| `POST /integration/odoo/purchases/redeem` | Entrega un canje; IS reenvía a `POST /external/purchase/redeem/:code` |

**Autenticación del POS:** `Authorization: Bearer tdp_odoo_live_*` + `x-odoo-pos-config-ref`.

**Resolución de credencial (S2S):** IS llama a `POST /integration/odoo/credentials/resolve` con la
scoped key y el `posExternalRef`. WebApi compara el SHA-256 de la key contra el hash guardado
en la `Integration` y devuelve la API key del comercio. Esta llamada usa `ODOO_INTERNAL_KEY`
en el header `x-odoo-internal-key`.

**CORS:** `*.odoo.com` está en la lista permitida de fábrica. Para on-prem o localhost, agregar
el dominio a `CORS_ALLOWED_ORIGINS` en el IntegrationService.

### 3. WebApi

Maneja el ciclo de vida de la conexión y el backup de ventas:

- **Connect/test/rotate/revoke:** CRUD de la `Integration` tipo ODOO, autenticación contra Odoo,
  escritura de `x_tdp_*` por JSON-RPC/JSON-2.
- **client.created → res.partner:** el listener `OdooClientSyncService.createPartnerForClient`
  busca el partner por email o `vat` antes de crear (idempotente), y guarda el `partnerId` en
  `configuration.odoo.partnerIdsByClientId`.
- **Poll de backup (`OdooSalePollJob`):** cada 5 min consulta `pos.order` con estado
  `paid|done|invoiced` y `date_order > lastSaleSyncAt`. Suma puntos via `externalDirectSumClient`;
  un 409 (ya existe por `external_id`) se trata como éxito (el POS JS ya lo reportó).

---

## Flujo de conexión (reemplaza el pairing HMAC)

```
Comercio                TDP Panel        WebApi               Odoo
   |                       |               |                    |
   |-- Importar ZIP ------> |               |                    |
   |   (Apps → Import)     |               |                    |
   |                       |               |                    |
   |-- Completar form ----> |               |                    |
   |   name, branchId,     |               |                    |
   |   odooBaseUrl, db,    |               |                    |
   |   apiKey, login       |               |                    |
   |                       |-- POST /connect -->                 |
   |                       |               |-- authenticate ---> |
   |                       |               |<-- uid/transport -- |
   |                       |               |                    |
   |                       |               |-- write pos.config ->|
   |                       |               |   x_tdp_* -------> |
   |                       |               |<-- ok ------------ |
   |                       |               |                    |
   |                       |<-- integrationId,                  |
   |                       |    scopedApiKeyOnce,               |
   |                       |    posConfigsUpdated               |
   |                       |               |                    |
```

---

## Flujo de venta (camino feliz)

```
Cajero paga → sale_notify.js → fetch POST {gateway}/integration/odoo/sale
                                    │
                            IS resolve scoped key → WebApi credentials/resolve
                                    │
                            IS forward → POST /external/tags/add
                                    │
                            WebApi suma puntos (idempotente por external_id)
```

Si el fetch falla: `x_tdp_last_sale_error` se llena; la caja no se bloquea.
El cron de 5 min recupera la venta desde `pos.order`.

## Flujo de canje

```
Cajero → botón "Validar premio TDP" → ingresa código
    │
    ├─ find-by-code → IS → /external/purchase/code/:code → WebApi
    │  (muestra estado, producto, cliente, puntos)
    │
    └─ redeem → IS → /external/purchase/redeem/:code → WebApi
       (marca DELIVERED)
```

---

## Estado por flujo

### Acumulación de puntos (venta POS)

- [x] Notificación de venta desde POS JS → IS.
- [x] Resolución scoped key → business API key.
- [x] Reenvío IS → `/external/tags/add`.
- [x] Idempotencia por `pos_reference` (409 = éxito).
- [x] Backup por poll `pos.order` cada 5 min.
- [x] Venta con cliente sin email ni DNI: se omite con log (no bloquea caja).

### Canje de premios

- [x] Buscar canje por código desde POS.
- [x] Entregar canje desde POS (DELIVERED).
- [x] Estado de "ya canjeado" / "expirado" en la UI.

### Clientes TDP → res.partner

- [x] Listener `client.created` → upsert `res.partner`.
- [x] Idempotencia: busca por email/vat antes de crear.
- [x] Fallo no bloquea el alta del cliente en TDP.

### Conexión (reemplaza pairing)

- [x] `POST /integration/odoo/connect` (con validación anti-SSRF de la URL).
- [x] Detección automática de transporte (JSON-2 vs JSON-RPC).
- [x] Write de `x_tdp_*` en `pos.config` al conectar.
- [x] Rotate y revoke de credencial.
- [x] Delete de integración limpia `x_tdp_*` en Odoo.

---

## Fuera de v1 (eliminado o backlog)

| Flujo | Estado |
|---|---|
| Cupones TDP en caja Odoo | **Eliminado** (no existe en v1) |
| Upsert de catálogo Odoo → TDP | **Eliminado** (no existe en v1) |
| Modelo local `tdp.coupon` | **Eliminado** |
| Pairing HMAC / callbacks `/pos_loyalty/*` | **Eliminado** |
| Tablero Odoo para errores de venta | Backlog |
| Publicación en Odoo Marketplace | Backlog |

---

## Variables de entorno

### WebApi

```env
INTEGRATION_SERVICE_URL=http://localhost:3001   # fallback para gatewayUrl si no se manda en connect
INTEGRATION_SECRETS_KEY=                        # AES para cifrar odooApiKey; fallback AUTH_JWT_SECRET
ODOO_INTERNAL_KEY=                              # protege /credentials/resolve
ODOO_ALLOWED_PORTS=                             # puertos permitidos en odooBaseUrl (default 443 en prod)
```

### IntegrationService

```env
BACKEND_URL=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:8069      # agregar dominios on-prem
ODOO_INTERNAL_KEY=                              # mismo valor que en WebApi
```

---

## Referencias

- Addon: `TiendaDePuntos.ExternalApps/odoo/addons/{17,18,19}.0/tdp_loyalty/`
- AGENTS.md del workspace Odoo: `TiendaDePuntos.ExternalApps/odoo/AGENTS.md`
- Gateway IS: `TiendaDePuntos.IntegrationService/src/odoo/`
- Client JSON-RPC/JSON-2: `TiendaDePuntos.WebApi/src/integration/adapters/odoo-adapter/odoo-json-rpc.client.ts`
- Feature doc completa: `docs/features/v4.8/odoo-importable-integration.md`
