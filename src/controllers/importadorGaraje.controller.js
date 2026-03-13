'use strict';

/**
 * Importador Garaje (XML -> cadastraVeiculo)
 * - Evita duplicados por id_importacao
 * - Baixa imagens e converte para base64 (data URL)
 * - Pode rodar manual (endpoint) e por cron (12h e 18h)
 */

const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
require("dotenv").config();
const moment = require('moment')

// ✅ ajuste o caminho do seu db/pool
const db = require('../config/database'); // ex: ../db ou ../services/db

// ✅ seu controller existente (como você pediu)
const garagemwebController = require('../controllers/garagemweb.controller');
// esperado: garagemwebController.cadastraVeiculo(req,res)

const DEFAULT_GARAJE_URL =
  process.env.GARAJE_URL ||
  'https://www.garaje.com.br/parceiros/sites/50/c0c7c76d30bd3dcaefc96f40275bdc0a';

const DEFAULT_SCHEMA = process.env.SCHEMA_PADRAO; // ex: "nextcar"
const TIMEZONE = process.env.TZ || 'America/Sao_Paulo';

// ------------------------------------
// Helpers
// ------------------------------------
function normalizeText(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.__cdata != null) return String(v.__cdata).trim();
  return String(v).trim();
}

function toInt(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function toMoney(v) {
  if (v == null) return null;
  // "39900,00" => 39900.00
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function guessMimeFromUrl(url) {
  const ext = (path.extname(url || '').toLowerCase() || '').replace('.', '');
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] || 'application/octet-stream';
}

async function fetchGarajeXml(url) {
  const { data: xml } = await axios.get(url, {
    timeout: 30000,
    responseType: 'text',
    headers: { Accept: 'application/xml,text/xml,*/*' },
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    cdataPropName: '__cdata',
    parseTagValue: true,
  });

  return parser.parse(xml);
}

/**
 * Baixa uma imagem e retorna DataURL base64: data:image/webp;base64,...
 */
async function downloadImageAsDataUrl(url) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'NextCarImporter/1.0' },
  });

  const contentType = resp.headers?.['content-type'] || guessMimeFromUrl(url);
  const base64 = Buffer.from(resp.data).toString('base64');

  return `data:${contentType};base64,${base64}`;
}

/**
 * Map async com limite de concorrência
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
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
 * Mapeia um <veiculo> do XML para o payload do cadastraVeiculo
 * - Baixa fotos e converte para base64 dataURL
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

  // pode conter HTML no CDATA
  const observacoes = normalizeText('Importado automaticamente do Garage');

  const fotosNode = v.fotos?.imagem;
  const fotos = Array.isArray(fotosNode) ? fotosNode : (fotosNode ? [fotosNode] : []);
  const urls = fotos
    .map(x => normalizeText(x))
    .filter(Boolean)
    .slice(0, 12);

  // baixa 3 por vez (ajuste conforme infra)
  const imagens_veiculo = await mapWithConcurrency(urls, 3, async (url, idx) => {
    const dataUrl = await downloadImageAsDataUrl(url);
    return { id: idx + 1, src: dataUrl };
  });

  return {
    dados_veiculo: {
      // seu método diz que 'P' é para lojista ajustar se necessário
      ind_tipo_veiculo: 'P',

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

      dta_compra: moment().format(),
      val_venda_esperado,

      observacoes,

      cod_parceiro: 0,
      des_proprietario: 'Next Car', // ajuste se necessário
      ind_veiculo_investidor: false,

      ind_importado: true,
      id_importacao,
      ind_excluido_garage: false
    },
    imagens_veiculo,
  };
}

/**
 * Reaproveita seu cadastraVeiculo (sem HTTP)
 */
async function chamarCadastraVeiculo(schema, payload) {
  const fakeReq = {
    body: payload,
    headers: { schema },
  };

  const fakeRes = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; return this; },
  };

  if (typeof garagemwebController.cadastraVeiculo !== 'function') {
    throw new Error('garagemwebController.cadastraVeiculo não encontrado. Verifique o export.');
  }

  await garagemwebController.cadastraVeiculo(fakeReq, fakeRes);

  if (fakeRes.statusCode >= 400) {
    throw new Error(fakeRes._json?.message || 'Falha ao cadastrar veículo');
  }

  return fakeRes._json;
}

// ------------------------------------
// Job principal
// ------------------------------------
async function importarGarajeJob({ schema, url }) {
  const json = await fetchGarajeXml(url);

  const veiculosNode = json?.estoque?.veiculo;
  const veiculos = Array.isArray(veiculosNode) ? veiculosNode : (veiculosNode ? [veiculosNode] : []);

  if (!veiculos.length) {
    return { totalXml: 0, importados: 0, pulados: 0, erros: 0, detalhes: [] };
  }

  let importados = 0;
  let pulados = 0;
  let erros = 0;

  const detalhes = [];

  // 1) Monta Set dos IDs existentes no XML
  const idsXml = new Set(
    veiculos
      .map(v => normalizeText(v?.id))
      .filter(Boolean)
  );

  // 2) Marca como excluído tudo que foi importado e NÃO está mais no XML
  // (somente se ainda estiver false, pra não ficar atualizando sempre)
  if (veiculos.length > 0) {
    await db.query(
      `
    UPDATE ${schema}.tab_veiculo
       SET ind_excluido_garage = true
     WHERE ind_importado = true
       AND (ind_excluido_garage IS NULL OR ind_excluido_garage = false)
       AND id_importacao IS NOT NULL
       AND id_importacao <> 0
       AND NOT (id_importacao = ANY($1))
    `,
      [Array.from(idsXml)]
    );
  }

  for (const v of veiculos) {
    const idImp = normalizeText(v?.id);

    try {
      // evita duplicado por id_importacao
      if (await jaImportado(schema, idImp)) {
        pulados++;
        detalhes.push({ id_importacao: idImp, status: 'pulado' });
        continue;
      }

      // monta payload (inclui download base64 das imagens)
      const payload = await mapVeiculoToCadastroPayloadAsync(v);

      // se vier sem imagens, ainda cadastra (se seu método aceitar capa null)
      // recomendação: no cadastraVeiculo usar imagens_veiculo?.[0]?.src ?? null
      await chamarCadastraVeiculo(schema, payload);

      importados++;
      detalhes.push({ id_importacao: idImp, status: 'importado', imgs: payload.imagens_veiculo.length });
    } catch (e) {
      erros++;
      detalhes.push({ id_importacao: idImp, status: 'erro', error: e.message });
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
// Endpoint manual (opcional)
// POST /importar-garaje  { url?: string, schema?: string }
// ------------------------------------
exports.importarGarajeManual = async (req, res) => {
  const schema = req.body?.schema || req.headers['schema'] || DEFAULT_SCHEMA;
  const url = req.body?.url || DEFAULT_GARAJE_URL;

  if (!schema) {  
    return res.status(400).json({ success: false, message: 'schema obrigatório (header schema ou body.schema).' });
  }

  try {
    const result = await importarGarajeJob({ schema, url });
    return res.status(200).json({ success: true, schema, url, ...result });
  } catch (e) {
    console.error('importarGarajeManual erro:', e);
    return res.status(500).json({ success: false, message: 'Falha ao importar', error: e.message });
  }
};

// ------------------------------------
// Cron 12h e 18h (America/Sao_Paulo)
// ------------------------------------
exports.startGarajeCron = ({ schema = DEFAULT_SCHEMA, url = DEFAULT_GARAJE_URL } = {}) => {
  if (!schema) {
    console.warn('[CRON] schema não informado. Cron não iniciado.');
    return;
  }

  cron.schedule(
    '8 12,18 * * *',
    //'* * * * *',
    async () => {
      try {
        console.log('[CRON] Garaje import start', { schema });
        const r = await importarGarajeJob({ schema, url });
        console.log('[CRON] Garaje import done', r);
      } catch (e) {
        console.error('[CRON] Garaje import error:', e);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log(`[CRON] Garaje agendado 12:00 e 18:00 (${TIMEZONE}) — schema=${schema}`);
};
