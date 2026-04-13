// db.js
const { Pool } = require("pg");
const { assertValidSchemaName } = require("../utils/tenantContext");
require("dotenv").config();

const databaseUrl = process.env.DATABASE_URL;

function resolveSslConfig(connectionString) {
  try {
    const envValue = String(process.env.DB_SSL || "")
      .trim()
      .toLowerCase();

    if (["false", "0", "no", "off", "disable", "disabled"].includes(envValue)) {
      return false;
    }

    if (["true", "1", "yes", "on", "require", "required"].includes(envValue)) {
      return { rejectUnauthorized: false };
    }

    if (!connectionString) {
      return false;
    }

    const normalizedConnectionString = connectionString.replace(
      /^base:\/\//i,
      "postgres://",
    );
    const url = new URL(normalizedConnectionString);

    const host = String(url.hostname || "")
      .trim()
      .toLowerCase();
    const sslmode = String(url.searchParams.get("sslmode") || "")
      .trim()
      .toLowerCase();
    const ssl = String(url.searchParams.get("ssl") || "")
      .trim()
      .toLowerCase();

    if (ssl === "false" || ["disable", "disabled", "allow"].includes(sslmode)) {
      return false;
    }

    if (
      ssl === "true" ||
      ["require", "verify-ca", "verify-full", "prefer"].includes(sslmode)
    ) {
      return { rejectUnauthorized: false };
    }

    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(host) || host.endsWith(".local")) {
      return false;
    }

    // Seu host próprio: por padrão, não usar SSL
    if (host === "cloud.digitalrf.com.br") {
      return false;
    }

    // Hosts gerenciados que normalmente exigem SSL
    if (
      host.includes("neon.tech") ||
      host.includes("supabase.co") ||
      host.includes("render.com") ||
      host.includes("railway.app")
    ) {
      return { rejectUnauthorized: false };
    }
  } catch (error) {
    console.warn(
      "resolveSslConfig: falha ao analisar connectionString:",
      error.message,
    );
  }

  return false;
}

// Legacy LATIN1 database: normalize unsupported Unicode punctuation before sending values.
function toLatin1SafeText(value) {
  const normalized = String(value).normalize("NFC");

  const mapped = normalized
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");

  let output = "";

  for (const char of mapped) {
    const codePoint = char.codePointAt(0);

    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0x7e) ||
      (codePoint >= 0xa0 && codePoint <= 0xff)
    ) {
      output += char;
    }
  }

  return output;
}

function sanitizeQueryValue(value) {
  if (value == null) return value;

  if (typeof value === "string") {
    return toLatin1SafeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeQueryValue(item));
  }

  if (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    typeof value !== "object"
  ) {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sanitizeQueryValue(item);
  }

  return output;
}

function sanitizeQueryParams(params) {
  if (!Array.isArray(params)) return params;

  return params.map((value) => sanitizeQueryValue(value));
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT_MS || "15000",
    10,
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
  params = sanitizeQueryParams(params);

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("db.query: SQL (text) inválido.");
  }

  const needed = maxPlaceholderIndex(text);
  if (needed > params.length) {
    const err = new Error(
      `db.query: SQL exige $1..$${needed}, mas params.length=${params.length}. Dica: passou params undefined?`,
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

async function connect(schema = null) {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);

  client.query = (...args) => {
    if (args.length === 0) {
      return originalQuery();
    }

    if (typeof args[0] === "string") {
      if (args.length === 1) return originalQuery(args[0]);
      if (args.length === 2)
        return originalQuery(args[0], sanitizeQueryValue(args[1]));
      return originalQuery(args[0], sanitizeQueryValue(args[1]), args[2]);
    }

    if (args[0] && typeof args[0] === "object") {
      const config = { ...args[0] };
      if (config.values != null) {
        config.values = sanitizeQueryParams(
          Array.isArray(config.values) ? config.values : [config.values],
        );
      }
      if (args.length === 1) return originalQuery(config);
      return originalQuery(config, args[1]);
    }

    return originalQuery(...args);
  };

  const originalRelease = client.release.bind(client);
  client.release = (...args) => {
    client.query = originalQuery;
    return originalRelease(...args);
  };

  if (schema) {
    await client.query(
      `SET search_path TO ${assertValidSchemaName(schema)}, public`,
    );
  }

  return client;
}

const db = {
  query,
  connect,

  async transaction(callback) {
    const client = await connect();
    const originalQuery = client.query.bind(client);

    client.query = (...args) => {
      if (args.length === 0) {
        return originalQuery();
      }

      if (typeof args[0] === "string") {
        if (args.length === 1) {
          return originalQuery(args[0]);
        }

        if (args.length === 2) {
          return originalQuery(args[0], sanitizeQueryValue(args[1]));
        }

        return originalQuery(args[0], sanitizeQueryValue(args[1]), args[2]);
      }

      if (args[0] && typeof args[0] === "object") {
        const config = { ...args[0] };

        if (config.values != null) {
          config.values = sanitizeQueryParams(
            Array.isArray(config.values) ? config.values : [config.values],
          );
        }

        if (args.length === 1) {
          return originalQuery(config);
        }

        return originalQuery(config, args[1]);
      }

      return originalQuery(...args);
    };

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
      client.query = originalQuery;
      client.release();
    }
  },

  async withSchema(schema, callback) {
    const client = await connect(schema);
    try {
      return await callback(client);
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
