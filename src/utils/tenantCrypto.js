
"use strict";

const crypto = require("crypto");

function getEncryptionKey() {
  const raw = String(process.env.APP_ENCRYPTION_KEY || "").trim();

  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY não configurada.");
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw, "utf8").digest();

  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY inválida. São necessários 32 bytes.");
  }

  return key;
}

function encryptText(value) {
  if (value == null || value === "") return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);

  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    content: encrypted.toString("hex"),
  });
}

function decryptText(payload) {
  if (!payload) return null;

  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(parsed.iv, "hex"),
  );

  decipher.setAuthTag(Buffer.from(parsed.tag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.content, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encryptText,
  decryptText,
};
