/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";

/**
 * Desde Odoo 18 los botones de la barra viven en el componente `ControlButtons`.
 * En 19 `showScreen` no existe: las pantallas se abren con `pos.navigate`.
 */
patch(ControlButtons.prototype, {
    onClickTdpRedeem() {
        this.pos.navigate("TdpRedeemScreen");
    },
});
