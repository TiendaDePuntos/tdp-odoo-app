/** @odoo-module **/

import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";

/** Odoo 17 registra los botones de la barra con `ProductScreen.addControlButton`. */
export class TdpRedeemButton extends Component {
    static template = "tdp_loyalty.TdpRedeemButton";

    setup() {
        this.pos = useService("pos");
    }

    onClick() {
        this.pos.showScreen("TdpRedeemScreen");
    }
}

ProductScreen.addControlButton({
    component: TdpRedeemButton,
    condition: () => true,
});
