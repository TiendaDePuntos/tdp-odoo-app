# AGENTS.md

Guía para agentes que trabajan en la app de Odoo de Tienda de Puntos (TDP).

## Regla número uno: el módulo no corre Python nuestro

`tdp_loyalty` es un **módulo importable**: tiene que instalarse en Odoo Online con
*Apps → Import Module*, donde no se ejecuta código Python de terceros. Por eso el módulo
solamente aporta:

- campos manuales `x_tdp_*` sobre `pos.config`, declarados como registros `ir.model.fields`;
- una vista que agrega el bloque "Tienda de Puntos" a los ajustes del POS;
- assets JS/XML del POS.

**No agregues** `models/`, `controllers/`, `wizard/`, crons ni `security/ir.model.access.csv`
(no hay modelos propios). Si una feature parece necesitar Python del lado de Odoo, va del lado
de TDP: WebApi habla con Odoo por su API oficial (JSON-RPC / JSON-2) y el POS habla con
IntegrationService desde el browser.

## Layout

```
odoo/
├── docker-compose.yml         # runtime local: Postgres + Odoo 17 (+ perfiles 18 y 19)
├── .env.example
├── addons/
│   ├── 17.0/tdp_loyalty/      # una carpeta por serie, mismo technical name
│   ├── 18.0/tdp_loyalty/
│   └── 19.0/tdp_loyalty/
└── docs/
```

Dentro de cada `tdp_loyalty/`:

```
__init__.py                              # vacío a propósito
__manifest__.py                          # version <serie>.1.0.0, depends point_of_sale, LGPL-3
data/tdp_pos_config_fields.xml           # ir.model.fields x_tdp_* sobre pos.config y su espejo readonly en res.config.settings
views/res_config_settings_views.xml      # bloque "Tienda de Puntos" en Ajustes del POS
static/description/icon.png              # PNG real 256x256
static/description/index.html            # ficha en inglés para el ZIP / store
static/src/app/tdp_api.js                # settings por ORM + fetch a IntegrationService
static/src/app/redeem_screen.js|.xml     # pantalla de canje
static/src/app/control_button.js|.xml    # botón que abre la pantalla  ← ÚNICO archivo que difiere por serie
static/src/app/sale_notify.js            # patch de PaymentScreen: notifica la venta
```

**Las tres series comparten `tdp_api.js`, `redeem_screen.*` y `sale_notify.js` byte a byte.**
Si tocás uno, copiálo a las otras dos:

```bash
cd TiendaDePuntos.ExternalApps/odoo
for s in 18.0 19.0; do
  for f in tdp_api.js redeem_screen.js redeem_screen.xml sale_notify.js; do
    cp "addons/17.0/tdp_loyalty/static/src/app/$f" "addons/$s/tdp_loyalty/static/src/app/$f"
  done
done
```

Lo que sí difiere: el botón de la barra del POS.

- **17.0**: componente propio + `ProductScreen.addControlButton`.
- **18.0 / 19.0**: `patch(ControlButtons.prototype, ...)` + template con `t-inherit="point_of_sale.ControlButtons"`.

## Contrato con TDP

El POS lee `x_tdp_gateway_url`, `x_tdp_api_key`, `x_tdp_branch_id` y `x_tdp_pos_external_ref`
de `pos.config` **por ORM** (`orm.read`), no de los datos que precarga el POS: desde 18.0
`pos.config._load_pos_data_fields` publica una lista fija de campos y los manuales no entran.

Todas las llamadas salen del browser del cajero contra IntegrationService, con
`Authorization: Bearer <x_tdp_api_key>` y `x-odoo-pos-config-ref: <x_tdp_pos_external_ref>`:

| Flujo | Endpoint |
|---|---|
| Venta pagada | `POST {gateway}/integration/odoo/sale` |
| Buscar canje por código | `POST {gateway}/integration/odoo/purchases/find-by-code` |
| Entregar canje | `POST {gateway}/integration/odoo/purchases/redeem` |

La venta manda `external_id = pos_reference` (idempotencia), `amount_net`, `branch_id` y
`partner.email` / `partner.document_number`. Sin email ni documento no se envía: no hay a
quién sumarle puntos. Si el envío falla, el error queda en `x_tdp_last_sale_error` y la venta
la recupera el poll de `pos.order` desde WebApi. **La caja nunca se bloquea por TDP.**

Los campos `x_tdp_*` los completa TDP por API al conectar; en Ajustes del POS se ven de solo
lectura. No agregues botones de "conectar" dentro de Odoo: la conexión se hace desde TDP.

## Comandos

```bash
cd TiendaDePuntos.ExternalApps/odoo

# Serie 17 (default), base 'tdp', http://localhost:8069
docker compose up -d

# Otra serie en el servicio principal
ODOO_SERIES=18.0 ODOO_IMAGE=odoo:18.0 docker compose up -d

# 18 o 19 en paralelo (bases 'tdp18' / 'tdp19', puertos 8169 / 8269)
docker compose --profile odoo18 up -d web18
docker compose --profile odoo19 up -d web19

docker compose logs -f web
docker compose down
```

Instalar y actualizar el módulo:

```bash
docker compose exec web odoo -d tdp -i tdp_loyalty --stop-after-init
docker compose exec web odoo -d tdp -u tdp_loyalty --stop-after-init
```

Al cambiar solo JS/XML de assets alcanza con recargar el POS con la caché limpia; si tocaste
`data/` o `views/`, hay que correr el `-u`.

Empaquetar el ZIP para *Import Module* (la carpeta `tdp_loyalty` tiene que quedar en la raíz):

```bash
cd addons/17.0 && zip -r ../../tdp_loyalty-17.0.zip tdp_loyalty -x '*.pyc' && cd -
```

## Verificación

No hay build ni tests unitarios en este workspace: el módulo no tiene Python. Chequeos previos
a un commit:

```bash
cd TiendaDePuntos.ExternalApps/odoo
python -c "import glob,xml.dom.minidom; [xml.dom.minidom.parse(f) for f in glob.glob('addons/*/tdp_loyalty/**/*.xml', recursive=True)]"
python -c "import ast,glob; [ast.literal_eval(open(f, encoding='utf-8').read()) for f in glob.glob('addons/*/tdp_loyalty/__manifest__.py')]"
docker compose config --quiet
```

La verificación real es funcional: Odoo instala el módulo sin errores, el POS abre, el botón
"Validar premio TDP" aparece y la pestaña Network muestra los `fetch` contra IntegrationService.
Cada serie se prueba por separado: **17 no garantiza 18 ni 19**.

## Convenciones

- Código e identificadores en inglés; los textos de la ficha del store, en inglés.
- Los textos de la UI del POS están en español (es el idioma del cajero).
- JS: header `/** @odoo-module **/`, indentación de 4 espacios, `const`/`let`, `async/await`.
- Nombres de template: `tdp_loyalty.<ComponentName>`.
- Nada de `**/*` en `assets` del manifest: se lista archivo por archivo (requisito de la
  publicación en el store).
- Preferí `useService("pos")` a `usePos()` y `useService("orm")` a imports de POS: las rutas
  de los hooks del POS se mueven entre series.
- Los campos nuevos van con prefijo `x_tdp_`; Odoo solo acepta campos manuales con prefijo `x_`.
- Nunca loguees `x_tdp_api_key`.

## Al cambiar algo

1. Editá la serie 17, copiá los archivos compartidos a 18 y 19.
2. Si cambiaste un endpoint o el payload, revisá que coincida con
   `TiendaDePuntos.IntegrationService/src/odoo` y actualizá la tabla de arriba.
3. Si agregaste un archivo de assets, sumalo al `__manifest__.py` de las tres series.
4. Actualizá este archivo si cambia el layout o los comandos.
