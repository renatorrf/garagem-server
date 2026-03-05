/**
 * arquivo: config/database.js
 * descriçao: arquivo responsavel pelas requisiçoes no banco de dados (connection strings)
 * data: 14/03/2022
 * autor: Renato Filho
*/

const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

// Configurações avançadas do pool de conexões
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Configurações recomendadas para otimização
  max: 20, // Número máximo de clientes no pool
  min: 2, // Número mínimo de clientes no pool
  idleTimeoutMillis: 30000, // Tempo que um cliente pode ficar ocioso
  connectionTimeoutMillis: 20000, // Tempo máximo para tentar conectar
  allowExitOnIdle: true, // Permite que o processo saia quando o pool estiver ocioso
  ssl: true,
  sslmode: 'require',
});

// Tratamento de erros centralizado
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  // Não encerramos o processo imediatamente para evitar reinícios abruptos
});

// Adicionamos um listener para eventos de conexão
pool.on("connect", (client) => {
  console.log("New client connected to the pool");
});

// Adicionamos um listener para remoção de clientes
pool.on("remove", (client) => {
  console.log("Client removed from the pool");
});

/**
 * Executa uma query no banco de dados com opção de transação
 * @param {string} text - Query SQL ou nome de uma query nomeada
 * @param {Array} [params] - Parâmetros para a query
 * @param {Object} [options] - Opções adicionais
 * @param {boolean} [options.transaction=false] - Se deve ser executado em transação
 * @param {string} [options.queryName] - Nome para identificação da query nos logs
 * @param {number} [options.timeout] - Timeout em milissegundos para a query
 * @returns {Promise<QueryResult>} - Resultado da query
 */
const query = async (text, params, options = {}) => {
  const { transaction = false, queryName, timeout } = options;
  const start = Date.now();
  const client = await pool.connect();
  
  try {
    // Configura o nome da query para identificação nos logs do PostgreSQL
    if (queryName) {
      await client.query(`SET application_name TO '${queryName}'`);
    }

    // Configura timeout se especificado
    if (timeout) {
      await client.query(`SET statement_timeout TO ${timeout}`);
    }

    // Inicia transação se necessário
    if (transaction) {
      await client.query('BEGIN');
    }

    // Executa a query principal
    const res = await client.query(text, params);
    
    // Finaliza transação se necessário
    if (transaction) {
      await client.query('COMMIT');
    }

    // Log de desempenho
    const duration = Date.now() - start;
    console.log(`Query executed in ${duration}ms`, { 
      query: text, 
      params, 
      duration,
      rows: res.rowCount 
    });

    return res;
  } catch (err) {
    // Rollback em caso de erro em transação
    if (transaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Error during rollback:', rollbackErr);
      }
    }

    // Log detalhado do erro
    console.error('Query execution failed:', {
      query: text,
      params,
      error: err.message,
      stack: err.stack
    });

    // Adiciona informações extras ao erro
    err.query = text;
    err.params = params;
    throw err;
  } finally {
    // Libera o cliente de volta para o pool
    try {
      // Reseta configurações temporárias
      if (timeout) {
        await client.query('RESET statement_timeout').catch(() => {});
      }
      client.release();
    } catch (releaseErr) {
      console.error('Error releasing client:', releaseErr);
    }
  }
};

// Métodos auxiliares para operações comuns
const db = {
  /**
   * Executa uma query simples
   */
  query,

  /**
   * Executa uma query em transação
   */
  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Obtém um único registro
   */
  async getOne(text, params, options) {
    const result = await query(text, params, options);
    return result.rows[0] || null;
  },

  /**
   * Obtém múltiplos registros
   */
  async getMany(text, params, options) {
    const result = await query(text, params, options);
    return result.rows;
  },

  /**
   * Executa uma query e retorna o número de linhas afetadas
   */
  async execute(text, params, options) {
    const result = await query(text, params, options);
    return result.rowCount;
  }
};

// Health check do pool
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

// Fecha o pool de conexões adequadamente
db.close = async () => {
  await pool.end();
  console.log('Pool has been closed');
};
db.pool = pool;
module.exports = db;








