{
    'name': 'Tienda de Puntos',
    'summary': 'Loyalty points and reward redemption from the Point of Sale.',
    'description': """
Tienda de Puntos for Point of Sale
==================================

Connects your Point of Sale with Tienda de Puntos:

* Every paid POS order credits loyalty points to the customer.
* Cashiers can validate and deliver a reward from the POS screen.
* No server-side code: the module only adds configuration fields and POS UI.

The connection is created from Tienda de Puntos, which fills in the
configuration fields of each Point of Sale.
""",
    'author': 'Tienda de Puntos',
    'website': 'https://tiendadepuntos.com',
    'version': '17.0.1.0.0',
    'license': 'LGPL-3',
    'category': 'Sales/Point of Sale',
    'depends': ['point_of_sale'],
    'data': [
        'data/tdp_pos_config_fields.xml',
        'views/res_config_settings_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'tdp_loyalty/static/src/app/tdp_api.js',
            'tdp_loyalty/static/src/app/redeem_screen.js',
            'tdp_loyalty/static/src/app/redeem_screen.xml',
            'tdp_loyalty/static/src/app/control_button.js',
            'tdp_loyalty/static/src/app/control_button.xml',
            'tdp_loyalty/static/src/app/sale_notify.js',
        ],
    },
    'images': ['static/description/icon.png'],
    'installable': True,
    'application': True,
}
