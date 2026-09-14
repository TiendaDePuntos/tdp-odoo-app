/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, useState } from "@odoo/owl";
import {
    TDP_PATHS,
    tdpGetSettings,
    tdpIsConfigured,
    tdpNormalizePurchase,
    tdpPost,
} from "@tdp_loyalty/app/tdp_api";

export class TdpRedeemScreen extends Component {
    static template = "tdp_loyalty.TdpRedeemScreen";

    setup() {
        // `useService("pos")` en vez de `usePos()`: el hook cambia de ruta entre series.
        this.pos = useService("pos");
        this.orm = useService("orm");
        this.state = useState({
            code: "",
            isLoading: false,
            isRedeeming: false,
            purchase: null,
            error: "",
            success: "",
        });
    }

    onCodeInput(ev) {
        this.state.code = (ev.target.value || "").trim();
    }

    get canRedeem() {
        return Boolean(this.state.purchase && this.state.purchase.isValid && !this.state.isRedeeming);
    }

    get statusText() {
        const purchase = this.state.purchase;
        if (!purchase) {
            return "Sin resultados";
        }
        if (purchase.isAlreadyRedeemed) {
            return "Ya validado";
        }
        if (purchase.isCanceled) {
            return "Cancelado";
        }
        if (purchase.isExpired) {
            return "Vencido";
        }
        return "Pendiente de validacion";
    }

    async onSearch() {
        const code = (this.state.code || "").trim();
        this.state.error = "";
        this.state.success = "";

        if (!code) {
            this.state.error = "Ingresa un codigo de validacion para continuar.";
            return;
        }

        this.state.isLoading = true;
        this.state.purchase = null;

        try {
            const settings = await this.getSettings();
            const response = await tdpPost(settings, TDP_PATHS.findPurchase, {
                code,
                branch_id: settings.branchId || undefined,
            });
            this.state.purchase = tdpNormalizePurchase(response, code);
        } catch (error) {
            this.state.error = this.describeError(error, "No se pudo consultar la validacion en Tienda de Puntos.");
        } finally {
            this.state.isLoading = false;
        }
    }

    async onRedeem() {
        if (!this.canRedeem) {
            return;
        }
        if (!window.confirm("Confirmar validacion del premio?")) {
            return;
        }

        this.state.isRedeeming = true;
        this.state.error = "";
        this.state.success = "";

        try {
            const settings = await this.getSettings();
            const purchase = this.state.purchase;
            await tdpPost(settings, TDP_PATHS.redeemPurchase, {
                code: this.state.code,
                branch_id: settings.branchId || undefined,
            });

            this.state.success = [
                "El premio fue validado correctamente.",
                purchase.productName !== "-" ? `Premio: ${purchase.productName}` : "",
                purchase.clientName !== "-" ? `Cliente: ${purchase.clientName}` : "",
                `Codigo: ${this.state.code}`,
            ]
                .filter(Boolean)
                .join(" · ");

            await this.onSearchAfterRedeem();
        } catch (error) {
            this.state.error = this.describeError(error, "No se pudo completar la validacion en Tienda de Puntos.");
        } finally {
            this.state.isRedeeming = false;
        }
    }

    goBack() {
        this.pos.showScreen("ProductScreen");
    }

    async getSettings() {
        const settings = await tdpGetSettings(this.pos, this.orm);
        if (!tdpIsConfigured(settings)) {
            throw new Error("Este punto de venta todavia no esta conectado con Tienda de Puntos.");
        }
        return settings;
    }

    /** Refresca el estado sin pisar el mensaje de exito recien mostrado. */
    async onSearchAfterRedeem() {
        const success = this.state.success;
        await this.onSearch();
        this.state.success = success;
    }

    describeError(error, fallback) {
        console.error("[TDP] Redeem screen request failed", error);
        const message = error && typeof error.message === "string" ? error.message.trim() : "";
        return message || fallback;
    }
}

registry.category("pos_screens").add("TdpRedeemScreen", TdpRedeemScreen);
