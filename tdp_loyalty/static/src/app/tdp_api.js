/** @odoo-module **/

/**
 * Capa de acceso a Tienda de Puntos desde el POS.
 *
 * El modulo es importable y no corre Python propio: la configuracion se lee por
 * ORM (las series nuevas no publican los campos manuales en los datos del POS)
 * y las llamadas salen del browser del cajero contra IntegrationService.
 */

export const TDP_PATHS = {
    sale: "/integration/odoo/sale",
    findPurchase: "/integration/odoo/purchases/find-by-code",
    redeemPurchase: "/integration/odoo/purchases/redeem",
};

const SETTINGS_FIELDS = [
    "x_tdp_gateway_url",
    "x_tdp_api_key",
    "x_tdp_branch_id",
    "x_tdp_pos_external_ref",
];

const REQUEST_TIMEOUT_MS = 10000;

let settingsCache = null;
let lastSaleErrorWritten = false;

export class TdpError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "TdpError";
        this.status = options.status || null;
        this.body = options.body || null;
        this.errorCode = options.errorCode || null;
    }
}

export function tdpPosConfigId(pos) {
    const config = pos && pos.config;
    if (config && config.id) {
        return config.id;
    }

    const legacy = pos && pos.config_id;
    if (typeof legacy === "number") {
        return legacy;
    }
    if (legacy && legacy.id) {
        return legacy.id;
    }

    return null;
}

export async function tdpGetSettings(pos, orm) {
    const configId = tdpPosConfigId(pos);
    if (!configId) {
        return null;
    }
    if (settingsCache && settingsCache.configId === configId) {
        return settingsCache.value;
    }

    let record = null;
    try {
        const records = await orm.read("pos.config", [configId], SETTINGS_FIELDS);
        record = records && records[0];
    } catch (error) {
        console.warn("[TDP] No se pudo leer la configuracion de Tienda de Puntos", error);
        return null;
    }

    if (!record) {
        return null;
    }

    const value = {
        configId,
        gatewayUrl: normalizeBaseUrl(record.x_tdp_gateway_url),
        apiKey: normalizeString(record.x_tdp_api_key) || "",
        branchId: Number(record.x_tdp_branch_id) || null,
        posExternalRef: normalizeString(record.x_tdp_pos_external_ref) || "",
    };

    settingsCache = { configId, value };
    return value;
}

export function tdpIsConfigured(settings) {
    return Boolean(settings && settings.gatewayUrl && settings.apiKey);
}

export async function tdpPost(settings, path, payload) {
    if (!tdpIsConfigured(settings)) {
        throw new TdpError("Este punto de venta todavia no esta conectado con Tienda de Puntos.");
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
    };
    if (settings.posExternalRef) {
        headers["x-odoo-pos-config-ref"] = settings.posExternalRef;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response = null;
    try {
        response = await fetch(settings.gatewayUrl + path, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            // La scoped key es la unica credencial: no mandamos cookies de Odoo a otro origen.
            credentials: "omit",
            mode: "cors",
            signal: controller.signal,
        });
    } catch (error) {
        throw new TdpError("No se pudo conectar con Tienda de Puntos.", {
            errorCode: error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        });
    } finally {
        clearTimeout(timer);
    }

    const body = await readJsonBody(response);

    if (!response.ok || (body && body.ok === false)) {
        throw new TdpError(extractErrorMessage(body, response), {
            status: response.status,
            body,
            errorCode: extractErrorCode(body),
        });
    }

    return body || {};
}

export function tdpNormalizePurchase(response, code) {
    const purchase = (response && response.purchase) || {};
    const client = purchase.client || {};
    const product = purchase.product || {};
    const status = String(purchase.status || "").toLowerCase();
    const expiresAt = purchase.expirationDate || purchase.expiresAt || null;
    const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ").trim();

    const isAlreadyRedeemed = status === "delivered";
    const isCanceled = status === "canceled";
    const isExpired = isDateInThePast(expiresAt);

    return {
        code: purchase.code || code,
        status,
        isAlreadyRedeemed,
        isCanceled,
        isExpired,
        isValid: !isAlreadyRedeemed && !isCanceled && !isExpired,
        expiresAt,
        productName: product.name || (purchase.moneyAmount ? `Canje por dinero (${purchase.moneyAmount})` : "-"),
        clientName: clientName || "-",
        clientEmail: client.email || "-",
        points: purchase.points || 0,
    };
}

export function tdpBuildSalePayload(order, settings) {
    const partner = orderPartner(order);
    const orderRef = orderReference(order);
    const totals = orderTotals(order);

    const payload = {
        external_id: orderRef,
        order_ref: orderRef,
        amount_net: totals.net,
        partner: {
            email: normalizeString(partner && partner.email),
            document_number: normalizeString(partner && partner.vat),
            first_name: normalizeString(partner && partner.name),
            phone: normalizeString(partner && (partner.phone || partner.mobile)),
        },
    };

    const orderId = Number(order && order.id);
    if (Number.isInteger(orderId) && orderId > 0) {
        payload.order_id = orderId;
    }
    if (settings && settings.branchId) {
        payload.branch_id = settings.branchId;
    }

    return payload;
}

export function tdpSalePayloadHasClient(payload) {
    const partner = (payload && payload.partner) || {};
    return Boolean(partner.email || partner.document_number);
}

/**
 * Deja el ultimo error de venta a la vista del comercio en Ajustes del POS.
 * Nunca puede romper la caja: si el cajero no tiene permiso de escritura sobre
 * `pos.config`, se ignora.
 */
export async function tdpWriteLastSaleError(pos, orm, message) {
    const configId = tdpPosConfigId(pos);
    if (!configId) {
        return;
    }
    if (!message && !lastSaleErrorWritten) {
        return;
    }

    try {
        await orm.write("pos.config", [configId], { x_tdp_last_sale_error: message || false });
        lastSaleErrorWritten = Boolean(message);
    } catch (error) {
        console.warn("[TDP] No se pudo registrar el ultimo error de venta", error);
    }
}

function normalizeString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(value) {
    const normalized = normalizeString(value);
    return normalized ? normalized.replace(/\/+$/, "") : "";
}

async function readJsonBody(response) {
    let text = "";
    try {
        text = await response.text();
    } catch (error) {
        return null;
    }

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function extractErrorMessage(body, response) {
    const data = (body && body.data) || {};
    const message =
        (body && (body.error || body.message)) || data.error || data.message || null;

    if (typeof message === "string" && message.trim()) {
        return message.trim();
    }
    if (Array.isArray(message) && message.length) {
        return String(message[0]);
    }
    if (response.status === 401 || response.status === 403) {
        return "Tienda de Puntos rechazo la credencial de este punto de venta.";
    }

    return `Tienda de Puntos respondio HTTP ${response.status}.`;
}

function extractErrorCode(body) {
    const data = (body && body.data) || {};
    return (body && body.error_code) || data.error_code || null;
}

function isDateInThePast(value) {
    if (!value) {
        return false;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp < Date.now();
}

function orderPartner(order) {
    if (!order) {
        return null;
    }
    if (typeof order.get_partner === "function") {
        return order.get_partner();
    }
    if (typeof order.getPartner === "function") {
        return order.getPartner();
    }
    return order.partner_id || order.partner || null;
}

function orderReference(order) {
    if (!order) {
        return "";
    }
    return (
        normalizeString(order.pos_reference) ||
        normalizeString(order.name) ||
        normalizeString(order.uuid) ||
        normalizeString(order.uid) ||
        ""
    );
}

function orderTotals(order) {
    const total = callOrRead(order, ["get_total_with_tax", "getTotalWithTax"], "amount_total");
    const tax = callOrRead(order, ["get_total_tax", "getTotalTax"], "amount_tax");
    return { total, tax, net: Math.round((total - tax) * 100) / 100 };
}

function callOrRead(order, methodNames, fallbackField) {
    for (const methodName of methodNames) {
        if (order && typeof order[methodName] === "function") {
            const value = Number(order[methodName]());
            if (Number.isFinite(value)) {
                return value;
            }
        }
    }

    const value = Number(order && order[fallbackField]);
    return Number.isFinite(value) ? value : 0;
}
