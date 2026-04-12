
"use strict";

const db = require("../config/database");
const { getSchemaFromReq } = require("../utils/tenantContext");

async function applyTenantSchema(req, res, next) {
  let client;

  try {
    const schema = getSchemaFromReq(req, { allowDefault: false });

    if (!schema) {
      return res.status(400).json({
        success: false,
        message: "Schema do tenant não encontrado.",
      });
    }

    client = await db.connect();
    await client.query(`set search_path to ${schema}, public`);

    req.dbClient = client;
    req.tenantSchema = schema;

    res.on("finish", () => {
      if (req.dbClient) {
        try {
          req.dbClient.release();
        } catch (_) {}
        req.dbClient = null;
      }
    });

    next();
  } catch (error) {
    if (client) {
      try { client.release(); } catch (_) {}
    }

    return res.status(500).json({
      success: false,
      message: "Erro ao aplicar schema do tenant.",
      error: error.message,
    });
  }
}

module.exports = { applyTenantSchema };
