const crypto = require("crypto");

const ENCRYPTION_KEY = Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex"); // 32 bytes em hex

function encryptText(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
    content: encrypted.toString("hex"),
  });
}

function decryptText(payload) {
  if (!payload) return null;

  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
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
