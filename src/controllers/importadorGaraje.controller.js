"use strict";

/**
 * Importador Garaje (XML -> cadastraVeiculo)
 * - Evita duplicados por id_importacao
 * - Copia imagens do Garaje para o Cloudinary e salva URLs
 * - Pode rodar manual (endpoint) e por cron (12h e 18h)
 */

const axios = require("axios");
const cron = require("node-cron");
const { XMLParser } = require("fast-xml-parser");
require("dotenv").config();
const cloudinary = require("../services/Cloudinary.service");

// ajuste o caminho do seu db/pool
const db = require("../config/database");

// seu controller existente
const garagemwebController = require("../controllers/garagemweb.controller");

const DEFAULT_GARAJE_URL =
  process.env.GARAJE_URL ||
  "https://www.garaje.com.br/parceiros/sites/50/c0c7c76d30bd3dcaefc96f40275bdc0a";

const DEFAULT_SCHEMA = process.env.SCHEMA_PADRAO;
const TIMEZONE = process.env.TZ || "America/Sao_Paulo";

// ------------------------------------
// Helpers
// ------------------------------------
function normalizeText(v) {
  if (v == null) return null;
  if (typeof v === "object" && v.__cdata != null) {
    return String(v.__cdata).trim();
  }
  return String(v).trim();
}

function toInt(v) {
  const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toMoney(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchGarajeXml(url) {
  const { data: xml } = await axios.get(url, {
    timeout: 30000,
    responseType: "text",
    headers: { Accept: "application/xml,text/xml,*/*" },
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    cdataPropName: "__cdata",
    parseTagValue: true,
  });

  return parser.parse(xml);
}

/**
 * Map async com limite de concorrência
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await mapper(items[idx], idx);
      }
    });

  await Promise.all(workers);
  return results;
}

/**
 * Checa se já existe id_importacao (evita duplicado)
 */
async function jaImportado(schema, id_importacao) {
  if (!id_importacao) return false;

  const q = `
    SELECT 1
    FROM ${schema}.tab_veiculo
    WHERE ind_importado = true
      AND id_importacao = $1
    LIMIT 1
  `;
  const r = await db.query(q, [id_importacao]);
  return r.rowCount > 0;
}

/**
 * Copia imagem remota do Garaje para o Cloudinary
 */
async function uploadGarajeImageToCloudinary(url, publicId) {
  const result = await cloudinary.uploader.upload(url, {
    folder: "veiculos",
    public_id: publicId,
    overwrite: false,
    resource_type: "image",
    transformation: [
      { width: 1200, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" },
    ],
  });

  return result.secure_url;
}

/**
 * Mapeia um <veiculo> do XML para o payload do cadastraVeiculo
 * - Copia fotos para o Cloudinary e devolve URLs finais
 */
async function mapVeiculoToCadastroPayloadAsync(v) {
  const id_importacao = normalizeText(v.id);

  const marca = normalizeText(v.marca);
  const modelo = normalizeText(v.modelo);
  const versao = normalizeText(v.versao);

  const ano_fabricacao = toInt(v.ano);
  const ano_modelo = toInt(v.ano_modelo);

  const combustivel = normalizeText(v.combustivel);
  const portas = toInt(v.portas);

  const placa = normalizeText(v.placa);
  const chassis = normalizeText(v.chassi);
  const renavam = normalizeText(v.renavam);

  const cor = normalizeText(v.cor);
  const km = toInt(v.kilometragem);
  const cambio = normalizeText(v.cambio);

  const val_venda_esperado = toMoney(v.preco);
  const observacoes = normalizeText("Importado automaticamente do Garage");

   const ind_ajustado_importacao = false;

  const fotosNode = v.fotos?.imagem;
  const fotos = Array.isArray(fotosNode)
    ? fotosNode
    : fotosNode
      ? [fotosNode]
      : [];

  const urls = fotos
    .map((x) => normalizeText(x))
    .filter(Boolean)
    .slice(0, 12);

  const imagens_veiculo = await mapWithConcurrency(urls, 2, async (url, idx) => {
    const publicIdBase =
      placa || chassis || id_importacao || `veiculo_${Date.now()}`;
    const publicId = `garaje/${publicIdBase}_${idx + 1}`;

    const secureUrl = await uploadGarajeImageToCloudinary(url, publicId);

    return {
      id: idx + 1,
      src: secureUrl,
    };
  });

  return {
    dados_veiculo: {
      ind_tipo_veiculo: "I",
      nome_documento: null,
      des_veiculo_personalizado: null,
      documento: null,
      marca,
      modelo,
      modelo_completo: versao,
      ano_fabricacao,
      ano_modelo,
      placa,
      chassis,
      renavam,
      cor,
      crv: null,
      combustivel,
      motorizacao: null,
      portas,
      cambio,
      km,
      dta_compra: null,
      val_venda_esperado,
      observacoes,
      ind_ajustado_importacao,
      cod_parceiro: 0,
      des_proprietario: "Next Car",
      ind_veiculo_investidor: false,
      ind_importado: true,
      id_importacao,
      ind_excluido_garage: false,
    },
    imagens_veiculo,
  };
}

/**
 * Reaproveita seu cadastraVeiculo (sem HTTP real)
 */
async function chamarCadastraVeiculo(schema, payload) {
  const fakeReq = {
    body: payload,
    headers: { schema },
  };

  const fakeRes = {
    statusCode: 200,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this._json = obj;
      return this;
    },
  };

  if (typeof garagemwebController.cadastraVeiculo !== "function") {
    throw new Error(
      "garagemwebController.cadastraVeiculo não encontrado. Verifique o export."
    );
  }

  await garagemwebController.cadastraVeiculo(fakeReq, fakeRes);

  if (fakeRes.statusCode >= 400) {
    throw new Error(fakeRes._json?.message || "Falha ao cadastrar veículo");
  }

  return fakeRes._json;
}

// ------------------------------------
// Job principal
// ------------------------------------
async function importarGarajeJob({ schema, url }) {
  const json = await fetchGarajeXml(url);

  const veiculosNode = json?.estoque?.veiculo;
  const veiculos = Array.isArray(veiculosNode)
    ? veiculosNode
    : veiculosNode
      ? [veiculosNode]
      : [];

  if (!veiculos.length) {
    return { totalXml: 0, importados: 0, pulados: 0, erros: 0, detalhes: [] };
  }

  let importados = 0;
  let pulados = 0;
  let erros = 0;

  const detalhes = [];

  const idsXml = new Set(
    veiculos.map((v) => normalizeText(v?.id)).filter(Boolean)
  );

  if (veiculos.length > 0) {
    await db.query(
      `
      UPDATE ${schema}.tab_veiculo
         SET ind_excluido_garage = true
       WHERE ind_importado = true
         AND (ind_excluido_garage IS NULL OR ind_excluido_garage = false)
         AND id_importacao IS NOT NULL
         AND NOT (id_importacao = ANY($1))
      `,
      [Array.from(idsXml)]
    );
  }

  for (const v of veiculos) {
    const idImp = normalizeText(v?.id);

    try {
      if (await jaImportado(schema, idImp)) {
        pulados++;
        detalhes.push({ id_importacao: idImp, status: "pulado" });
        continue;
      }

      const payload = await mapVeiculoToCadastroPayloadAsync(v);

      await chamarCadastraVeiculo(schema, payload);

      importados++;
      detalhes.push({
        id_importacao: idImp,
        status: "importado",
        imgs: payload.imagens_veiculo.length,
      });
    } catch (e) {
      erros++;
      detalhes.push({
        id_importacao: idImp,
        status: "erro",
        error: e.message,
      });
    }
  }

  return {
    totalXml: veiculos.length,
    importados,
    pulados,
    erros,
    detalhes,
  };
}

// ------------------------------------
// Endpoint manual
// POST /importar-garaje  { url?: string, schema?: string }
// ------------------------------------
exports.importarGarajeManual = async (req, res) => {
  const schema = req.body?.schema || req.headers["schema"] || DEFAULT_SCHEMA;
  const url = req.body?.url || DEFAULT_GARAJE_URL;

  if (!schema) {
    return res.status(400).json({
      success: false,
      message: "schema obrigatório (header schema ou body.schema).",
    });
  }

  try {
    const result = await importarGarajeJob({ schema, url });
    return res.status(200).json({ success: true, schema, url, ...result });
  } catch (e) {
    console.error("importarGarajeManual erro:", e);
    return res.status(500).json({
      success: false,
      message: "Falha ao importar",
      error: e.message,
    });
  }
};

// ------------------------------------
// Cron 12h e 18h (America/Sao_Paulo)
// ------------------------------------
exports.startGarajeCron = ({
  schema = DEFAULT_SCHEMA,
  url = DEFAULT_GARAJE_URL,
} = {}) => {
  if (!schema) {
    console.warn("[CRON] schema não informado. Cron não iniciado.");
    return;
  }

  cron.schedule(
    "8 12,18 * * *",
    async () => {
      try {
        console.log("[CRON] Garaje import start", { schema });
        const r = await importarGarajeJob({ schema, url });
        console.log("[CRON] Garaje import done", r);
      } catch (e) {
        console.error("[CRON] Garaje import error:", e);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log(
    `[CRON] Garaje agendado 12:08 e 18:08 (${TIMEZONE}) — schema=${schema}`
  );
};