/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";

/**
 * Desde Odoo 18 los botones de la barra viven en el componente `ControlButtons`:
 * se agrega el metodo por patch y el boton por `t-inherit` en el template.
 */
patch(ControlButtons.prototype, {
    onClickTdpRedeem() {
        this.pos.showScreen("TdpRedeemScreen");
    },
});
