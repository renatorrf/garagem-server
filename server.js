// server.js (corrigido - CommonJS, inicialização única)
require("dotenv/config");

const app = require("./app");
const http = require("http");
const axios = require("axios");

// socket.io v4 (padrão correto no CommonJS)
const { Server: SocketIOServer } = require("socket.io");

// Sandbox SDK (compatível com export default ou named export)
const SandboxSDK = require("@koyeb/sandbox-sdk");
const Sandbox = SandboxSDK?.Sandbox || SandboxSDK;

const token = process.env.KOYEB_API_TOKEN;

// Importar serviços de leads apenas se configurado
let EmailCaptureService = null;
let leadsInitialized = false;

// Porta padrão: 4000 (e respeita PORT se o host definir)
const PORT = Number(process.env.PORT) || 4000;
const PORT_HEALTH = Number(process.env.PORT_HEALTH) || 8000;

// Cria servidor HTTP (necessário para socket.io)
const server = http.createServer(app);

// Socket.io (se você usa)
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// (Opcional) Eventos básicos do socket.io
io.on("connection", (socket) => {
  // console.log("Socket conectado:", socket.id);
  socket.on("disconnect", () => {
    // console.log("Socket desconectado:", socket.id);
  });
});

async function testSandbox() {
  try {
    const sandbox = await Sandbox.create({
      image: "ubuntu",
      name: "hello-world",
      wait_ready: true,
    });

    const result = await sandbox.exec("echo 'Sandbox is ready!'");
    console.log(result.stdout);

    await sandbox.delete();
  } catch (error) {
    console.error("Erro ao testar Sandbox:", error?.message || error);
  }
}

async function testKoyebAPI() {
  try {
    if (!token) throw new Error("KOYEB_API_TOKEN não definido no ambiente");

    const resp = await axios.get("https://app.koyeb.com/v1/services", {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("Koyeb Services:", resp.data);
  } catch (error) {
    const msg =
      error?.response?.data
        ? JSON.stringify(error.response.data)
        : error?.message || error;
    console.error("Erro ao acessar Koyeb API:", msg);
  }
}

async function initializeLeadsSystem() {
  try {
    // Verificar se as variáveis de email estão configuradas
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.log("⚠️  Sistema de leads: Credenciais de email não configuradas");
      console.log("💡 Para ativar, configure no .env:");
      console.log("   EMAIL_USER=leads.nextcaruberlandia@gmail.com");
      console.log("   EMAIL_PASSWORD=sua_app_password");
      return false;
    }

    // Carregar módulos de leads dinamicamente
    EmailCaptureService = require("./src/services/EmailCaptureService");
    const db = require("./src/config/database");

    // Testar conexão com banco
    const dbHealth = await db.healthCheck();
    if (dbHealth.status !== "healthy") {
      console.log("⚠️  Sistema de leads: Banco de dados não está saudável");
      return false;
    }

    console.log("🚗 Inicializando sistema de leads NextCar...");

    // Conectar ao email
    await EmailCaptureService.connect();
    EmailCaptureService.startScheduledCapture();

    console.log(`✅ Sistema de leads ativo para: ${process.env.EMAIL_USER}`);
    console.log("⏰ Captura agendada: verificação a cada 2 minutos");

    return true;
  } catch (error) {
    console.error("❌ Erro ao inicializar sistema de leads:", error.message);
    console.log("⚠️  O sistema principal continuará funcionando sem captura de leads");
    return false;
  }
}

function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    console.log(`\n${signal} recebido - Encerrando...`);

    // Encerrar sistema de leads se estiver ativo
    if (leadsInitialized && EmailCaptureService) {
      try {
        await EmailCaptureService.disconnect();
        console.log("📧 Sistema de leads: Conexão IMAP finalizada");
      } catch (error) {
        console.error("❌ Erro ao desconectar leads:", error.message);
      }
    }

    // Fechar socket.io
    try {
      io.close();
    } catch (_) {}

    // Fechar servidor
    server.close(() => {
      console.log("👋 Servidor HTTP encerrado");
      process.exit(0);
    });

    // Timeout de segurança
    setTimeout(() => {
      console.log("⚠️  Forçando encerramento...");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Tratamento de erros
process.on("uncaughtException", (error) => {
  console.error("💥 Erro não capturado:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 Promise rejeitada:", reason);
});

// Inicialização principal (ÚNICA)
async function startServer() {
  console.log("🚀 Iniciando sistema Garagem Web...");
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log(`👤 Banco: ${process.env.DATABASE_URL?.split("@")[1] || "Configurado"}`);

  // Rodar testes do Koyeb apenas quando explicitamente solicitado
  if (process.env.RUN_KOYEB_TESTS === "true") {
    await testSandbox();
    await testKoyebAPI();
  }

  // Inicializar sistema de leads (se configurado)
  leadsInitialized = await initializeLeadsSystem();

  // Iniciar servidor
  server.listen(PORT, () => {
    console.log("\n" + "=".repeat(60));
    console.log("✅ SERVIDOR PRINCIPAL ATIVO");
    console.log("=".repeat(60));
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🏥 Health Check: http://localhost:${PORT_HEALTH}/health`);

    if (leadsInitialized) {
      console.log(`🚗 Leads: http://localhost:${PORT}/garagemweb/api/leads`);
      console.log(`📧 Email: ${process.env.EMAIL_USER} (Ativo)`);
    } else {
      console.log("🚗 Sistema de leads: Não inicializado (configure .env)");
    }

    console.log("=".repeat(60));
    console.log("🛠️  Módulos carregados:");
    console.log("   • Cadastros ✓");
    console.log("   • Vendas ✓");
    console.log("   • Financeiro ✓");
    console.log(`   • Leads ${leadsInitialized ? "✓" : "✗ (configure .env)"}`);
    console.log("=".repeat(60));
    console.log(`🕒 ${new Date().toLocaleString("pt-BR")}`);
    console.log("=".repeat(60) + "\n");
  });

  setupGracefulShutdown();
}

// Executa apenas quando rodar diretamente (node server.js)
if (require.main === module) {
  startServer().catch((err) => {
    console.error("Startup error:", err);
    process.exit(1);
  });
}

module.exports = { server, startServer, io };