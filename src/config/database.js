// db.js
const { Pool } = require("pg");

const databaseUrl =
  process.env.DATABASE_URL_NOVA ||
  process.env.DATABASE_URL_ANTIGA ||
  process.env.DATABASE_URL;

function resolveSslConfig(connectionString) {
  try {
    if (!connectionString) return false;

    const url = new URL(connectionString);
    const urlMode = String(url.searchParams.get("sslmode") || "").trim().toLowerCase();
    const explicitSsl = String(url.searchParams.get("ssl") || "").trim().toLowerCase();

    if (explicitSsl === "false" || urlMode === "disable") {
      return false;
    }

    if (
      explicitSsl === "true" ||
      ["require", "verify-ca", "verify-full", "prefer"].includes(urlMode)
    ) {
      return { rejectUnauthorized: false };
    }

    const host = url.hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(host) || host.endsWith(".local")) {
      return false;
    }

    if (host.includes("neon.tech")) {
      return { rejectUnauthorized: false };
    }

    if (host.includes("supabase.co") || host.includes("render.com")) {
      return { rejectUnauthorized: false };
    }
  } catch (_) {
    // Mantém o comportamento padrão do pg quando a URL não puder ser analisada.
  }

  return false;
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT_MS || "15000",
    10
  ),
  ssl: resolveSslConfig(databaseUrl),
});

/**
 * Extrai o maior placeholder $N presente no SQL.
 * Ex.: "WHERE a=$1 AND b=$3" => 3
 */
function maxPlaceholderIndex(sql) {
  const re = /\$([1-9]\d*)/g;
  let m;
  let max = 0;

  while ((m = re.exec(sql)) !== null) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }

  return max;
}

/**
 * Normaliza (params, options)
 * - Se params for objeto e options não vier, assume que params é options.
 * - Se params vier undefined/null, vira [].
 * - Se params não for array, encapsula em array.
 */
function normalizeArgs(params, options) {
  if (
    params &&
    !Array.isArray(params) &&
    typeof params === "object" &&
    options == null
  ) {
    options = params;
    params = [];
  }

  if (params == null) params = [];
  if (!Array.isArray(params)) params = [params];
  if (options == null) options = {};

  return { params, options };
}

function previewSql(sql, maxLen = 600) {
  const s = String(sql).replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

/**
 * query(text, params?, options?)
 * options:
 *  - client: PoolClient
 *  - log: boolean
 *  - logErrors: boolean
 *  - name: string
 *  - rowMode: 'array'
 */
async function query(text, params, options) {
  const norm = normalizeArgs(params, options);
  params = norm.params;
  options = norm.options;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("db.query: SQL (text) inválido.");
  }

  const needed = maxPlaceholderIndex(text);
  if (needed > params.length) {
    const err = new Error(
      `db.query: SQL exige $1..$${needed}, mas params.length=${params.length}. Dica: passou params undefined?`
    );
    err.query = text;
    err.params = params;
    throw err;
  }

  const client = options.client || pool;

  if (options.log) {
    console.log("[DB] SQL:", previewSql(text));
    console.log("[DB] params:", params);
  }

  try {
    if (options.name || options.rowMode) {
      return await client.query({
        text,
        values: params,
        name: options.name,
        rowMode: options.rowMode,
      });
    }

    return await client.query(text, params);
  } catch (e) {
    e.query = text;
    e.params = params;
    e.sqlPreview = previewSql(text);

    if (options.logErrors) {
      console.error("[DB] ERRO:", e.message);
      console.error("[DB] SQL:", e.sqlPreview);
      console.error("[DB] params:", params);
    }

    throw e;
  }
}

const db = {
  query,

  async transaction(callback) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  },

  async getOne(text, params, options) {
    const result = await query(text, params, options);
    return result.rows[0] || null;
  },

  async getMany(text, params, options) {
    const result = await query(text, params, options);
    return result.rows;
  },

  async execute(text, params, options) {
    const result = await query(text, params, options);
    return result.rowCount;
  },

  async healthCheck() {
    try {
      const res = await pool.query("SELECT NOW()");
      return {
        status: "healthy",
        timestamp: res.rows[0].now,
      };
    } catch (err) {
      return {
        status: "unhealthy",
        error: err.message,
      };
    }
  },

  async close() {
    await pool.end();
    console.log("Pool has been closed");
  },

  pool,
};

module.exports = db;
module.exports.db = db;
module.exports.pool = pool;
module.exports.queryRaw = query;
