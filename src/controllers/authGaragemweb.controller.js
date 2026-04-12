const db = require("../config/database");
if (process.env.NODE_ENV !== "production") {
  require("dotenv-safe").config({ example: ".env.example" });
}
const moment = require("moment");
const cron = require("node-cron");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const {
  sanitizeDigits,
  assertValidSchemaName,
} = require("../utils/tenantContext");

const JWT_SECRET =
  process.env.JWT_SECRET || process.env.SECRET || "trocar-em-producao";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Next Car";
const RP_ID =
  process.env.WEBAUTHN_RP_ID ||
  "nextcarltda.web.app" ||
  "http://localhost:8100";
const ORIGIN =
  process.env.WEBAUTHN_ORIGIN ||
  "https://nextcarltda.web.app" ||
  "http://localhost:8100";

const challengeStore = new Map();

function createSchemaFromCnpjOrName(nomeFantasia, cnpj) {
  const cnpjDigits = sanitizeDigits(cnpj);
  if (cnpjDigits) return `emp_${cnpjDigits}`;

  return String(nomeFantasia || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 50);
}

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      tenantId: user.tenant_id,
      schema: user.schema_name,
      role: user.role,
      masterUser: user.master_user,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

async function getUserByUsername(username) {
  const sql = `
    select
      u.id,
      u.tenant_id,
      u.nome,
      u.username,
      u.email,
      u.password_hash,
      u.role,
      u.master_user,
      u.ativo,
      t.nome_fantasia,
      t.cnpj,
      t.schema_name,
      t.ativo as tenant_ativo
    from public.users u
    inner join public.tenants t on t.id = u.tenant_id
    where lower(u.username) = lower($1)
    limit 1
  `;
  const { rows } = await db.query(sql, [username]);
  return rows[0] || null;
}

async function getUserById(userId) {
  const sql = `
    select
      u.id,
      u.tenant_id,
      u.nome,
      u.username,
      u.email,
      u.role,
      u.master_user,
      u.ativo,
      t.nome_fantasia,
      t.cnpj,
      t.schema_name,
      t.ativo as tenant_ativo
    from public.users u
    inner join public.tenants t on t.id = u.tenant_id
    where u.id = $1
    limit 1
  `;
  const { rows } = await db.query(sql, [userId]);
  return rows[0] || null;
}

async function saveSession({
  userId,
  tenantId,
  ipAddress,
  userAgent,
  expiresAt,
}) {
  const jwtId = crypto.randomUUID();

  await db.query(
    `
      insert into public.login_sessions (
        user_id,
        tenant_id,
        jwt_id,
        ip_address,
        user_agent,
        ativo,
        expires_at,
        created_at,
        last_seen_at
      )
      values ($1, $2, $3, $4, $5, true, $6, now(), now())
    `,
    [userId, tenantId, jwtId, ipAddress || null, userAgent || null, expiresAt],
  );

  return jwtId;
}

async function getPasskeysByUserId(userId) {
  const { rows } = await db.query(
    `
      select
        id,
        user_id,
        tenant_id,
        credential_id,
        public_key,
        counter,
        device_type,
        backed_up,
        transports
      from public.user_passkeys
      where user_id = $1
      order by id asc
    `,
    [userId],
  );
  return rows.map((row) => ({
    ...row,
    transports: Array.isArray(row.transports)
      ? row.transports
      : typeof row.transports === "string"
        ? JSON.parse(row.transports)
        : row.transports,
  }));
}

async function getPasskeyByCredentialId(credentialId) {
  const { rows } = await db.query(
    `
      select
        pk.id,
        pk.user_id,
        pk.tenant_id,
        pk.credential_id,
        pk.public_key,
        pk.counter,
        pk.device_type,
        pk.backed_up,
        pk.transports,
        u.username,
        u.ativo,
        t.schema_name,
        t.ativo as tenant_ativo
      from public.user_passkeys pk
      inner join public.users u on u.id = pk.user_id
      inner join public.tenants t on t.id = pk.tenant_id
      where pk.credential_id = $1
      limit 1
    `,
    [credentialId],
  );
  const row = rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    transports: Array.isArray(row.transports)
      ? row.transports
      : typeof row.transports === "string"
        ? JSON.parse(row.transports)
        : row.transports,
  };
}

exports.verifyTokenSim = async (req, res, next) => {
  const token = req.headers.authorization;
  const tokenValido = process.env.AUTHTOKEN;

  if (token === tokenValido) {
    next();
  } else {
    return res
      .status(401)
      .json({ auth: false, message: "Auth-Token inválido." });
  }
};

exports.bootstrapMaster = async (req, res) => {
  const client = await db.connect();

  try {
    const {
      nome,
      username,
      email,
      password,
      nomeFantasia,
      razaoSocial,
      cnpj,
      schemaName,
    } = req.body || {};

    if (!nome || !username || !password || !nomeFantasia || !cnpj) {
      return res.status(400).json({
        success: false,
        message: "Informe nome, username, password, nomeFantasia e cnpj.",
      });
    }

    const finalSchema = assertValidSchemaName(
      schemaName || createSchemaFromCnpjOrName(nomeFantasia, cnpj),
    );

    await client.query("begin");

    const tenantExists = await client.query(
      `select id from public.tenants where cnpj = $1 or schema_name = $2 limit 1`,
      [sanitizeDigits(cnpj), finalSchema],
    );

    if (tenantExists.rows.length) {
      await client.query("rollback");
      return res.status(409).json({
        success: false,
        message: "Já existe empresa cadastrada com este CNPJ ou schema.",
      });
    }

    const userExists = await client.query(
      `select id from public.users where lower(username) = lower($1) limit 1`,
      [username],
    );

    if (userExists.rows.length) {
      await client.query("rollback");
      return res.status(409).json({
        success: false,
        message: "Username já cadastrado.",
      });
    }

    const tenantResult = await client.query(
      `
        insert into public.tenants (
          nome_fantasia,
          razao_social,
          cnpj,
          schema_name,
          ativo,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, true, now(), now())
        returning *
      `,
      [nomeFantasia, razaoSocial || null, sanitizeDigits(cnpj), finalSchema],
    );

    const tenant = tenantResult.rows[0];

    await client.query(`create schema if not exists ${finalSchema}`);

    const passwordHash = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      `
        insert into public.users (
          tenant_id,
          nome,
          username,
          email,
          password_hash,
          role,
          master_user,
          ativo,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, 'master', true, true, now(), now())
        returning id, tenant_id, nome, username, email, role, master_user, ativo
      `,
      [tenant.id, nome, username, email || null, passwordHash],
    );

    await client.query("commit");

    return res.json({
      success: true,
      message: "Usuário master criado com sucesso.",
      tenant: {
        id: tenant.id,
        nomeFantasia: tenant.nome_fantasia,
        cnpj: tenant.cnpj,
        schema: tenant.schema_name,
      },
      user: userResult.rows[0],
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (_) {}
    console.error("bootstrapMaster error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao criar usuário master.",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Usuário e senha são obrigatórios.",
      });
    }

    const user = await getUserByUsername(username);
    console.log("login attempt:", { username, userId: user?.id });

    if (!user || !user.ativo || !user.tenant_ativo) {
      return res.status(401).json({
        success: false,
        message: "Usuário inválido ou inativo.",
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: "Usuário ou senha inválidos.",
      });
    }

    const expiresAt = moment().add(12, "hours").toDate();
    await saveSession({
      userId: user.id,
      tenantId: user.tenant_id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt,
    });

    const token = signAuthToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nome: user.nome,
        username: user.username,
        email: user.email,
        role: user.role,
        masterUser: user.master_user,
        tenantId: user.tenant_id,
        tenantName: user.nome_fantasia,
        schema: user.schema_name,
        cnpj: user.cnpj,
      },
    });
  } catch (error) {
    console.error("login error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao autenticar usuário.",
    });
  }
};

exports.verifyJwt = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token não informado.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.sub);

    if (!user || !user.ativo || !user.tenant_ativo) {
      return res.status(401).json({
        success: false,
        message: "Usuário inválido ou inativo.",
      });
    }

    req.user = {
      id: user.id,
      tenantId: user.tenant_id,
      username: user.username,
      role: user.role,
      masterUser: user.master_user,
      schema: user.schema_name,
      cnpj: user.cnpj,
    };

    req.headers = req.headers || {};
    req.headers.schema = user.schema_name;
    req.headers["x-tenant-schema"] = user.schema_name;
    req.headers["x-tenant-id"] = String(user.tenant_id);

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado.",
    });
  }
};

exports.me = async (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
};

exports.passkeyRegisterOptions = async (req, res) => {
  try {
    const { username } = req.body || {};
    const user = await getUserByUsername(username);

    if (!user || !user.ativo || !user.tenant_ativo) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
    }

    const passkeys = await getPasskeysByUserId(user.id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.username,
      userID: String(user.id),
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: passkeys.map((pk) => ({
        id: pk.credential_id,
        type: "public-key",
        transports: pk.transports || ["internal"],
      })),
    });

    challengeStore.set(`reg:${user.username}`, options.challenge);

    return res.json({
      success: true,
      publicKey: options,
    });
  } catch (error) {
    console.error("passkeyRegisterOptions error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar opções de registro da passkey.",
    });
  }
};

exports.passkeyRegisterVerify = async (req, res) => {
  try {
    const { username, credential } = req.body || {};
    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
    }

    const expectedChallenge = challengeStore.get(`reg:${user.username}`);

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    const { verified, registrationInfo } = verification;

    if (!verified || !registrationInfo) {
      return res.status(400).json({
        success: false,
        message: "Falha ao registrar passkey.",
      });
    }

    await db.query(
      `
        insert into public.user_passkeys (
          user_id,
          tenant_id,
          credential_id,
          public_key,
          counter,
          device_type,
          backed_up,
          transports,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      `,
      [
        user.id,
        user.tenant_id,
        registrationInfo.credential.id,
        registrationInfo.credential.publicKey,
        registrationInfo.credential.counter,
        registrationInfo.credentialDeviceType || null,
        registrationInfo.credentialBackedUp || false,
        JSON.stringify(credential?.response?.transports || ["internal"]),
      ],
    );

    challengeStore.delete(`reg:${user.username}`);

    return res.json({
      success: true,
      message: "Passkey registrada com sucesso.",
    });
  } catch (error) {
    console.error("passkeyRegisterVerify error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao validar registro da passkey.",
    });
  }
};

exports.passkeyAuthenticateOptions = async (req, res) => {
  try {
    const { username } = req.body || {};
    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
    }

    const passkeys = await getPasskeysByUserId(user.id);

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
      allowCredentials: passkeys.map((pk) => ({
        id: pk.credential_id,
        type: "public-key",
        transports: pk.transports || ["internal"],
      })),
    });

    challengeStore.set(`auth:${user.username}`, options.challenge);

    return res.json({
      success: true,
      publicKey: options,
    });
  } catch (error) {
    console.error("passkeyAuthenticateOptions error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao gerar opções de autenticação.",
    });
  }
};

exports.passkeyAuthenticateVerify = async (req, res) => {
  try {
    const { username, credential } = req.body || {};
    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado.",
      });
    }

    const dbPasskey = await getPasskeyByCredentialId(credential.id);

    if (!dbPasskey || dbPasskey.user_id !== user.id) {
      return res.status(404).json({
        success: false,
        message: "Credencial não encontrada.",
      });
    }

    const expectedChallenge = challengeStore.get(`auth:${user.username}`);

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: dbPasskey.credential_id,
        publicKey: dbPasskey.public_key,
        counter: Number(dbPasskey.counter || 0),
        transports: dbPasskey.transports || ["internal"],
      },
      requireUserVerification: false,
    });

    const { verified, authenticationInfo } = verification;

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Falha na autenticação por passkey.",
      });
    }

    await db.query(
      `update public.user_passkeys set counter = $2 where credential_id = $1`,
      [dbPasskey.credential_id, authenticationInfo.newCounter],
    );

    challengeStore.delete(`auth:${user.username}`);

    const expiresAt = moment().add(12, "hours").toDate();
    await saveSession({
      userId: user.id,
      tenantId: user.tenant_id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt,
    });

    const token = signAuthToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nome: user.nome,
        username: user.username,
        role: user.role,
        masterUser: user.master_user,
        tenantId: user.tenant_id,
        tenantName: user.nome_fantasia,
        schema: user.schema_name,
        cnpj: user.cnpj,
      },
    });
  } catch (error) {
    console.error("passkeyAuthenticateVerify error", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao validar autenticação facial.",
    });
  }
};

cron.schedule("0 * * * *", async () => {
  try {
    await db.query(`
      update public.login_sessions
      set ativo = false
      where ativo = true
        and expires_at is not null
        and expires_at < now()
    `);
  } catch (error) {
    console.error("Erro ao expirar sessões:", error.message);
  }
});
