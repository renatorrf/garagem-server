"use strict";

const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const FALLBACK_TEMPLATE_SIZE = Number(process.env.FOTO_TEMPLATE_SIZE || 1254);
const MAX_FILES = Number(process.env.FOTO_TEMPLATE_MAX_FILES || 12);
const CONCURRENCY = Number(process.env.FOTO_TEMPLATE_CONCURRENCY || 2);
const TEMPLATE_PATH = path.resolve(
  process.env.FOTO_TEMPLATE_PATH ||
    path.join(__dirname, "..", "..", "assets", "template_sem_bg.png"),
);

let cachedTemplateAsset = null;

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value[0] : "";
  }

  return value == null ? "" : String(value);
}

function bufferToDataUri(buffer, mimeType = "image/jpeg") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeMoneyDisplay(value) {
  const text = normalizeText(value, "");

  if (!text) {
    return "--";
  }

  const cleaned = text.replace(/\s+/g, " ").trim();

  if (/^r\$/i.test(cleaned)) {
    return cleaned.replace(/^r\$\s*/i, "R$ ");
  }

  return `R$ ${cleaned}`;
}

function getNumberEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function collectFiles(req) {
  const files = Array.isArray(req.files) ? req.files : [];

  return files.filter(
    (file) =>
      file &&
      typeof file === "object" &&
      typeof file.mimetype === "string" &&
      file.mimetype.startsWith("image/"),
  );
}

function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 1, items.length || 1),
  );
  const results = new Array(items.length);
  let index = 0;

  const workers = new Array(safeLimit).fill(null).map(async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });

  return Promise.all(workers).then(() => results);
}

function buildValueLayerSvg({ width, height, valor, ano, km }) {
  const gold = "#f3be1b";
  const shadow = "#000000";
  const valorX = Math.round(
    getNumberEnv("FOTO_TEMPLATE_VALOR_X", width * 0.085),
  );
  const anoX = Math.round(getNumberEnv("FOTO_TEMPLATE_ANO_X", width * 0.320));
  const kmX = Math.round(getNumberEnv("FOTO_TEMPLATE_KM_X", width * 0.520));
  const footerY = Math.round(
    getNumberEnv("FOTO_TEMPLATE_FOOTER_TEXT_Y", height * 0.936),
  );
  const valueFont = Math.round(
    getNumberEnv("FOTO_TEMPLATE_FOOTER_FONT", height * 0.024),
  );
  const valorTextLength = Math.round(width * 0.17);
  const compactTextLength = Math.round(width * 0.1);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <filter id="text-shadow" x="-20%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="${shadow}" flood-opacity="0.8" />
        </filter>
      </defs>

      <g filter="url(#text-shadow)" fill="${gold}" stroke="#000000" stroke-width="2" paint-order="stroke fill">
        <text
          x="${valorX}"
          y="${footerY}"
          font-family="Arial Narrow, Arial, Helvetica, sans-serif"
          font-size="${valueFont}"
          font-weight="900"
          textLength="${valorTextLength}"
          lengthAdjust="spacingAndGlyphs"
          dominant-baseline="middle"
          alignment-baseline="middle"
        >${escapeXml(valor || "--")}</text>

        <text
          x="${anoX}"
          y="${footerY}"
          font-family="Arial Narrow, Arial, Helvetica, sans-serif"
          font-size="${valueFont}"
          font-weight="900"
          textLength="${compactTextLength}"
          lengthAdjust="spacingAndGlyphs"
          dominant-baseline="middle"
          alignment-baseline="middle"
        >${escapeXml(ano || "--")}</text>

        <text
          x="${kmX}"
          y="${footerY}"
          font-family="Arial Narrow, Arial, Helvetica, sans-serif"
          font-size="${valueFont}"
          font-weight="900"
          textLength="${compactTextLength}"
          lengthAdjust="spacingAndGlyphs"
          dominant-baseline="middle"
          alignment-baseline="middle"
        >${escapeXml(km || "--")}</text>
      </g>
    </svg>
  `;
}

async function getTemplateAsset() {
  try {
    const stats = await fs.stat(TEMPLATE_PATH);

    if (cachedTemplateAsset && cachedTemplateAsset.mtimeMs === stats.mtimeMs) {
      return cachedTemplateAsset.asset;
    }

    const buffer = await fs.readFile(TEMPLATE_PATH);
    const metadata = await sharp(buffer, { failOnError: false }).metadata();

    const asset = {
      buffer,
      width: metadata.width || FALLBACK_TEMPLATE_SIZE,
      height: metadata.height || FALLBACK_TEMPLATE_SIZE,
    };

    cachedTemplateAsset = {
      mtimeMs: stats.mtimeMs,
      asset,
    };

    return asset;
  } catch (error) {
    throw new Error(
      `Nao foi possivel carregar o template em ${TEMPLATE_PATH}: ${error.message}`,
    );
  }
}

function normalizeTemplateMeta(req) {
  const query = req?.query || {};
  const body = req?.body || {};

  const valor = normalizeText(
    normalizeQueryValue(query.valor) ||
      normalizeQueryValue(body.valor) ||
      normalizeQueryValue(query.price) ||
      normalizeQueryValue(body.price),
    "",
  );
  const ano = normalizeText(
    normalizeQueryValue(query.ano) ||
      normalizeQueryValue(body.ano) ||
      normalizeQueryValue(query.year) ||
      normalizeQueryValue(body.year),
    "",
  );
  const km = normalizeText(
    normalizeQueryValue(query.km) ||
      normalizeQueryValue(body.km) ||
      normalizeQueryValue(query.quilometragem) ||
      normalizeQueryValue(body.quilometragem),
    "",
  );

  return {
    valor: normalizeMoneyDisplay(valor),
    ano: ano || "--",
    km: km || "--",
  };
}

async function renderVehicleCard(file, meta, templateAsset) {
  const rotated = await sharp(file.buffer, { failOnError: false })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  const canvasWidth = templateAsset.width;
  const canvasHeight = templateAsset.height;

  const vehicleLayer = await sharp(rotated.data, { failOnError: false })
    .resize(canvasWidth, canvasHeight, {
      fit: "contain",
      position: "centre",
      background: "#000000",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  const valuesLayer = Buffer.from(
    buildValueLayerSvg({
      width: canvasWidth,
      height: canvasHeight,
      valor: meta.valor,
      ano: meta.ano,
      km: meta.km,
    }),
  );

  const { data, info } = await sharp(vehicleLayer, { failOnError: false })
    .composite([{ input: templateAsset.buffer }, { input: valuesLayer }])
    .flatten({ background: "#000000" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    info,
  };
}

async function editarComTemplate(req, res) {
  try {
    const files = collectFiles(req);

    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: "Nenhuma foto enviada.",
      });
    }

    if (files.length > MAX_FILES) {
      return res.status(400).json({
        success: false,
        message: `Envie no maximo ${MAX_FILES} imagens por vez.`,
      });
    }

    const templateAsset = await getTemplateAsset();
    const templateMeta = normalizeTemplateMeta(req);

    const imagens = await mapWithConcurrency(
      files,
      CONCURRENCY,
      async (file, index) => {
        const processed = await renderVehicleCard(
          file,
          templateMeta,
          templateAsset,
        );
        const safeBaseName = normalizeText(
          file.originalname,
          `foto_${index + 1}`,
        )
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-z0-9_-]+/gi, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");

        const fileName = `${safeBaseName || `foto_${index + 1}`}_template.jpg`;

        return {
          nome_original: file.originalname || fileName,
          nome_saida: fileName,
          mimeType: "image/jpeg",
          width: processed.info.width,
          height: processed.info.height,
          size: processed.info.size,
          base64: processed.buffer.toString("base64"),
          dataUrl: bufferToDataUri(processed.buffer),
        };
      },
    );

    return res.json({
      success: true,
      mode: "local",
      total: imagens.length,
      template: {
        path: TEMPLATE_PATH,
        width: templateAsset.width,
        height: templateAsset.height,
        maxFiles: MAX_FILES,
      },
      inputs: templateMeta,
      imagens,
    });
  } catch (error) {
    console.error("Erro ao editar fotos com template:", error);

    return res.status(500).json({
      success: false,
      message: "Erro ao editar fotos.",
      details: error?.message,
    });
  }
}

module.exports = {
  editarComTemplate,
  buildValueLayerSvg,
  renderVehicleCard,
};
