"use strict";

/**
 * Importador Garaje (XML -> cadastraVeiculo)
 * - Evita duplicados por id_importacao
 * - Permite atualizar dados e fotos de veiculos ja importados quando solicitado
 * - Copia imagens do Garaje para o Cloudinary e salva URLs
 * - Pode rodar manual (endpoint) e por cron (12h e 18h)
 */

const axios = require("axios");
const cron = require("node-cron");
const { XMLParser } = require("fast-xml-parser");
require("dotenv").config();
const cloudinary = require("../services/Cloudinary.service");
const { resolveSchemaValue, setTenantOnReq } = require("../utils/tenantContext");

// ajuste o caminho do seu db/pool
const db = require("../config/database");

// seu controller existente
const garagemwebController = require("../controllers/garagemweb.controller");

const DEFAULT_GARAJE_URL =
  process.env.GARAJE_URL ||
  "https://www.garaje.com.br/parceiros/sites/50/c0c7c76d30bd3dcaefc96f40275bdc0a";

const DEFAULT_SCHEMA = resolveSchemaValue(process.env.SCHEMA_PADRAO || "nextcar");
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
  const raw = String(v).trim();
  const onlyNumber = raw.replace(/[^\d,.-]/g, "");
  const lastComma = onlyNumber.lastIndexOf(",");
  const lastDot = onlyNumber.lastIndexOf(".");
  let s = onlyNumber;

  if (lastComma > lastDot) {
    s = onlyNumber.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && /[.,]\d{3}$/.test(onlyNumber)) {
    s = onlyNumber.replace(/[.,]/g, "");
  } else {
    s = onlyNumber.replace(/,/g, "");
  }

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
async function buscaImportados(schema, id_importacao) {
  if (!id_importacao) return [];

  const q = `
    SELECT
      seq_veiculo,
      ind_status,
      COALESCE(financeiro_incluso, false) AS financeiro_incluso,
      cod_movimentacao,
      COALESCE(cliques, 0) AS cliques,
      COALESCE(negociacoes_enviadas, 0) AS negociacoes_enviadas
    FROM ${schema}.tab_veiculo
    WHERE id_importacao::text = $1
      AND COALESCE(ind_status, 'A') <> 'E'
    ORDER BY
      CASE WHEN ind_status = 'V' THEN 1 ELSE 0 END,
      seq_veiculo DESC
  `;
  const r = await db.query(q, [String(id_importacao)]);
  return r.rows || [];
}

/**
 * Copia imagem remota do Garaje para o Cloudinary
 */
async function uploadGarajeImageToCloudinary(url, publicId, { overwrite = false } = {}) {
  const result = await cloudinary.uploader.upload(url, {
    folder: "veiculos",
    public_id: publicId,
    overwrite,
    invalidate: overwrite,
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
async function mapVeiculoToCadastroPayloadAsync(v, { overwriteImages = false } = {}) {
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

    const secureUrl = await uploadGarajeImageToCloudinary(url, publicId, {
      overwrite: overwriteImages,
    });

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

async function atualizarVeiculoImportado(schema, seqVeiculo, payload) {
  const dataAtual = new Date().toISOString();
  const { dados_veiculo, imagens_veiculo } = payload;

  const imagensValidas = Array.isArray(imagens_veiculo)
    ? imagens_veiculo.filter((img) => img && img.src).slice(0, 12)
    : [];

  const {
    marca,
    modelo,
    modelo_completo,
    ano_fabricacao,
    ano_modelo,
    placa,
    chassis,
    renavam,
    cor,
    combustivel,
    motorizacao,
    portas,
    cambio,
    km,
    val_venda_esperado,
    observacoes,
    ind_tipo_veiculo,
    cod_parceiro,
    des_proprietario,
    ind_veiculo_investidor,
    ind_ajustado_importacao,
    id_importacao,
  } = dados_veiculo;

  const veiculoFields = {
    des_veiculo: `${marca ?? ""} ${modelo ?? ""}`.trim(),
    observacoes,
    img_veiculo_capa_url: imagensValidas?.[0]?.src ?? null,
    val_venda_esperado,
    renavam,
    placa,
    ano_fabricacao,
    ano_modelo,
    des_veiculo_completa:
      `${marca ?? ""} ${modelo ?? ""} ${ano_fabricacao ?? ""} ${cor ?? ""}`.trim(),
    chassis,
    modelo,
    modelo_completo,
    marca,
    cor,
    km,
    combustivel,
    motorizacao,
    portas,
    cambio,
    ind_tipo_veiculo,
    cod_parceiro: cod_parceiro || 0,
    des_proprietario:
      ind_tipo_veiculo === "P" ? "Next Car" : des_proprietario,
    ind_veiculo_investidor,
    ind_ajustado_importacao,
    ind_importado: true,
    id_importacao,
    ind_excluido_garage: false,
    dta_ultima_alteracao: dataAtual,
  };

  Object.keys(veiculoFields).forEach((key) => {
    if (veiculoFields[key] === undefined) {
      delete veiculoFields[key];
    }
  });

  await db.transaction(async (client) => {
    const values = Object.values(veiculoFields);
    const setClause = Object.keys(veiculoFields)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(", ");

    values.push(seqVeiculo);

    const updateVeiculoQuery = `
      UPDATE ${schema}.tab_veiculo
         SET ${setClause}
       WHERE seq_veiculo = $${values.length}
         AND COALESCE(ind_status, 'A') <> 'V'
       RETURNING seq_veiculo;
    `;

    const veiculoResult = await client.query(updateVeiculoQuery, values);

    if (veiculoResult.rowCount === 0) {
      throw new Error("Veiculo importado nao encontrado para atualizacao");
    }

    await client.query(
      `DELETE FROM ${schema}.tab_veiculo_imagem WHERE seq_veiculo = $1`,
      [seqVeiculo],
    );

    if (imagensValidas.length > 0) {
      const columns = ["seq_veiculo"];
      const insertValues = [seqVeiculo];
      const placeholders = ["$1"];

      for (let i = 0; i < imagensValidas.length; i++) {
        const imageIndex = i + 1;
        columns.push(`img_${imageIndex}_url`);
        insertValues.push(imagensValidas[i].src);
        placeholders.push(`$${insertValues.length}`);
      }

      const insertImagensQuery = `
        INSERT INTO ${schema}.tab_veiculo_imagem
        (${columns.join(", ")})
        VALUES
        (${placeholders.join(", ")})
      `;

      await client.query(insertImagensQuery, insertValues);
    }
  });
}

function preservarContadores(existentes = []) {
  return existentes.reduce(
    (acc, item) => ({
      cliques: Math.max(acc.cliques, Number(item.cliques || 0)),
      negociacoes_enviadas: Math.max(
        acc.negociacoes_enviadas,
        Number(item.negociacoes_enviadas || 0),
      ),
    }),
    { cliques: 0, negociacoes_enviadas: 0 },
  );
}

async function inserirVeiculoImportado(client, schema, payload, { contadores = {} } = {}) {
  const dataAtual = new Date().toISOString();
  const { dados_veiculo, imagens_veiculo } = payload;

  const imagensValidas = Array.isArray(imagens_veiculo)
    ? imagens_veiculo.filter((img) => img && img.src).slice(0, 12)
    : [];

  const {
    ind_tipo_veiculo,
    nome_documento,
    des_veiculo_personalizado,
    documento,
    marca,
    modelo,
    modelo_completo,
    ano_fabricacao,
    ano_modelo,
    placa,
    chassis,
    renavam,
    cor,
    crv,
    combustivel,
    motorizacao,
    portas,
    cambio,
    km,
    dta_compra,
    val_venda_esperado,
    observacoes,
    cod_parceiro,
    des_proprietario,
    ind_veiculo_investidor,
    ind_ajustado_importacao,
    ind_importado,
    id_importacao,
    ind_excluido_garage,
  } = dados_veiculo;

  const veiculoFields = {
    des_veiculo: `${marca ?? ""} ${modelo ?? ""}`.trim(),
    des_veiculo_personalizado,
    observacoes:
      observacoes == null
        ? `Cor: ${cor ?? ""}, Combustivel: ${combustivel ?? ""}, Motor: ${motorizacao ?? ""}, Portas: ${portas ?? ""}, Cambio: ${cambio ?? ""}, KM: ${km ?? ""}`
        : observacoes,
    dta_compra,
    img_veiculo_capa_url: imagensValidas?.[0]?.src ?? null,
    ind_tipo_veiculo,
    des_proprietario:
      ind_tipo_veiculo === "P" ? "Next Car" : des_proprietario,
    val_venda_esperado,
    cod_parceiro: cod_parceiro || 0,
    documento,
    nome_documento,
    renavam,
    placa,
    ano_fabricacao,
    ano_modelo,
    des_veiculo_completa:
      `${marca ?? ""} ${modelo ?? ""} ${ano_fabricacao ?? ""} ${cor ?? ""}`.trim(),
    chassis,
    modelo,
    modelo_completo,
    marca,
    cor,
    crv,
    km,
    dta_lancamento: dataAtual,
    dta_ultima_alteracao: dataAtual,
    combustivel,
    motorizacao,
    portas,
    cambio,
    valor_investido_investidor: 0,
    valor_investido_proprio: 0,
    ind_veiculo_investidor,
    ind_ajustado_importacao,
    ind_importado,
    id_importacao,
    ind_excluido_garage,
    cliques: Number(contadores.cliques || 0),
    negociacoes_enviadas: Number(contadores.negociacoes_enviadas || 0),
  };

  const fixedValues = {
    ind_status: "A",
    val_venda: null,
    val_compra: null,
    dta_venda: null,
    ind_troca: null,
    seq_veiculo_origem: null,
    ind_retorno_vinculado: false,
    cod_usuario_vinculado: 0,
    ind_ocorrencia_aberta: false,
    ind_financiado: false,
  };

  const allFields = {
    ...veiculoFields,
    ...fixedValues,
  };

  Object.keys(allFields).forEach((key) => {
    if (allFields[key] === undefined) {
      delete allFields[key];
    }
  });

  const columns = Object.keys(allFields);
  const values = Object.values(allFields);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

  const veiculoResult = await client.query(
    `
    INSERT INTO ${schema}.tab_veiculo (
      ${columns.join(", ")}
    ) VALUES (
      ${placeholders}
    )
    RETURNING seq_veiculo;
    `,
    values,
  );

  const seqVeiculo = veiculoResult.rows[0].seq_veiculo;

  if (imagensValidas.length > 0) {
    const imageColumns = ["seq_veiculo"];
    const imageValues = [seqVeiculo];
    const imagePlaceholders = ["$1"];

    for (let i = 0; i < imagensValidas.length; i++) {
      const imageIndex = i + 1;
      imageColumns.push(`img_${imageIndex}_url`);
      imageValues.push(imagensValidas[i].src);
      imagePlaceholders.push(`$${imageValues.length}`);
    }

    await client.query(
      `
      INSERT INTO ${schema}.tab_veiculo_imagem
      (${imageColumns.join(", ")})
      VALUES
      (${imagePlaceholders.join(", ")})
      `,
      imageValues,
    );
  }

  return seqVeiculo;
}

async function reinserirVeiculosImportados(schema, existentes, payload) {
  const substituiveis = existentes.filter((item) => item.ind_status !== "V");
  const seqs = substituiveis.map((item) => Number(item.seq_veiculo)).filter(Boolean);

  if (seqs.length === 0) {
    throw new Error("Nenhum veiculo importado disponivel para reinsercao");
  }

  const contadores = preservarContadores(substituiveis);

  return db.transaction(async (client) => {
    await client.query(
      `DELETE FROM ${schema}.tab_veiculo_imagem WHERE seq_veiculo = ANY($1::int[])`,
      [seqs],
    );

    await client.query(
      `
      DELETE FROM ${schema}.tab_veiculo
       WHERE seq_veiculo = ANY($1::int[])
         AND COALESCE(ind_status, 'A') <> 'V'
      `,
      [seqs],
    );

    return inserirVeiculoImportado(client, schema, payload, { contadores });
  });
}

/**
 * Reaproveita seu cadastraVeiculo (sem HTTP real)
 */
async function chamarCadastraVeiculo(schema, payload) {
  const fakeReq = setTenantOnReq({
    body: payload,
    headers: {},
  }, { schema });

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
async function importarGarajeJob({
  schema,
  url,
  atualizarExistentes = false,
  reinserir = false,
}) {
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
  let atualizados = 0;
  let reinseridos = 0;
  let pulados = 0;
  let erros = 0;

  const detalhes = [];

  const idsXml = new Set(
    veiculos.map((v) => normalizeText(v?.id)).filter(Boolean)
  );

  if (idsXml.size > 0) {
    await db.query(
      `
      UPDATE ${schema}.tab_veiculo
         SET ind_excluido_garage = true
       WHERE ind_importado = true
         AND (ind_excluido_garage IS NULL OR ind_excluido_garage = false)
         AND id_importacao IS NOT NULL
         AND NOT (id_importacao::text = ANY($1::text[]))
      `,
      [Array.from(idsXml)]
    );
  }

  for (const v of veiculos) {
    const idImp = normalizeText(v?.id);

    try {
      const existentes = await buscaImportados(schema, idImp);
      const existentesAtivos = existentes.filter((item) => item.ind_status !== "V");
      const existentesVendidos = existentes.filter((item) => item.ind_status === "V");
      const existente = existentesAtivos[0] || existentes[0] || null;

      if (existente && !atualizarExistentes) {
        pulados++;
        detalhes.push({ id_importacao: idImp, status: "pulado" });
        continue;
      }

      const payload = await mapVeiculoToCadastroPayloadAsync(v, {
        overwriteImages: Boolean(existente && atualizarExistentes),
      });

      if (existente) {
        if (existentesAtivos.length === 0 && existentesVendidos.length > 0) {
          pulados++;
          detalhes.push({
            id_importacao: idImp,
            seq_veiculo: existente.seq_veiculo,
            status: "pulado_vendido",
          });
          continue;
        }

        if (reinserir || existentesAtivos.length > 1) {
          const seqNovo = await reinserirVeiculosImportados(schema, existentesAtivos, payload);

          reinseridos++;
          detalhes.push({
            id_importacao: idImp,
            seq_veiculo: seqNovo,
            seq_veiculos_removidos: existentesAtivos.map((item) => item.seq_veiculo),
            status: "reinserido",
            motivo: reinserir ? "solicitado" : "duplicidade",
            imgs: payload.imagens_veiculo.length,
          });
          continue;
        }

        try {
          await atualizarVeiculoImportado(schema, existente.seq_veiculo, payload);
        } catch (updateError) {
          const seqNovo = await reinserirVeiculosImportados(schema, existentesAtivos, payload);

          reinseridos++;
          detalhes.push({
            id_importacao: idImp,
            seq_veiculo: seqNovo,
            seq_veiculos_removidos: existentesAtivos.map((item) => item.seq_veiculo),
            status: "reinserido",
            motivo: "fallback_update",
            erro_update: updateError.message,
            imgs: payload.imagens_veiculo.length,
          });
          continue;
        }

        atualizados++;
        detalhes.push({
          id_importacao: idImp,
          seq_veiculo: existente.seq_veiculo,
          status: "atualizado",
          imgs: payload.imagens_veiculo.length,
        });
        continue;
      }

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
    atualizados,
    reinseridos,
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
  const atualizarExistentes =
    req.body?.atualizarExistentes === true ||
    req.body?.reinserir === true ||
    req.body?.forceUpdate === true;
  const reinserir =
    req.body?.reinserir === true ||
    req.body?.forceReinsert === true ||
    req.body?.forcarReinsercao === true;

  if (!schema) {
    return res.status(400).json({
      success: false,
      message: "schema obrigatório (header schema ou body.schema).",
    });
  }

  try {
    const result = await importarGarajeJob({
      schema,
      url,
      atualizarExistentes,
      reinserir,
    });
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
