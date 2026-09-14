/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import {
    TDP_PATHS,
    tdpBuildSalePayload,
    tdpGetSettings,
    tdpIsConfigured,
    tdpPost,
    tdpSalePayloadHasClient,
    tdpWriteLastSaleError,
} from "@tdp_loyalty/app/tdp_api";

const MAX_ERROR_LENGTH = 250;

/**
 * Suma los puntos de la venta despues de que Odoo la valida. El envio no puede
 * bloquear la caja: cualquier fallo queda en `x_tdp_last_sale_error` y lo
 * recupera el poll de Tienda de Puntos.
 */
async function tdpNotifySale(pos, orm, order) {
    if (!order) {
        return;
    }

    let reference = "";
    try {
        const settings = await tdpGetSettings(pos, orm);
        if (!tdpIsConfigured(settings)) {
            return;
        }

        const payload = tdpBuildSalePayload(order, settings);
        reference = payload.order_ref;

        if (!reference) {
            console.warn("[TDP] Venta sin referencia: no se envia a Tienda de Puntos");
            return;
        }
        if (payload.amount_net <= 0) {
            return;
        }
        if (!tdpSalePayloadHasClient(payload)) {
            // Venta sin email ni documento: no hay a quien sumarle puntos.
            return;
        }

        await tdpPost(settings, TDP_PATHS.sale, payload);
        await tdpWriteLastSaleError(pos, orm, "");
    } catch (error) {
        console.error("[TDP] No se pudo enviar la venta a Tienda de Puntos", error);
        const message = error && error.message ? error.message : "Error desconocido";
        await tdpWriteLastSaleError(pos, orm, `${reference || "-"}: ${message}`.slice(0, MAX_ERROR_LENGTH));
    }
}

patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.tdpOrm = useService("orm");
    },

    async validateOrder(isForceValidate) {
        const order = this.currentOrder;
        await super.validateOrder(...arguments);
        await tdpNotifySale(this.pos, this.tdpOrm, order);
    },
});
