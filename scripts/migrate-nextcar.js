#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");
require("dotenv").config();

types.setTypeParser(20, (value) => value);
types.setTypeParser(700, (value) => value);
types.setTypeParser(701, (value) => value);
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);
types.setTypeParser(1186, (value) => value);
types.setTypeParser(1700, (value) => value);

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const sourceUrl = process.env.DATABASE_URL_ANTIGA || process.env.DATABASE_URL;
const targetUrl = process.env.DATABASE_URL_NOVA;

if (!sourceUrl) {
  console.error("DATABASE_URL_ANTIGA (ou DATABASE_URL) nao encontrada no ambiente.");
  process.exit(1);
}

if (!targetUrl) {
  console.error("DATABASE_URL_NOVA nao encontrada no ambiente.");
  process.exit(1);
}

const sourceSchema = sanitizeIdentifier(
  readArg(args, ["source-schema", "sourceSchema", "source"]) || "teste",
  "source schema",
);
const targetSchema = sanitizeIdentifier(
  readArg(args, ["target-schema", "targetSchema", "target"]) || "nextcar",
  "target schema",
);
const schemaFile = path.resolve(
  process.cwd(),
  readArg(args, ["schema-file", "schemaFile"]) || path.join(__dirname, "db", "nextcar-schema.sql"),
);
const batchSize = Math.max(
  parseInt(readArg(args, ["batch-size", "batchSize", "batch"]) || "200", 10) || 200,
  1,
);
const includeTables = splitCsv(readArg(args, ["tables"]));
const excludeTables = new Set(splitCsv(readArg(args, ["exclude"])));
const resetTarget = isTruthy(readArg(args, ["reset-target", "resetTarget"]));
const skipSchema = isTruthy(readArg(args, ["skip-schema", "skipSchema"]));

if (!fs.existsSync(schemaFile)) {
  console.error(`Arquivo de schema nao encontrado: ${schemaFile}`);
  process.exit(1);
}

const sourcePool = makePool(sourceUrl);
const targetPool = makePool(targetUrl);

(async () => {
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    const targetEncoding = await getServerEncoding(targetClient);

    if (!skipSchema) {
      await applySchema(targetClient, schemaFile, targetSchema, resetTarget);
    }

    const tables = await listTables(sourceClient, sourceSchema);
    const selectedTables = tables.filter((table) => {
      if (includeTables.length > 0 && !includeTables.includes(table)) {
        return false;
      }
      if (excludeTables.has(table)) {
        return false;
      }
      return true;
    });

    const orderedTables = await orderTables(sourceClient, sourceSchema, selectedTables);

    console.log(`Schema origem: ${sourceSchema}`);
    console.log(`Schema destino: ${targetSchema}`);
    console.log(`Encoding destino: ${targetEncoding}`);
    console.log(`Tabelas selecionadas: ${orderedTables.length}`);

    let totalRows = 0;

    for (const table of orderedTables) {
      const copied = await copyTable({
        sourceClient,
        targetClient,
        sourceSchema,
        targetSchema,
        table,
        batchSize,
        targetEncoding,
      });

      totalRows += copied;
      console.log(`OK ${table}: ${copied} linha(s)`);
    }

    console.log(`Migracao concluida. Total de linhas copiadas: ${totalRows}`);
  } catch (error) {
    console.error("Falha na migracao:", error.message);
    process.exitCode = 1;
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
})();

function makePool(connectionString) {
  const ssl = resolveSslConfig(connectionString);
  return new Pool({
    connectionString,
    max: parseInt(process.env.DB_POOL_MAX || "3", 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
    connectionTimeoutMillis: parseInt(
      process.env.DB_CONNECTION_TIMEOUT_MS || "15000",
      10,
    ),
    ssl,
  });
}

function resolveSslConfig(connectionString) {
  try {
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
    // Mantem o comportamento padrao do pg se a URL nao puder ser analisada.
  }

  return false;
}

async function applySchema(client, schemaFilePath, targetSchemaName, reset) {
  const existingTables = await listTables(client, targetSchemaName);

  if (existingTables.length > 0 && !reset) {
    throw new Error(
      `O schema destino \"${targetSchemaName}\" ja tem tabelas. Use --reset-target para recriar a base ou rode em um banco vazio.`,
    );
  }

  const schemaSql = fs.readFileSync(schemaFilePath, "utf8");

  await client.query("BEGIN");
  try {
    if (reset) {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(targetSchemaName)} CASCADE;`);
    }

    await client.query(schemaSql.replace(/^\uFEFF/, ""));
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  }
}

async function copyTable({
  sourceClient,
  targetClient,
  sourceSchema,
  targetSchema,
  table,
  batchSize,
  targetEncoding,
}) {
  const sourceColumns = await listColumns(sourceClient, sourceSchema, table);
  const targetColumns = await listColumns(targetClient, targetSchema, table);
  const targetColumnSet = new Set(targetColumns.map((column) => column.column_name));
  const missingColumns = sourceColumns
    .map((column) => column.column_name)
    .filter((column) => !targetColumnSet.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `Tabela ${sourceSchema}.${table} nao existe com as mesmas colunas no destino. Faltando: ${missingColumns.join(", ")}`,
    );
  }

  const primaryKeys = await listPrimaryKeys(sourceClient, sourceSchema, table);
  const orderBy =
    primaryKeys.length > 0
      ? ` ORDER BY ${primaryKeys.map((column) => quoteIdent(column)).join(", ")}`
      : "";
  const selectColumnsSql = sourceColumns.map((column) => quoteIdent(column.column_name)).join(", ");
  const selectSql = `SELECT ${selectColumnsSql} FROM ${qualifiedName(sourceSchema, table)}${orderBy}`;
  const cursorName = quoteIdent(buildCursorName(table));

  await sourceClient.query("BEGIN");
  await targetClient.query("BEGIN");

  let copied = 0;

  try {
    await sourceClient.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${selectSql}`);

    while (true) {
      const fetchResult = await sourceClient.query(
        `FETCH FORWARD ${batchSize} FROM ${cursorName}`,
      );
      const rows = fetchResult.rows;

      if (rows.length === 0) {
        break;
      }

      await insertBatch({
        client: targetClient,
        schema: targetSchema,
        table,
        columns: sourceColumns,
        rows,
        targetEncoding,
      });

      copied += rows.length;
    }

    await sourceClient.query(`CLOSE ${cursorName}`);
    await resetSequences(targetClient, targetSchema, table, targetColumns);
    await targetClient.query("COMMIT");
    await sourceClient.query("COMMIT");
    return copied;
  } catch (error) {
    try {
      await sourceClient.query("ROLLBACK");
    } catch (_) {}
    try {
      await targetClient.query("ROLLBACK");
    } catch (_) {}
    throw error;
  }
}

async function insertBatch({ client, schema, table, columns, rows, targetEncoding }) {
  const columnListSql = columns.map((column) => quoteIdent(column.column_name)).join(", ");
  const params = [];
  const tuples = [];
  let index = 1;

  for (const row of rows) {
    const placeholders = [];

    for (const column of columns) {
      const value = sanitizeForEncoding(row[column.column_name], targetEncoding);
      params.push(value === undefined ? null : value);
      placeholders.push(`$${index}`);
      index += 1;
    }

    tuples.push(`(${placeholders.join(", ")})`);
  }

  const sql = `INSERT INTO ${qualifiedName(schema, table)} (${columnListSql}) VALUES ${tuples.join(", ")}`;
  await client.query(sql, params);
}

async function resetSequences(client, schema, table, columns) {
  const tableName = qualifiedName(schema, table);
  const statements = [];

  for (const column of columns) {
    if (!column.serial_sequence) {
      continue;
    }

    statements.push(
      `SELECT setval(${escapeLiteral(column.serial_sequence)}, COALESCE((SELECT MAX(${quoteIdent(column.column_name)}) FROM ${tableName}), 1), (SELECT COUNT(*) > 0 FROM ${tableName}));`,
    );
  }

  for (const statement of statements) {
    await client.query(statement);
  }
}

async function listTables(client, schema) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `,
    [schema],
  );

  return result.rows.map((row) => row.table_name);
}

async function listColumns(client, schema, table) {
  const result = await client.query(
    `
      SELECT
        column_name,
        data_type,
        udt_name,
        ordinal_position,
        column_default,
        pg_get_serial_sequence($1 || '.' || $2, column_name) AS serial_sequence
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position ASC
    `,
    [schema, table],
  );

  return result.rows;
}

async function listPrimaryKeys(client, schema, table) {
  const result = await client.query(
    `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = $1
        AND c.relname = $2
        AND i.indisprimary
      ORDER BY a.attnum ASC
    `,
    [schema, table],
  );

  return result.rows.map((row) => row.column_name);
}

async function orderTables(client, schema, tables) {
  if (tables.length <= 1) {
    return tables;
  }

  const result = await client.query(
    `
      SELECT DISTINCT
        tc.table_name AS table_name,
        ccu.table_name AS referenced_table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
    `,
    [schema],
  );

  const tableSet = new Set(tables);
  const graph = new Map();
  const incoming = new Map();

  for (const table of tables) {
    graph.set(table, new Set());
    incoming.set(table, 0);
  }

  for (const row of result.rows) {
    const from = row.table_name;
    const to = row.referenced_table_name;

    if (!tableSet.has(from) || !tableSet.has(to) || from === to) {
      continue;
    }

    if (!graph.get(to).has(from)) {
      graph.get(to).add(from);
      incoming.set(from, incoming.get(from) + 1);
    }
  }

  const queue = tables.filter((table) => incoming.get(table) === 0).sort();
  const ordered = [];

  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);

    for (const next of graph.get(current) || []) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  const remaining = tables.filter((table) => !ordered.includes(table)).sort();
  if (remaining.length > 0) {
    console.warn(
      `Aviso: dependencias ciclicas ou nao resolvidas em ${remaining.join(", ")}.`,
    );
    return [...ordered, ...remaining];
  }

  return ordered;
}

function parseArgs(argv) {
  const result = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }

    if (!token.startsWith("--")) {
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      result[key] = value;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }

  return result;
}

function readArg(argsObject, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(argsObject, name)) {
      return argsObject[name];
    }
  }

  return undefined;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/migrate-nextcar.js

Options:
  --source-schema      Schema de origem. Default: teste
  --target-schema      Schema de destino. Default: nextcar
  --schema-file        Arquivo SQL do schema de destino
  --tables             Lista CSV de tabelas a migrar
  --exclude            Lista CSV de tabelas a ignorar
  --batch-size         Quantidade de linhas por lote. Default: 200
  --reset-target 1|0   Droppa e recria o schema de destino. Default: 0
  --skip-schema 1|0    Nao aplica o arquivo de schema no destino. Default: 0
`);
}

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTruthy(value) {
  if (value === true) {
    return true;
  }

  if (value === 1 || value === "1") {
    return true;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "yes", "y", "on"].includes(normalized);
  }

  return false;
}

function sanitizeIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) {
    throw new Error(`${label} invalido: ${text}`);
  }

  return text;
}

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function qualifiedName(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function escapeLiteral(value) {
  return `E'${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}'`;
}

function buildCursorName(table) {
  return `mig_${String(table).replace(/[^a-zA-Z0-9_]/g, "_")}`.toLowerCase();
}

async function getServerEncoding(client) {
  const result = await client.query("SHOW server_encoding");
  return String(result.rows[0].server_encoding || "UTF8").toUpperCase();
}

function sanitizeForEncoding(value, encoding) {
  if (!encoding || String(encoding).toUpperCase() === "UTF8") {
    return value;
  }

  if (value == null) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForEncoding(item, encoding));
  }

  if (typeof value === "string") {
    return replaceUnsupportedCharacters(value);
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      const safeKey =
        typeof key === "string" ? replaceUnsupportedCharacters(key) : key;
      out[safeKey] = sanitizeForEncoding(nested, encoding);
    }
    return out;
  }

  return value;
}

function replaceUnsupportedCharacters(text) {
  let output = "";

  for (const char of String(text)) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint === 9 ||
      codePoint === 10 ||
      codePoint === 13 ||
      codePoint <= 255
    ) {
      output += char;
    } else {
      output += "?";
    }
  }

  return output;
}
