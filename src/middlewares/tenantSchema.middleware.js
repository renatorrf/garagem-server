const db = require("../config/database");

function assertValidSchemaName(schema) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema || "")) {
    throw new Error("Schema inválido.");
  }
  return schema;
}

async function applyTenantSchema(req, res, next) {
  let client;

  try {
    if (!req.user?.schema) {
      return res.status(401).json({
        success: false,
        message: "Schema do usuário não encontrado.",
      });
    }

    const schema = assertValidSchemaName(req.user.schema);
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
      try {
        client.release();
      } catch (_) {}
    }

    return res.status(500).json({
      success: false,
      message: "Erro ao aplicar schema do tenant.",
      error: error.message,
    });
  }
}

module.exports = {
  applyTenantSchema,
};
