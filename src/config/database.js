// db.js
// Ajuste o import do pool conforme seu projeto.
// Exemplo:
// const { Pool } = require('pg');
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { Pool } = require("pg");

// ⚠️ ajuste o config do pool ao seu projeto
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Número máximo de clientes no pool
  min: 2, // Número mínimo de clientes no pool
  idleTimeoutMillis: 30000, // Tempo que um cliente pode ficar ocioso
  connectionTimeoutMillis: 20000, // Tempo máximo para tentar conectar
  allowExitOnIdle: true, // Permite que o processo saia quando o pool estiver ocioso
  ssl: true,
  sslmode: "require",
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
 * - Se params não for array, tenta wrap em array (último recurso).
 */
function normalizeArgs(params, options) {
  // caso: query(sql, { log: true })
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
 *  - client: PoolClient (para usar dentro de transaction)
 *  - log: boolean (logar query+params)
 *  - name: string (prepared statement name)
 *  - rowMode: 'array' | undefined
 */
async function query(text, params, options) {
  const norm = normalizeArgs(params, options);
  params = norm.params;
  options = norm.options;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("db.query: SQL (text) inválido.");
  }

  

  // valida placeholders x params
  const needed = maxPlaceholderIndex(text);
  if (needed > params.length) {
    const err = new Error(
      `db.query: SQL exige $1..$${needed}, mas params.length=${params.length}. ` +
        `Dica: passou params undefined?`,
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
    // suporta prepared statements se você quiser
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
    // anexa contexto útil
    e.query = text;
    e.params = params;
    e.sqlPreview = previewSql(text);

    // log simples opcional
    if (options.logErrors) {
      console.error("[DB] ERRO:", e.message);
      console.error("[DB] SQL:", e.sqlPreview);
      console.error("[DB] params:", params);
    }

    throw e;
  }
}

async function query(text, params = []) {
  return pool.query(text, params);
}

const db = {
  query,

  /**
   * Executa uma query em transação
   * Uso:
   * await db.transaction(async (client) => {
   *   await db.query('...', [..], { client });
   * })
   */
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
};

db.healthCheck = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    return {
      status: 'healthy',
      timestamp: res.rows[0].now
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message
    };
  }
};

db.close = async () => {
  await pool.end();
  console.log('Pool has been closed');
};
db.pool = pool;

module.exports = db;        // default: require('./db') -> db com getOne/getMany/etc
module.exports.db = db;     // named:   const { db } = require('./db')
module.exports.pool = pool; // opcional
module.exports.queryRaw = query; // opcional (pra acessar a função "query" pura)
