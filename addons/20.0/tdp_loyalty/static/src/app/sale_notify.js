/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import OrderPaymentValidation from "@point_of_sale/app/utils/order_payment_validation";
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
 * Suma los puntos de la venta despues de que Odoo la valida, o los resta si la
 * orden es un reembolso (monto negativo). El envio no puede bloquear la caja:
 * cualquier fallo queda en `x_tdp_last_sale_error` y lo recupera el poll de
 * Tienda de Puntos.
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
        if (!payload.amount_net) {
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

/**
 * En Odoo 20 `PaymentScreen.validateOrder` no existe. La validacion (boton,
 * pago electronico automatico y pago rapido) pasa por `OrderPaymentValidation`.
 * `afterOrderValidation` corre solo cuando la orden quedo pagada.
 */
patch(OrderPaymentValidation.prototype, {
    async afterOrderValidation() {
        const order = this.order;
        const result = await super.afterOrderValidation(...arguments);
        const services = this.pos.env && this.pos.env.services;
        await tdpNotifySale(this.pos, services && services.orm, order);
        return result;
    },
});
