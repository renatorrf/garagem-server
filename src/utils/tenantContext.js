"use strict";

function sanitizeDigits(value = "") {
  return String(value).replace(/\D/g, "");
}

function assertValidSchemaName(schema) {
  const normalized = String(schema || "").trim();
  if (!normalized || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
    throw new Error("Schema inválido.");
  }
  return normalized;
}

function resolveSchemaValue(value, { allowDefault = true } = {}) {
  if (value) {
    return assertValidSchemaName(value);
  }

  if (allowDefault) {
    const fallback = process.env.SCHEMA_PADRAO || null;
    return fallback ? assertValidSchemaName(fallback) : null;
  }

  return null;
}

function getSchemaFromReq(req, options = {}) {
  return resolveSchemaValue(
    req?.tenantSchema ||
      req?.user?.schema ||
      req?.headers?.["x-tenant-schema"] ||
      req?.headers?.schema ||
      req?.query?.schema ||
      req?.body?.schema ||
      null,
    options,
  );
}

function getTenantIdFromReq(req) {
  const value =
    req?.user?.tenantId ||
    req?.headers?.["x-tenant-id"] ||
    req?.query?.tenantId ||
    req?.body?.tenantId ||
    null;

  if (value == null || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setTenantOnReq(req, { schema, tenantId } = {}) {
  if (!req) return req;

  if (schema) {
    const normalized = assertValidSchemaName(schema);
    req.tenantSchema = normalized;
    req.headers = req.headers || {};
    req.headers.schema = normalized;
    req.headers["x-tenant-schema"] = normalized;
  }

  if (tenantId != null) {
    req.user = req.user || {};
    req.user.tenantId = tenantId;
    req.headers = req.headers || {};
    req.headers["x-tenant-id"] = String(tenantId);
  }

  return req;
}

function qualifyTable(schema, tableName) {
  const normalizedSchema = resolveSchemaValue(schema);
  const table = String(tableName || "").trim();
  if (!table || table.includes(".")) return table;
  return `${normalizedSchema}.${table}`;
}

module.exports = {
  sanitizeDigits,
  assertValidSchemaName,
  resolveSchemaValue,
  getSchemaFromReq,
  getTenantIdFromReq,
  setTenantOnReq,
  qualifyTable,
};
