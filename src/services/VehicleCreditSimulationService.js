"use strict";

const axios = require("axios");

const BANKS = [
  { id: "pan", name: "PAN", envPrefix: "CREDIT_BANK_PAN" },
  { id: "bradesco", name: "Bradesco", envPrefix: "CREDIT_BANK_BRADESCO" },
  { id: "itau", name: "Itau", envPrefix: "CREDIT_BANK_ITAU" },
  { id: "bv", name: "BV", envPrefix: "CREDIT_BANK_BV" },
  { id: "santander", name: "Santander", envPrefix: "CREDIT_BANK_SANTANDER" },
  { id: "omini", name: "Omini", envPrefix: "CREDIT_BANK_OMINI" },
  { id: "carbank", name: "Carbank", envPrefix: "CREDIT_BANK_CARBANK" },
];

const DEFAULT_TIMEOUT_MS = Number(process.env.CREDIT_BANK_TIMEOUT_MS || 15000);

function normalizeBankId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonEnv(value) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_) {
    return {};
  }
}

function getNestedValue(source, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let current = source;

    for (const part of parts) {
      current = current?.[part];
    }

    if (current !== undefined && current !== null && current !== "") {
      return current;
    }
  }

  return null;
}

function parseCurrency(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim();
  const numeric = raw.replace(/[^\d,.-]/g, "");
  if (!numeric) return null;

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  let normalized = numeric;

  if (lastComma > lastDot) {
    normalized = numeric.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && /[.,]\d{3}$/.test(numeric)) {
    normalized = numeric.replace(/[.,]/g, "");
  } else {
    normalized = numeric.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveBankConfig(bank) {
  const prefix = bank.envPrefix;
  const url = process.env[`${prefix}_URL`] || "";
  const token = process.env[`${prefix}_TOKEN`] || "";
  const apiKey = process.env[`${prefix}_API_KEY`] || "";
  const clientId = process.env[`${prefix}_CLIENT_ID`] || "";
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] || "";
  const timeoutMs = Number(process.env[`${prefix}_TIMEOUT_MS`] || DEFAULT_TIMEOUT_MS);
  const extraHeaders = parseJsonEnv(process.env[`${prefix}_HEADERS`]);

  return {
    bankId: bank.id,
    bankName: bank.name,
    configured: Boolean(url),
    url,
    token,
    apiKey,
    clientId,
    clientSecret,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    extraHeaders,
  };
}

function getRequestHeaders(config) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...config.extraHeaders,
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  if (config.clientId) {
    headers["x-client-id"] = config.clientId;
  }

  if (config.clientSecret) {
    headers["x-client-secret"] = config.clientSecret;
  }

  return headers;
}

function normalizeBankOffer(rawOffer, bank) {
  const prazoMeses = toNumber(
    getNestedValue(rawOffer, ["prazoMeses", "prazo", "parcelas", "term", "months"]),
  );
  const parcela = parseCurrency(
    getNestedValue(rawOffer, [
      "valorParcela",
      "parcela",
      "installment",
      "monthlyInstallment",
      "payment.monthly",
    ]),
  );
  const taxaMensal = parseCurrency(
    getNestedValue(rawOffer, [
      "taxaMensal",
      "taxaJuros",
      "jurosMes",
      "monthlyRate",
      "rate",
      "interest.monthly",
    ]),
  );
  const totalFinanciado = parseCurrency(
    getNestedValue(rawOffer, [
      "totalFinanciado",
      "valorTotal",
      "total",
      "totalPaid",
      "amount.total",
    ]),
  );
  const valorLiberado = parseCurrency(
    getNestedValue(rawOffer, [
      "valorLiberado",
      "valorFinanciado",
      "principal",
      "amount.financed",
    ]),
  );

  return {
    bankId: bank.id,
    bankName: bank.name,
    status:
      getNestedValue(rawOffer, ["status", "situacao", "resultado", "decision"]) ||
      "analysis",
    protocolo:
      getNestedValue(rawOffer, ["protocolo", "protocol", "id", "simulationId"]) ||
      null,
    prazoMeses: prazoMeses || null,
    valorParcela: parcela,
    taxaMensal,
    totalFinanciado,
    valorLiberado,
    observacao:
      getNestedValue(rawOffer, ["observacao", "mensagem", "message", "note"]) ||
      null,
    raw: rawOffer,
  };
}

function normalizeBankResponse(responseData, bank) {
  const payload = responseData?.data || responseData;
  const offers =
    payload?.ofertas ||
    payload?.offers ||
    payload?.simulacoes ||
    payload?.simulations ||
    payload?.propostas ||
    payload?.proposals ||
    payload?.resultado ||
    payload;
  const offerList = Array.isArray(offers) ? offers : [offers];

  return {
    bankId: bank.id,
    bankName: bank.name,
    configured: true,
    success: true,
    status:
      getNestedValue(payload, ["status", "situacao", "resultado", "decision"]) ||
      "received",
    protocolo:
      getNestedValue(payload, ["protocolo", "protocol", "id", "simulationId"]) ||
      null,
    message:
      getNestedValue(payload, ["mensagem", "message", "observacao", "note"]) ||
      "Retorno recebido do parceiro.",
    offers: offerList
      .filter((offer) => offer && typeof offer === "object")
      .map((offer) => normalizeBankOffer(offer, bank)),
    raw: payload,
  };
}

class VehicleCreditSimulationService {
  getBanks() {
    return BANKS.map((bank) => {
      const config = resolveBankConfig(bank);

      return {
        id: bank.id,
        name: bank.name,
        configured: config.configured,
      };
    });
  }

  validatePayload(payload = {}) {
    const valorVeiculo = toNumber(payload.valorVeiculo);
    const entrada = toNumber(payload.entrada);
    const prazoMeses = toNumber(payload.prazoMeses);
    const valorFinanciado = Math.max(
      toNumber(payload.valorFinanciado) || valorVeiculo - entrada,
      0,
    );

    if (valorVeiculo <= 0) {
      throw new Error("Valor do veiculo e obrigatorio.");
    }

    if (entrada < 0) {
      throw new Error("Entrada nao pode ser negativa.");
    }

    if (valorFinanciado <= 0) {
      throw new Error("Valor financiado deve ser maior que zero.");
    }

    if (prazoMeses < 1) {
      throw new Error("Prazo e obrigatorio.");
    }

    return {
      ...payload,
      valorVeiculo,
      entrada,
      prazoMeses,
      valorFinanciado,
    };
  }

  resolveBanks(requestedBanks) {
    if (!requestedBanks || !requestedBanks.length) return BANKS;

    const requested = new Set(requestedBanks.map(normalizeBankId));
    return BANKS.filter((bank) => requested.has(normalizeBankId(bank.id)));
  }

  buildPartnerPayload(payload, bank, context = {}) {
    return {
      banco: bank.id,
      bancoNome: bank.name,
      schema: context.schema || null,
      cliente: {
        nome: payload.nome || null,
        documento: payload.documento || null,
        whatsapp: payload.whatsapp || null,
        email: payload.email || null,
      },
      veiculo: {
        descricao: payload.veiculoInteresse || null,
        valor: payload.valorVeiculo,
        ano: payload.anoVeiculo || null,
        placa: payload.placa || null,
      },
      financiamento: {
        valorVeiculo: payload.valorVeiculo,
        entrada: payload.entrada,
        valorFinanciado: payload.valorFinanciado,
        prazoMeses: payload.prazoMeses,
      },
      metadata: {
        origem: payload.origem || "simulador-compra-veiculo",
        requestedAt: new Date().toISOString(),
      },
    };
  }

  async simulateBank(bank, payload, context = {}) {
    const config = resolveBankConfig(bank);

    if (!config.configured) {
      return {
        bankId: bank.id,
        bankName: bank.name,
        configured: false,
        success: false,
        status: "not_configured",
        message: `Integracao ${bank.name} nao configurada no backend.`,
        offers: [],
      };
    }

    try {
      const response = await axios.post(
        config.url,
        this.buildPartnerPayload(payload, bank, context),
        {
          timeout: config.timeoutMs,
          headers: getRequestHeaders(config),
        },
      );

      return normalizeBankResponse(response.data, bank);
    } catch (error) {
      const statusCode = error?.response?.status || null;
      const responseData = error?.response?.data || null;

      return {
        bankId: bank.id,
        bankName: bank.name,
        configured: true,
        success: false,
        status: "error",
        statusCode,
        message:
          responseData?.message ||
          responseData?.error ||
          error.message ||
          `Falha ao consultar ${bank.name}.`,
        offers: [],
        raw: responseData,
      };
    }
  }

  async simulate(payload = {}, context = {}) {
    const normalizedPayload = this.validatePayload(payload);
    const banks = this.resolveBanks(normalizedPayload.bancos);

    if (!banks.length) {
      throw new Error("Nenhum banco valido informado.");
    }

    const results = await Promise.all(
      banks.map((bank) => this.simulateBank(bank, normalizedPayload, context)),
    );

    return {
      requestedAt: new Date().toISOString(),
      input: {
        valorVeiculo: normalizedPayload.valorVeiculo,
        entrada: normalizedPayload.entrada,
        prazoMeses: normalizedPayload.prazoMeses,
        valorFinanciado: normalizedPayload.valorFinanciado,
        veiculoInteresse: normalizedPayload.veiculoInteresse || null,
      },
      banks: results,
      summary: {
        totalBanks: results.length,
        configuredBanks: results.filter((result) => result.configured).length,
        successfulBanks: results.filter((result) => result.success).length,
        pendingConfigurationBanks: results.filter(
          (result) => result.status === "not_configured",
        ).length,
      },
    };
  }
}

module.exports = new VehicleCreditSimulationService();
