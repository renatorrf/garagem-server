const db = require("../config/database");
require("dotenv-safe").config();
const moment = require("moment");
const cron = require('node-cron');
const jwt = require("jsonwebtoken");
const fs = require("fs");
const { Console, error } = require("console");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

exports.verifyTokenSim = async (req, res, next) => {
  const token = req.headers.authorization;
  const tokenValido = process.env.AUTHTOKEN;

  if (token === tokenValido) {
    next(); // Chama o próximo middleware se o token for válido
  } else {
    return res.status(401).json({ auth: false, message: "Auth-Token inválido." });
  }
};

exports.cadastraVeiculo = async (req, res) => {

  const dataAtual = moment().format()
  const { dados_veiculo, imagens_veiculo } = req.body; // Agora recebe o objeto diretamente, não mais um array em data
  const schema = req.headers['schema']; // ou req.get('schema')

  try {
    await db.transaction(async (client) => {
      // Extrai os campos do body
      const {
        ind_tipo_veiculo, // recebe valor P para o lojista realizar o ajuste necessario
        nome_documento,
        des_veiculo_personalizado,
        documento,
        marca,
        modelo,
        modelo_completo,
        ano_fabricacao,
        ano_modelo,
        placa,
        chassis,
        renavam,
        cor,
        crv,
        combustivel,
        motorizacao,
        portas,
        cambio,
        km,
        dta_compra,
        val_venda_esperado,
        observacoes,
        cod_parceiro,
        des_proprietario,
        ind_veiculo_investidor,
        ind_importado, // recebe true toda vez que for veiculo importado por xml
        id_importacao //recebe o id do xml
      } = dados_veiculo;

      // Monta o objeto com os campos para inserção
      const veiculoFields = {
        des_veiculo: `${marca} ${modelo}`, // Combina marca e modelo
        des_veiculo_personalizado,
        observacoes: observacoes === null ? `Cor: ${cor}, Combustível: ${combustivel}, Motor: ${motorizacao}, Portas: ${portas}, Câmbio: ${cambio}, KM: ${km}` : observacoes,
        dta_compra,
        img_veiculo_capa: imagens_veiculo[0].src ?? null,
        ind_tipo_veiculo,
        des_proprietario: ind_tipo_veiculo === 'P' ? 'Prime Veiculos' : des_proprietario, // Ajustar conforme necessário
        val_venda_esperado,
        cod_parceiro: cod_parceiro || 0, // Ajustar se tiver parceiro
        documento,
        nome_documento,
        renavam,
        placa,
        ano_fabricacao,
        ano_modelo,
        des_veiculo_completa: `${marca} ${modelo} ${ano_fabricacao} ${cor}`, // Descrição completa
        chassis,
        modelo,
        modelo_completo,
        marca,
        cor,
        crv,
        km,
        dta_lancamento: dataAtual,
        combustivel,
        motorizacao,
        portas,
        cambio,
        valor_investido_investidor: 0, // Ajustar se for veículo de investidor
        valor_investido_proprio: 0,
        ind_veiculo_investidor: ind_veiculo_investidor,
        ind_importado,
        id_importacao
      };

      // Construímos a query dinamicamente
      const columns = Object.keys(veiculoFields).join(', ');
      const values = Object.values(veiculoFields);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      // Campos com valores fixos (mesmo do código anterior)
      const fixedValues = {
        ind_status: 'A',
        val_venda: null,
        val_compra: null,
        dta_venda: null,
        ind_troca: null,
        seq_veiculo_origem: null,
        ind_retorno_vinculado: false,
        cod_usuario_vinculado: 0,
        ind_ocorrencia_aberta: false,
        ind_financiado: false
      };

      // Query final com todos os campos
      const insertVeiculoQuery = `
          INSERT INTO ${schema}.tab_veiculo (
            ${columns}, ${Object.keys(fixedValues).join(', ')}
          ) VALUES (
            ${placeholders}, ${Object.values(fixedValues).map((_, i) => `$${values.length + i + 1}`).join(', ')}
          )
          RETURNING seq_veiculo; 
        `;

      // Executa a inserção do veículo
      const veiculoResult = await client.query(insertVeiculoQuery, [...values, ...Object.values(fixedValues)]);
      const seqVeiculo = veiculoResult.rows[0].seq_veiculo;

      if (imagens_veiculo && imagens_veiculo.length > 0) {
        // Prepara os dados para inserção em UM ÚNICO REGISTRO
        const columns = ['seq_veiculo'];
        const values = [seqVeiculo];
        const placeholders = ['$1'];

        // Adiciona até 12 imagens (img_1 a img_12)
        for (let i = 0; i < Math.min(imagens_veiculo.length, 12); i++) {
          const imageIndex = i + 1;
          columns.push(`img_${imageIndex}`);
          values.push(imagens_veiculo[i].src);
          placeholders.push(`$${values.length}`);

          console.log(imagens_veiculo[i].id)
        }

        // Monta a query dinamicamente
        const query = `
              INSERT INTO ${schema}.tab_veiculo_imagem
              (${columns.join(', ')})
              VALUES
              (${placeholders.join(', ')})
          `;

        // Executa uma ÚNICA inserção com todas as imagens
        await client.query(query, values);

        console.log(`Inserido registro com ${Math.min(imagens_veiculo.length, 12)} imagens para o veículo ${seqVeiculo}`);
      }
    });

    res.status(200).json({
      success: true,
      message: "Veículo cadastrado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao cadastrar veículo:", error);
    res.status(500).json({
      success: false,
      message: "Falha ao cadastrar o veículo",
      error: error.message
    });
  }
};

exports.salvaVeiculo = async (req, res) => {
  const dataAtual = moment().format();
  const { dados_veiculo, imagens_veiculo, img_alterada } = req.body;

  const schema = req.headers['schema'];

  try {
    await db.transaction(async (client) => {
      // Extrai os campos do body
      const {
        seq_veiculo, // Adicionado - necessário para o UPDATE
        val_compra,
        ind_tipo_veiculo,
        nome_documento,
        des_veiculo_personalizado,
        documento,
        marca,
        modelo,
        modelo_completo,
        ano_fabricacao,
        ano_modelo,
        placa,
        chassis,
        renavam,
        cor,
        crv,
        combustivel,
        motorizacao,
        portas,
        cambio,
        km,
        dta_compra,
        val_venda_esperado,
        observacoes,
        cod_parceiro,
        des_proprietario,
        des_veiculo_completa,
        valor_investido_investidor,
        valor_investido_proprio,
        imgCapaBase64,
        ind_veiculo_investidor,
        cod_banco
      } = dados_veiculo;

      // Verifica se seq_veiculo existe (obrigatório para UPDATE)
      if (!seq_veiculo) {
        throw new Error('seq_veiculo é obrigatório para atualização');
      }

      // Monta o objeto com os campos para atualização
      const veiculoFields = {
        des_veiculo: modelo_completo,
        val_compra: val_compra,
        des_veiculo_personalizado: des_veiculo_personalizado,
        observacoes: observacoes,
        dta_compra: dta_compra,
        img_veiculo_capa: img_alterada === true ? imagens_veiculo[0]?.src : imgCapaBase64, // Adicionado tratamento para imagem não existente
        ind_tipo_veiculo: ind_tipo_veiculo,
        des_proprietario: ind_tipo_veiculo === 'P' ? 'Prime Veiculos' : des_proprietario,
        val_venda_esperado: val_venda_esperado,
        cod_parceiro: cod_parceiro || 0,
        documento: documento,
        nome_documento: nome_documento,
        renavam: renavam,
        placa: placa,
        ano_fabricacao: ano_fabricacao,
        ano_modelo: ano_modelo,
        des_veiculo_completa: des_veiculo_completa,
        chassis: chassis,
        modelo: modelo,
        modelo_completo: modelo_completo,
        marca: marca,
        cor: cor,
        crv: crv,
        km: km,
        combustivel: combustivel,
        motorizacao: motorizacao,
        portas: portas,
        cambio: cambio,
        valor_investido_investidor: valor_investido_investidor,
        valor_investido_proprio: valor_investido_proprio,
        ind_veiculo_investidor: ind_veiculo_investidor,
        dta_ultima_alteracao: dataAtual,
        cod_banco: cod_banco,
        financeiro_incluso: true
      };

      // Remove campos com valor undefined/null para evitar erros
      Object.keys(veiculoFields).forEach(key => {
        if (veiculoFields[key] === undefined || veiculoFields[key] === null) {
          delete veiculoFields[key];
        }
      });

      // Constrói a parte SET da query dinamicamente
      const setClause = Object.keys(veiculoFields)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(', ');

      // Valores para o SET
      const values = Object.values(veiculoFields);

      // Adiciona o seq_veiculo no final (para a cláusula WHERE)
      values.push(seq_veiculo);

      // Query de UPDATE
      const updateVeiculoQuery = `
        UPDATE ${schema}.tab_veiculo
        SET ${setClause}
        WHERE seq_veiculo = $${values.length}
        RETURNING seq_veiculo;
      `;

      // Executa a atualização do veículo
      const veiculoResult = await client.query(updateVeiculoQuery, values);

      if (veiculoResult.rowCount === 0) {
        throw new Error('Nenhum veículo encontrado para atualização');
      }

      const seqVeiculo = veiculoResult.rows[0].seq_veiculo;

      // Atualiza as imagens se necessário
      if (imagens_veiculo && imagens_veiculo.length > 0 && img_alterada === true) {
        // Primeiro deleta as imagens existentes
        await client.query(`DELETE FROM ${schema}.tab_veiculo_imagem WHERE seq_veiculo = $1`, [seqVeiculo]);

        // Prepara os dados para inserção
        const columns = ['seq_veiculo'];
        const insertValues = [seqVeiculo];
        const placeholders = ['$1'];

        // Adiciona até 12 imagens (img_1 a img_12)
        for (let i = 0; i < Math.min(imagens_veiculo.length, 12); i++) {
          const imageIndex = i + 1;
          columns.push(`img_${imageIndex}`);
          insertValues.push(imagens_veiculo[i].src);
          placeholders.push(`$${insertValues.length}`);
        }

        // Monta a query de INSERT
        const insertImagensQuery = `
          INSERT INTO ${schema}.tab_veiculo_imagem
          (${columns.join(', ')})
          VALUES
          (${placeholders.join(', ')})
        `;

        // Executa a inserção das novas imagens
        await client.query(insertImagensQuery, insertValues);
      }
    });

    res.status(200).json({
      success: true,
      message: "Veículo atualizado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao atualizar veículo:", error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição no servidor',
      details: error.message,
      //errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.buscaVeiculo = async (req, res) => {
  const schema = req.headers['schema'];

  if (!schema) {
    return res.status(400).json({
      success: false,
      message: "Schema não especificado nos headers"
    });
  }

  try {
    // Consulta principal de veículos
    const veiculos = await db.getMany(`
      SELECT * FROM ${schema}.tab_veiculo
      WHERE ind_status != 'E'
      ORDER BY seq_veiculo DESC`);

    // Processamento assíncrono dos veículos
    const veiculosComDocumentosEImagens = await Promise.all(
      veiculos.map(async veiculo => {
        // Cria cópia do veículo sem o documento original
        const veiculoConvertido = { ...veiculo };

        // Converte o documento PDF para Base64 (se existir)
        if (veiculo.documento) {
          veiculoConvertido.documentoBase64 =
            veiculo.documento = veiculo.documento.toString()

          // Remove o documento original para economizar espaço
          delete veiculoConvertido.documento;
        }

        if (veiculo.img_veiculo_capa) {
          veiculoConvertido.imgCapaBase64 =
            veiculo.img_veiculo_capa = veiculo.img_veiculo_capa.toString()

          // Remove o documento original para economizar espaço
          delete veiculoConvertido.img_veiculo_capa;
        }

        // // Busca as imagens do veículo
        // const imagens = await db.getMany(`
        //   SELECT img_1, img_2, img_3, img_4, img_5, img_6, img_7, img_8, img_9, img_10, img_11, img_12
        //   FROM ${schema}.tab_veiculo_imagem
        //   WHERE seq_veiculo = $1`, [veiculo.seq_veiculo]);

        // const imagensConvertidas = imagens.map(row => {
        //   const {
        //     img_1, img_2, img_3, img_4, img_5, img_6,
        //     img_7, img_8, img_9, img_10, img_11, img_12
        //   } = row;

        //   return {
        //     img_1: img_1 !== null ? img_1.toString() : null,
        //     img_2: img_2 !== null ? img_2.toString() : null,
        //     img_3: img_3 !== null ? img_3.toString() : null,
        //     img_4: img_4 !== null ? img_4.toString() : null,
        //     img_5: img_5 !== null ? img_5.toString() : null,
        //     img_6: img_6 !== null ? img_6.toString() : null,
        //     img_7: img_7 !== null ? img_7.toString() : null,
        //     img_8: img_8 !== null ? img_8.toString() : null,
        //     img_9: img_9 !== null ? img_9.toString() : null,
        //     img_10: img_10 !== null ? img_10.toString() : null,
        //     img_11: img_11 !== null ? img_11.toString() : null,
        //     img_12: img_12 !== null ? img_12.toString() : null,
        //   };
        // });

        return {
          ...veiculoConvertido,
          //imagens: imagensConvertidas
        };
      })
    );

    res.status(200).json({
      success: true,
      data: veiculosComDocumentosEImagens,
      count: veiculosComDocumentosEImagens.length
    });

  } catch (error) {
    console.error("Erro ao buscar veículos:", error);
    res.status(500).json({
      success: false,
      message: "Falha ao buscar veículos",
      error: error.message
    });
  }
};

exports.excluirVeiculo = async (req, res) => {
  const { seq_veiculo, motivo_exclusao } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` UPDATE ${schema}.tab_veiculo 
                              SET ind_status = $1,
                                  motivo_exclusao = $2
                              WHERE seq_veiculo = $3 `;

        const values = ['E', motivo_exclusao, seq_veiculo]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaImgVeiculo = async (req, res) => {
  const { seq_veiculo } = req.body;
  const schema = req.headers['schema'];

  try {
    const result = await db.transaction(async (client) => {
      const query = `SELECT * FROM ${schema}.tab_veiculo_imagem WHERE seq_veiculo = $1`;
      const values = [seq_veiculo];

      const queryResult = await client.query(query, values);

      // Processa todas as imagens de todos os registros
      const resultados = queryResult.rows.map(row => {
        const imagensDoRegistro = [];

        // Verifica cada coluna de imagem (img_1 a img_12)
        for (let i = 1; i <= 12; i++) {
          const colName = `img_${i}`;
          if (row[colName] !== null) {
            imagensDoRegistro.push({
              posicao: i,
              imagem: Buffer.isBuffer(row[colName])
                ? row[colName].toString()
                : row[colName]
            });
          }
        }

        return {
          seq_registro: row.seq_registro,
          seq_veiculo: row.seq_veiculo,
          imagens: imagensDoRegistro,
          total_imagens: imagensDoRegistro.length
        };
      });

      return {
        registros: resultados,
        total_registros: queryResult.rowCount
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Imagens recuperadas com sucesso',
      data: result
    });

  } catch (error) {
    console.error('Erro ao buscar imagens:', error);
    return res.status(500).json({
      success: false,
      message: 'Falha ao recuperar imagens do veículo',
      details: error.message,
      //errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.atualizarImagemVeiculo = async (req, res) => {
  const setClauses = [];
  const values = [seqVeiculo];
  let paramIndex = 2;

  imagens_veiculo.forEach((image, index) => {
    if (index < 10) { // Para não exceder img_10
      setClauses.push(`img_${index + 1} = $${paramIndex}`);
      values.push(image);
      paramIndex++;
    }
  }
  );

  await client.query(`
        UPDATE ${schema}.tab_veiculo_imagem
        SET ${setClauses.join(', ')}
        WHERE seq_veiculo = $1
        `, values);
}

exports.cadastraDocumentoVeiculo = async (req, res) => {

  let { seq_veiculo, des_veiculo, documento, nome_documento, renavam, placa, ano, des_veiculo_completa, chassis, modelo } = req.body;

  try {

    await db.queryGaragem(`
      UPDATE tab_veiculo
      SET 
        des_veiculo = $1,
        documento = $2, 
        nome_documento = $3,
        renavam = $4,
        placa = $5,
        ano = $6,
        des_veiculo_completa = $7,
        chassis = $8,
        modelo = $9
      WHERE seq_veiculo = $10
    `, [des_veiculo, documento, nome_documento, renavam, placa, ano, des_veiculo_completa, chassis, modelo, seq_veiculo]);

    res.status(200).json({
      message: "Documento Anexado com sucesso.",
    });

  } catch (error) {
    res.status(500).json({
      message: "Falha em anexar documento:" + error
    });
  }

};

exports.cadastraCompromissoAgenda = async (req, res) => {
  const { seq_registro, titulo, hora, dia, descricao, concluido = false, tipo, repeatMonths } = req.body;
  const schema = req.headers['schema'];

  console.log(req.body)

  // Validação dos campos obrigatórios
  if (!tipo) {
    return res.status(400).json({
      success: false,
      message: "Tipo de operação não especificado (i=inserir, c=concluir, p=pendente, d=deletar)"
    });
  }

  if (tipo === 'i' && (!titulo || !hora || !dia)) {
    return res.status(400).json({
      success: false,
      message: "Para inserção, campos obrigatórios faltando: titulo, hora e dia são necessários"
    });
  }

  if ((tipo === 'c' || tipo === 'p' || tipo === 'd') && !seq_registro) {
    return res.status(400).json({
      success: false,
      message: "Para atualização/exclusão, seq_registro é obrigatório"
    });
  }

  try {
    const result = await db.transaction(async (client) => {
      switch (tipo) {
        case 'i': // Inserção
          const resultados = [];
          const dataBase = new Date(dia); // Data base para calcular os meses

          for (let index = 0; index < repeatMonths; index++) {
            // Calcula a data para cada mês CORRETAMENTE
            const dataEvento = moment(dataBase).add(index, 'months').format('YYYY-MM-DD');

            const insertQuery = `
              INSERT INTO ${schema}.tab_agenda (titulo, hora, dia, descricao, concluido)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING seq_registro
            `;

            const resultado = await client.query(insertQuery, [
              titulo,
              hora,
              dataEvento, // Já está formatado como YYYY-MM-DD
              descricao || null,
              Boolean(concluido)
            ]);

            // Verifica se há resultados antes de acessar
            if (resultado.rows && resultado.rows.length > 0) {
              resultados.push(resultado.rows[0]);
            } else {
              // Log para debug ou lançar erro
              console.warn('Nenhum registro retornado no INSERT');
            }
          }

          return resultados;

        case 'c': // Concluir
        case 'p': // Pendente
          const updateQuery = `
            UPDATE ${schema}.tab_agenda 
            SET concluido = $1
            WHERE seq_registro = $2
            RETURNING seq_registro
          `;
          const updateResult = await client.query(updateQuery, [
            tipo === 'c',
            seq_registro
          ]);

          if (!updateResult.rows || updateResult.rows.length === 0) {
            throw new Error('Registro não encontrado para atualização');
          }
          return updateResult;

        case 'd': // Deletar
          const deleteQuery = `
            DELETE FROM ${schema}.tab_agenda 
            WHERE seq_registro = $1
            RETURNING seq_registro
          `;
          const deleteResult = await client.query(deleteQuery, [seq_registro]);

          if (!deleteResult.rows || deleteResult.rows.length === 0) {
            throw new Error('Registro não encontrado para exclusão');
          }
          return deleteResult;

        default:
          throw new Error('Tipo de operação inválido');
      }
    });

    const operationMessages = {
      'i': `Compromissos inseridos com sucesso (${repeatMonths} meses)`,
      'c': 'Compromisso marcado como concluído',
      'p': 'Compromisso marcado como pendente',
      'd': 'Compromisso removido com sucesso'
    };

    // RESPOSTA CORRIGIDA - Trata diferentes tipos de retorno
    if (tipo === 'i') {
      // Para inserção: result é um array
      res.status(200).json({
        success: true,
        message: operationMessages[tipo],
        tipo: tipo,
        registros: result, // Array com todos os registros inseridos
        total_inseridos: result.length
      });
    } else {
      // Para outros tipos: result é um objeto com rows
      res.status(200).json({
        success: true,
        message: operationMessages[tipo],
        tipo: tipo,
        seq_registro: result.rows[0].seq_registro
      });
    }

  } catch (error) {
    console.error("Erro ao processar compromisso:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao processar compromisso",
      error: error.message
    });
  }
};

exports.buscaCompromissosAgenda = async (req, res) => {
  const schema = req.headers['schema'];

  if (!schema) {
    return res.status(400).json({
      success: false,
      message: "Schema não especificado nos headers"
    });
  }

  try {
    // Consulta corrigida com os nomes reais das colunas
    const query = `
      SELECT 
        dia as date,
        jsonb_agg(
          jsonb_build_object(
            'seq_registro', seq_registro,
            'titulo', titulo,
            'hora', hora,
            'descricao', descricao,
            'concluido', concluido,
            'dia', dia
          )
        ) as appointments
      FROM 
        ${schema}.tab_agenda
      GROUP BY 
        dia
      ORDER BY 
        dia;
    `;

    const { rows } = await db.query(query);

    const result = {};
    rows.forEach(row => {
      // Agora row.date virá corretamente como 'dia'
      result[row.date] = row.appointments;
    });

    res.status(200).json({
      success: true,
      message: result,
    });

  } catch (error) {
    console.error("Erro ao buscar compromissos:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao buscar compromissos",
      error: error.message
    });
  }
};

exports.buscaIntegradoresAtivos = async (req, res) => {

  const schema = req.headers['schema'];

  try {
    const result = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT seq_registro, nome_integrador from ${schema}.tab_integradores
                              WHERE ind_status = $1`;

        const values = [true]

        const queryResult = await client.query(insertQuery, values);

        return {
          rows: queryResult.rows,
          rowCount: queryResult.rowCount
        };

        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: result
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastraParceiros = async (req, res) => {

  const { nom_parceiro, ind_tipo, percentual_lucro } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_parceiros (nom_parceiro, ind_tipo, percentual_lucro)
                             VALUES ($1, $2, $3)`;

        const values = [nom_parceiro, ind_tipo, percentual_lucro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaParceiros = async (req, res) => {

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `select * from ${schema}.tab_parceiros WHERE ind_status = $1`;

        const values = [true]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.editaParceiros = async (req, res) => {

  const { seq_registro } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `UPDATE ${schema}.tab_parceiros SET ind_status = $1 where seq_registro = $2`;

        const values = [false, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastraBanco = async (req, res) => {

  const { des_banco, agencia, conta_corrente } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_conta_banco (des_banco, agencia, conta_corrente)
                             VALUES ($1, $2, $3)`;

        const values = [des_banco, agencia, conta_corrente]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaBanco = async (req, res) => {

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `select * from ${schema}.tab_conta_banco WHERE ind_status = $1`;

        const values = [true]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.editaBanco = async (req, res) => {

  const { seq_registro } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `UPDATE ${schema}.tab_conta_banco SET ind_status = $1 where seq_registro = $2`;

        const values = [false, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastraCartao = async (req, res) => {

  const { bandeira, final_cartao, vencimento, fechamento } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_cartao (bandeira, final_cartao, vencimento, fechamento)
                             VALUES ($1, $2, $3, $4)`;

        const values = [bandeira, final_cartao, vencimento, fechamento]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaCartao = async (req, res) => {

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `select * from ${schema}.tab_cartao WHERE ind_status = $1`;

        const values = [true]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.editaCartao = async (req, res) => {

  const { seq_registro } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `UPDATE ${schema}.tab_cartao SET ind_status = $1 where seq_registro = $2`;

        const values = [false, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.inserirMovimento = async (req, res) => {
  const {
    tipo_movimento,
    dta_movimento: inputDtaMovimento, // Renomeei para evitar confusão
    des_movimento,
    ind_conciliado,
    dta_conciliado,
    ind_excluido,
    ind_alterado,
    seq_veiculo,
    des_origem,
    cod_banco,
    des_movimento_detalhado,
    cod_cartao,
    val_movimento: inputValMovimento, // Renomeei para evitar confusão
    descricao_mov_ofx,
    cod_banco_ofx,
    id_unico,
    cod_categoria_movimento,
    des_categoria_movimento,
    parcela: totalParcelas,
    seq_despesa,
    cartao,
    seq_fatura,
    ind_cartao_pago
  } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        let lastResult;

        if (totalParcelas && totalParcelas > 1) { // Verifica se há parcelamento
          for (let index = 0; index < totalParcelas; index++) {
            const numeroParcela = index + 1;
            let dataMovimento = moment(inputDtaMovimento); // Cria uma cópia modificável

            // Ajusta a data conforme o fechamento do cartão
            const diaMesFechamento = moment(cartao.fechamento).format('MM-DD');
            const diaMesMovimento = dataMovimento.format('MM-DD');

            if (diaMesMovimento > diaMesFechamento) {
              dataMovimento.add(30, 'days');
            }

            // Adiciona 30 dias para cada parcela após a primeira
            if (index > 0) {
              dataMovimento.add(30 * index, 'days');
            }

            // Calcula o valor da parcela (sem modificar a constante original)
            const valorParcela = inputValMovimento / totalParcelas;

            const insertQuery = `
              INSERT INTO ${schema}.tab_movimentacao (
                tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
                ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
                des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
                cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
                parcela, seq_despesa, seq_fatura, ind_cartao_pago
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
              RETURNING seq_registro;
            `;

            const values = [
              tipo_movimento,
              dataMovimento.format('YYYY-MM-DD'), // Usa a data ajustada
              des_movimento,
              ind_conciliado,
              dta_conciliado,
              ind_excluido,
              ind_alterado,
              seq_veiculo,
              des_origem,
              cod_banco,
              des_movimento_detalhado,
              cod_cartao,
              valorParcela, // Valor já calculado
              descricao_mov_ofx,
              cod_banco_ofx,
              id_unico,
              cod_categoria_movimento,
              des_categoria_movimento,
              numeroParcela,
              seq_despesa,
              seq_fatura,
              ind_cartao_pago
            ];

            lastResult = await client.query(insertQuery, values);

            if (seq_veiculo) { // Simplificado (null/undefined são falsy)
              const seq_registro = lastResult.rows[0].seq_registro;
              await client.query(
                `UPDATE ${schema}.tab_veiculo 
                 SET cod_movimentacao = $1, financeiro_incluso = true
                 WHERE seq_veiculo = $2`,
                [seq_registro, seq_veiculo]
              );
            }
          }
        } else {
          // Lógica para não parcelado (similar, mas sem divisão de valor)
          const insertQuery = `
          INSERT INTO ${schema}.tab_movimentacao (
            tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
            ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
            des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
            cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
            parcela, seq_despesa, seq_fatura, ind_cartao_pago
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING seq_registro;
        `;

          const values = [
            tipo_movimento,
            inputDtaMovimento, // Usa a data ajustada
            des_movimento,
            ind_conciliado,
            dta_conciliado,
            ind_excluido,
            ind_alterado,
            seq_veiculo,
            des_origem,
            cod_banco,
            des_movimento_detalhado,
            cod_cartao,
            inputValMovimento, // Valor já calculado
            descricao_mov_ofx,
            cod_banco_ofx,
            id_unico,
            cod_categoria_movimento,
            des_categoria_movimento,
            totalParcelas,
            seq_despesa,
            seq_fatura,
            ind_cartao_pago
          ];
          lastResult = await client.query(insertQuery, values);

          if (seq_veiculo) {
            const seq_registro = lastResult.rows[0].seq_registro;
            const updateQuery = `UPDATE ${schema}.tab_veiculo 
                                 SET cod_movimentacao = $1,
                                     financeiro_incluso = true
                                 WHERE seq_veiculo = $2`;
            const valuesUpdate = [seq_registro, seq_veiculo];
            await client.query(updateQuery, valuesUpdate);
          }
        }

        return {
          rows: lastResult.rows,
          rowCount: lastResult.rowCount
        };
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError;
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
};

exports.alteraMovimento = async (req, res) => {

  const { seq_registro, ind_excluido, ind_alterado, val_movimento, cod_banco, cod_cartao, dta_movimento } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const updateQuery = `UPDATE ${schema}.tab_movimentacao 
                             SET ind_excluido = $1, ind_alterado = $2, val_movimento = $3, cod_banco = $4, cod_cartao = $5, dta_movimento = $6
                             where seq_registro = $7`;

        const values = [ind_excluido, ind_alterado, val_movimento, cod_banco, cod_cartao, dta_movimento, seq_registro]

        const result = await client.query(updateQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.inserirDespesaVeiculo = async (req, res) => {
  const { cod_banco, cod_cartao, des_despesa, cod_tipo_despesa,
    des_tipo_despesa, des_veiculo_garantia, dta_despesa,
    ind_excluido, seq_veiculo, seq_veiculo_garantia, val_despesa, parcela } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_despesa_veiculo
                                  (cod_banco, cod_cartao, des_despesa, cod_tipo_despesa, 
                                  des_tipo_despesa, des_veiculo_garantia, dta_despesa, ind_excluido, 
                                  seq_veiculo, seq_veiculo_garantia, val_despesa, parcela)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                             RETURNING seq_registro`;

        const values = [cod_banco, cod_cartao, des_despesa, cod_tipo_despesa,
          des_tipo_despesa, des_veiculo_garantia, dta_despesa,
          ind_excluido, seq_veiculo, seq_veiculo_garantia, val_despesa, parcela]

        const result = await client.query(insertQuery, values);

        const seq_registro = result.rows[0].seq_registro;

        return {
          rows: result.rows,
          rowCount: result.rowCount,
          registro: seq_registro
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaDespesaVeiculo = async (req, res) => {
  const { seq_veiculo } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` select * from ${schema}.tab_despesa_veiculo
                              where seq_veiculo = $1 `;

        const values = [seq_veiculo]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaMovimentoFinanceiro = async (req, res) => {


  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const selectQuery = `SELECT a.* from ${schema}.tab_movimentacao a order by a.seq_registro desc LIMIT $1 `;

        const values = [1000]

        const records = await client.query(selectQuery, values);

        const result = records.rows.map(row => {
          return {
            ...row,
            val_movimento: row.tipo_movimento === 'S' ? -Math.abs(row.val_movimento) : row.val_movimento
          };
        });

        return {
          rows: result,
          rowCount: records.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.importarFinanceiroOFX = async (req, res) => {
  const { movimentosSelecionados, banco } = req.body;

  console.log(movimentosSelecionados)
  const schema = req.headers['schema'];

  const dtaAtual = moment().format()

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Verifica se há movimentos para inserir
        if (!movimentosSelecionados || movimentosSelecionados.length === 0) {
          throw new Error('Nenhum movimento selecionado para importação');
        }

        // Prepara os valores para inserção em lote
        const values = movimentosSelecionados.map(mov => [
          mov.tipo === 'E' ? 'E' : 'S',  // tipo_movimento
          mov.data,                      // dta_movimento
          mov.descricao,                 // des_movimento
          true,                          // ind_conciliado (padrão false)
          dtaAtual,                      // dta_conciliado (null inicialmente)
          false,                         // ind_excluido (padrão false)
          false,                         // ind_alterado (padrão false)
          null,                          // seq_veiculo (pode ser ajustado)
          'Importação OFX',              // des_origem
          banco.seq_registro,                         // cod_banco
          mov.descricao,                 // des_movimento_detalhado
          null,                          // cod_cartao (ajuste conforme necessário)
          `Movimento Importado via OFX em: ${moment(dtaAtual).format('DD/MM/YYYY')}`, // des_observacao
          mov.valor,                     // val_movimento
          mov.descricao,                 // descricao_mov_ofx
          parseInt(mov.codigoBanco),     // cod_banco_ofx
          mov.idUnico,                    // id_unico
          mov.cod_categoria_movimento,    //categoruia
          mov.des_categoria_movimento     //des_categoria
        ]);

        // Monta a query de inserção em lote
        const insertQuery = `
        INSERT INTO ${schema}.tab_movimentacao (
          tipo_movimento, dta_movimento, des_movimento, 
          ind_conciliado, dta_conciliado, ind_excluido, 
          ind_alterado, seq_veiculo, des_origem, 
          cod_banco, des_movimento_detalhado, cod_cartao, 
          des_observacao, val_movimento, descricao_mov_ofx, 
          cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento
        ) VALUES ${movimentosSelecionados.map((_, i) =>
          `($${i * 19 + 1}, $${i * 19 + 2}, $${i * 19 + 3}, $${i * 19 + 4}, $${i * 19 + 5}, $${i * 19 + 6}, 
           $${i * 19 + 7}, $${i * 19 + 8}, $${i * 19 + 9}, $${i * 19 + 10}, $${i * 19 + 11}, $${i * 19 + 12}, 
           $${i * 19 + 13}, $${i * 19 + 14}, $${i * 19 + 15}, $${i * 19 + 16}, $${i * 19 + 17}, $${i * 19 + 18}, $${i * 19 + 19})`
        ).join(', ')}
        RETURNING *
      `;

        // Executa a query - flatten dos valores
        const result = await client.query(insertQuery, values.flat());

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError;
      }
    });

    return res.status(200).json({
      success: true,
      message: `${queryResult.rowCount} movimentos importados com sucesso`,
      data: queryResult.rows
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao importar movimentos OFX',
      details: error.message,
      //errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.conciliarEncontrados = async (req, res) => {
  const { movimentosEncontrados } = req.body; // Agora recebe um array
  const dtaAtual = moment().format();
  const schema = req.headers['schema'];

  // Validação básica
  if (!movimentosEncontrados || !Array.isArray(movimentosEncontrados)) {
    return res.status(400).json({
      success: false,
      message: 'Dados inválidos: movimentosEntrados deve ser um array'
    });
  }

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Preparar e executar todas as atualizações
        const resultados = await Promise.all(
          movimentosEncontrados.map(async (movimento) => {
            // Validação dos campos obrigatórios
            if (!movimento.seq_registro) {
              throw new Error(`Movimento sem seq_registro: ${JSON.stringify(movimento)}`);
            }

            const updateQuery = `
              UPDATE ${schema}.tab_movimentacao
              SET 
                dta_conciliado = $1,
                descricao_mov_ofx = COALESCE($2, descricao_mov_ofx),
                cod_banco_ofx = COALESCE($3, cod_banco_ofx),
                id_unico = COALESCE($4, id_unico),
                ind_conciliado = $5
              WHERE seq_registro = $6
              RETURNING seq_registro, des_movimento
            `;

            const values = [
              dtaAtual,
              movimento.descricao_mov_ofx,
              movimento.cod_banco_ofx,
              movimento.id_unico,
              true, // ind_conciliado
              movimento.seq_registro
            ];

            const result = await client.query(updateQuery, values);
            return result.rows[0]; // Retorna o registro atualizado
          })
        );

        return {
          rows: resultados.filter(r => r), // Filtra resultados nulos
          rowCount: resultados.length
        };
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError;
      }
    });

    return res.status(200).json({
      success: true,
      message: `${queryResult.rowCount} movimentos conciliados com sucesso`,
      data: queryResult.rows
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao conciliar movimentos',
      details: error.message,
      //errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

async function apurarSaldosBancarios() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Obter a data atual no formato YYYY-MM-DD
    const hoje = new Date().toISOString().split('T')[0];

    // 2. Query para calcular saldos por banco
    const calculoSaldoQuery = `
      SELECT 
        m.cod_banco as seq_banco,
        b.des_banco,
        COALESCE(SUM(CASE WHEN m.tipo_movimento = 'E' THEN m.val_movimento ELSE 0 END), 0) - 
        COALESCE(SUM(CASE WHEN m.tipo_movimento = 'S' THEN m.val_movimento ELSE 0 END), 0) as saldo_dia,
        $1 as dta_saldo
      FROM teste.movimentacao m
      JOIN bancos b ON m.cod_banco = b.seq_banco
      WHERE m.dta_movimento::date = $1::date
        AND m.ind_excluido = false
      GROUP BY m.cod_banco, b.des_banco
    `;

    // 3. Executar cálculo
    const { rows } = await client.query(calculoSaldoQuery, [hoje]);

    if (rows.length === 0) {
      console.log(`Nenhum movimento encontrado para apuração em ${hoje}`);
      return;
    }

    // 4. Inserir na tabela de apuração
    const insertQuery = `
      INSERT INTO teste.tab_apuracao_saldo_banco 
        (seq_banco, des_banco, saldo_dia, dta_saldo)
      VALUES ${rows.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ')}
      ON CONFLICT (seq_banco, dta_saldo) 
      DO UPDATE SET 
        des_banco = EXCLUDED.des_banco,
        saldo_dia = EXCLUDED.saldo_dia
    `;

    // 5. Preparar valores para inserção
    const values = rows.flatMap(row => [
      row.seq_banco,
      row.des_banco,
      row.saldo_dia,
      hoje
    ]);

    // 6. Executar inserção/atualização
    await client.query(insertQuery, values);
    await client.query('COMMIT');

    console.log(`Saldo apurado para ${rows.length} bancos em ${hoje}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro na apuração de saldos:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Agendar para rodar todo dia às 23h
cron.schedule('0 23 * * *', () => {
  console.log('Iniciando apuração automática de saldos bancários...');
  apurarSaldosBancarios()
    .catch(err => console.error('Erro no agendamento:', err));
});

console.log('Agendador de apuração de saldos iniciado. Será executado diariamente às 23h.');

exports.cadastraDespesaOperacional = async (req, res) => {
  const { des_despesa, val_despesa, dta_despesa, cod_tipo_despesa, des_tipo_despesa, cod_banco, cod_cartao, parcela } = req.body;

  const schema = req.headers['schema'];

  console.log(req.body)
  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_despesa_operacional 
                              (des_despesa, val_despesa, dta_despesa, cod_tipo_despesa, des_tipo_despesa, cod_banco, cod_cartao, parcela)
                              values
                              ($1, $2, $3, $4, $5, $6, $7, $8)
                              RETURNing seq_registro`;

        const values = [des_despesa, val_despesa, dta_despesa, cod_tipo_despesa, des_tipo_despesa, cod_banco, cod_cartao, parcela]

        const result = await client.query(insertQuery, values);

        const seq_registro = result.rows[0].seq_registro;

        return {
          rows: result.rows,
          rowCount: result.rowCount,
          registro: seq_registro
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaDespesaOperacional = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * FROM ${schema}.tab_despesa_operacional
                            ORDER BY seq_registro desc
                             LIMIT 30`;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaMovimentoCartao = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * FROM ${schema}.tab_despesa_operacional
                            ORDER BY seq_registro desc
                             LIMIT 30`;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.faturaCartao = async (req, res) => {
  const { total, seqMovimentos, dataVencimento, codCartao } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const seqMovimentosStr = seqMovimentos.join(',');

        const insertQuery = `INSERT INTO ${schema}.tab_fatura_cartao
                             (cod_cartao, val_fatura, dta_vencimento, dta_pagamento, cod_banco, ind_pago, val_pago, seq_movimento_cartao)
                             VALUES 
                             ($1, $2, $3, $4, $5, $6, $7, $8)
                             RETURNING seq_registro`;

        const values = [codCartao, total, dataVencimento, null, null, false, null, seqMovimentosStr]

        const result = await client.query(insertQuery, values);

        const seq_registro = result.rows[0].seq_registro;

        const updateQuery = `UPDATE ${schema}.tab_movimentacao
                              SET seq_fatura = $1,
                                  ind_faturado = $2
                              where seq_registro in (${seqMovimentos})`;

        const valuesUpdate = [seq_registro, true]

        await client.query(updateQuery, valuesUpdate);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscafaturaCartao = async (req, res) => {

  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `select * from ${schema}.tab_fatura_cartao a
                              order by a.seq_registro
                              `;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.liquidarFaturaCartao = async (req, res) => {

  const { cod_banco, cod_cartao, dta_pagamento, dta_vencimento, ind_pago, seq_movimento_cartao, seq_registro, val_fatura, val_pago } = req.body;

  console.log(req.body)

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` update ${schema}.tab_fatura_cartao
                              SET ind_pago = $1,
                                  cod_banco = $2
                              WHERE seq_registro = $3 `;

        const values = [true, cod_banco, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaFinanceiras = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` SELECT a.*, b.seq_registro as cod_banco, b.des_banco FROM ${schema}.tab_financeiras a
                              LEFT JOIN ${schema}.tab_conta_banco b on (a.cod_banco = b.seq_registro)
                              order by a.seq_registro`;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.vinculaBancoFinanceiras = async (req, res) => {
  const { seq_registro, cod_banco } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` UPDATE ${schema}.tab_financeiras
                              SET cod_banco = $1
                              WHERE seq_registro = $2 `;

        const values = [cod_banco, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaCliente = async (req, res) => {
  const { valor } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * from ${schema}.tab_cliente
                            WHERE num_cpf_cnpj like $1 `;

        const values = [valor]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastrarCliente = async (req, res) => {
  const { nom_cliente, num_cnpj_cpf, des_logradouro, complemento, cep, telefone, dta_nascimento, bairro, cidade, uf } = req.body;

  const schema = req.headers['schema'];

  dtaAtual = moment().format()

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` INSERT INTO ${schema}.tab_cliente
                              (nom_cliente, num_cpf_cnpj, des_logradouro, complemento, cep, telefone, dta_nascimento, dta_cadastro, bairro, cidade, uf)
                              VALUES
                              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                              RETURNing seq_registro`;

        const values = [nom_cliente, num_cnpj_cpf, des_logradouro, complemento, cep, telefone, dta_nascimento, dtaAtual, bairro, cidade, uf]

        const result = await client.query(insertQuery, values);

        const seq_registro = result.rows[0].seq_registro;

        return {
          rows: result.rows,
          rowCount: result.rowCount,
          registro: seq_registro
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.vinculaVeiculoCliente = async (req, res) => {
  const { seq_registro, seq_veiculo } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` UPDATE ${schema}.tab_veiculo
                              SET cod_usuario_vinculado = $1
                              WHERE seq_veiculo = $2 `;

        const values = [seq_registro, seq_veiculo]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.vinculaContratoVeiculo = async (req, res) => {

  const { seq_veiculo, contrato } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `update ${schema}.tab_veiculo
                            set img_contrato = $1
                            WHERE seq_veiculo = $2 `;

        const values = [contrato, seq_veiculo]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.finalizaVendaVeiculo = async (req, res) => {
  const { des_veiculo, cod_banco_entrada, cod_financeira, des_financeira, cod_banco_financeira, dados_consorcio, des_veiculo_entrada, ind_troca, observacao_venda, ind_tipo_veiculo,
    seq_veiculo, val_compra, total_prazo, dta_primeiro_venc_prazo, val_consorcio, val_entrada_cartao, val_entrada_especie, val_financiado, val_veiculo_entrada, val_venda, valor_prazo,
    indTroca, indPrazo, indFinanciado, indConsorcio, entradaEspecie, entradaCartao, cod_vendedor, cod_cliente } = req.body;

  const schema = req.headers['schema'];

  console.log(req.body)

  dtaAtual = moment().format()

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const lucro = val_venda - val_compra

        const insertQuery = `UPDATE ${schema}.tab_veiculo
                             SET des_veiculo_entrada = $1,
                                 observacao_venda = $2,
                                 total_prazo = $3,
                                 val_consorcio = $4,
                                 val_entrada_cartao = $5,
                                 val_entrada_especie = $6,
                                 val_financiado = $7,
                                 val_veiculo_entrada = $8,
                                 val_venda = $9,
                                 valor_prazo = $10,
                                 dta_venda = $11,
                                 ind_status = 'V',
                                 ind_troca = $16,
                                 val_lucro = ($12),
                                 valor_venda_contrato = ($13),
                                 cod_vendedor = $14
                             WHERE seq_veiculo = $15`;

        const values = [des_veiculo_entrada, observacao_venda, total_prazo, val_consorcio, val_entrada_cartao, val_entrada_especie, val_financiado, val_veiculo_entrada,
          val_venda, valor_prazo, dtaAtual, lucro, val_venda, cod_vendedor, seq_veiculo, ind_troca]

        const result = await client.query(insertQuery, values);

        if (indTroca) {
          await processarTroca(client, schema, des_veiculo_entrada, des_veiculo, seq_veiculo);
        }
        if (indPrazo) {
          await indPrazoF(client, schema, total_prazo, valor_prazo, des_veiculo, dta_primeiro_venc_prazo, seq_veiculo, cod_cliente)
        }
        if (indFinanciado) {
          await indFinanciadoF(client, schema, cod_financeira, cod_banco_financeira, val_financiado, seq_veiculo, des_veiculo, des_financeira, cod_cliente)
        }
        if (indConsorcio) {
          await indConsorcioF(client, schema, val_consorcio, dados_consorcio, seq_veiculo, des_veiculo, cod_cliente)
        }
        if (entradaEspecie) {
          await entradaEspecieF(client, schema, val_entrada_especie, cod_banco_entrada, des_veiculo, seq_veiculo, ind_tipo_veiculo)
        }
        if (entradaCartao) {
          await entradaCartaoF(client, schema, val_entrada_cartao, cod_banco_entrada, des_veiculo, seq_veiculo, ind_tipo_veiculo)
        }

        return {
          rows: result.rows,
          rowCount: result.rowCount,
          seq_veiculo: seq_veiculo
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }

  async function processarTroca(client, schema, des_veiculo_entrada, des_veiculo, seq_veiculo) {

    const dtaAtual = moment().format('YYYY-MM-DD');

    const camposAgenda = {
      titulo: 'Cadastrar Veículo',
      hora: '12:00',
      dia: dtaAtual,
      descricao: `Veículo Recebido na troca: ${des_veiculo_entrada} na venda do: ${des_veiculo}`,
      concluido: false,
      seq_veiculo
    };

    const insertQuery = `
      INSERT INTO ${schema}.tab_agenda (titulo, hora, dia, descricao, concluido, seq_veiculo)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING seq_registro
    `;

    await client.query(insertQuery, [
      camposAgenda.titulo,
      camposAgenda.hora,
      camposAgenda.dia,
      camposAgenda.descricao,
      camposAgenda.concluido,
      camposAgenda.seq_veiculo
    ]);
  }

  async function indPrazoF(client, schema, total_prazo, valor_prazo, des_veiculo, dta_primeiro_venc_prazo, seq_veiculo, cod_cliente) {

    const parcela = valor_prazo / total_prazo;
    const resultados = [];

    for (let index = 0; index < total_prazo; index++) {
      const campos = {
        des_receita: `Parcela ${index + 1} do ${des_veiculo}`,
        dta_receita: moment(dta_primeiro_venc_prazo).add(index * 30, 'days').format(),
        val_receita: parcela,
        seq_veiculo,
        des_veiculo,
        cod_cliente,
        cod_tipo: 91,
        cod_banco: 0
      };

      const insertQuery = `
            INSERT INTO ${schema}.tab_conta_receber
            (des_receita, dta_receita, val_receita, seq_veiculo, des_veiculo, cod_cliente, cod_tipo, cod_banco)
            VALUES ($1, $2, $3, $, $5, $6, $7, $8)
            RETURNING *;
          `;

      const result = await client.query(insertQuery, [
        campos.des_receita,
        campos.dta_receita,
        campos.val_receita,
        campos.seq_veiculo,
        campos.des_veiculo,
        campos.cod_cliente,
        campos.cod_tipo,
        campos.cod_banco
      ]);

      resultados.push(result.rows[0]);
    }
  }

  async function indFinanciadoF(client, schema, cod_financeira, cod_banco_financeira, val_financiado, seq_veiculo, des_veiculo, des_financeira, cod_cliente) {


    const dtaAtual = moment().format()

    const campos = {
      des_receita: `Aprovar Recebimento do ${des_veiculo} pela Financiado na ${des_financeira}`,
      dta_receita: dtaAtual,
      val_receita: val_financiado,
      seq_veiculo,
      cod_banco_financeira,
      cod_tipo: 93, // Recebimento de Financiamentos
      des_veiculo,
      cod_cliente
    };

    const insertQuery = `
            INSERT INTO ${schema}.tab_conta_receber
            (des_receita, dta_receita, val_receita, seq_veiculo, cod_banco, cod_tipo, des_veiculo, cod_cliente)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ;
          `;

    await client.query(insertQuery, [
      campos.des_receita,
      campos.dta_receita,
      campos.val_receita,
      campos.seq_veiculo,
      campos.cod_banco_financeira,
      campos.cod_tipo,
      campos.des_veiculo,
      campos.cod_cliente
    ]);

    const camposRetorno = {
      des_receita: `Especificar Retorno do ${des_veiculo} Financiado na ${des_financeira}`,
      dta_receita: dtaAtual,
      val_receita: 0,
      seq_veiculo,
      cod_banco_financeira,
      cod_tipo: 99, // Retorno de Financiamentos
      des_veiculo,
      cod_cliente
    };

    const insertQueryRetorno = `
            INSERT INTO ${schema}.tab_conta_receber
            (des_receita, dta_receita, val_receita, seq_veiculo, cod_banco, cod_tipo, des_veiculo, cod_cliente)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ;
          `;

    await client.query(insertQueryRetorno, [
      camposRetorno.des_receita,
      camposRetorno.dta_receita,
      camposRetorno.val_receita,
      camposRetorno.seq_veiculo,
      camposRetorno.cod_banco_financeira,
      camposRetorno.cod_tipo,
      camposRetorno.des_veiculo,
      camposRetorno.cod_cliente
    ]);

    const updateQuery = `UPDATE ${schema}.tab_veiculo
          SET ind_financiado = $1,
              cod_financeira = $2
          WHERE seq_veiculo = $3`;

    const values = [true, cod_banco_financeira, seq_veiculo]

    await client.query(updateQuery, values);
  }

  async function indConsorcioF(client, schema, val_consorcio, dados_consorcio, seq_veiculo, des_veiculo, cod_cliente) {

    console.log('consorcio')
    const dtaAtual = moment().format()

    const campos = {
      des_receita: `Aprovar Recebimento do ${des_veiculo} pelo Consórcio ${dados_consorcio}`,
      dta_receita: dtaAtual,
      val_receita: val_consorcio,
      seq_veiculo,
      cod_banco_financeira: 0,
      cod_tipo: 92, // Recebimento de Financiamentos
      des_veiculo,
      cod_cliente
    };

    const insertQuery1 = `
            INSERT INTO ${schema}.tab_conta_receber
            (des_receita, dta_receita, val_receita, seq_veiculo, cod_banco, cod_tipo, des_veiculo, cod_cliente)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;

    await client.query(insertQuery1, [
      campos.des_receita,
      campos.dta_receita,
      campos.val_receita,
      campos.seq_veiculo,
      campos.cod_banco_financeira,
      campos.cod_tipo,
      campos.des_veiculo,
      campos.cod_cliente
    ]);

    const insertQuery = `UPDATE ${schema}.tab_veiculo
                               SET val_consorcio = $1,
                                   dados_consorcio = $2
                               WHERE seq_veiculo = $3`;

    const values = [val_consorcio, dados_consorcio, seq_veiculo]


    await client.query(insertQuery, values);

  }

  async function entradaEspecieF(client, schema, val_entrada_especie, cod_banco_entrada, des_veiculo, seq_veiculo, ind_tipo_veiculo) {

    const dtaAtual = moment().format()

    const insertQuery = `
          INSERT INTO ${schema}.tab_movimentacao (
            tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
            ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
            des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
            cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
            parcela, seq_despesa, seq_fatura, ind_cartao_pago
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING seq_registro;
        `;

    const values = {
      tipo_movimento: 'E',
      dtaAtual, // Usa a data ajustada
      des_movimento: `Recebimento referente Entrada da venda do veiculo ${des_veiculo}`,
      ind_conciliado: false,
      dta_conciliado: null,
      ind_excluido: null,
      ind_alterado: false,
      seq_veiculo,
      des_origem: 'Venda de Veículos',
      cod_banco_entrada,
      des_movimento_detalhado: 'Entrada em PIX, Transferência ou Dinheiro',
      cod_cartao: 0,
      val_entrada_especie,
      descricao_mov_ofx: null,
      cod_banco_ofx: null,
      id_unico: null,
      cod_categoria_movimento: ind_tipo_veiculo === 'P' ? 95 : 94,
      des_categoria_movimento: ind_tipo_veiculo === 'P' ? 'Venda de Veículos Proprios' : 'Venda de Veiculos de Parceiros',
      numeroParcela: 0,
      seq_despesa: 0,
      seq_fatura: 0,
      ind_cartao_pago: false
    };

    await client.query(insertQuery, [
      values.tipo_movimento,
      values.dtaAtual,
      values.des_movimento,
      values.ind_conciliado,
      values.dta_conciliado,
      values.ind_excluido,
      values.ind_alterado,
      values.seq_veiculo,
      values.des_origem,
      values.cod_banco_entrada,
      values.des_movimento_detalhado,
      values.cod_cartao,
      values.val_entrada_especie,
      values.descricao_mov_ofx,
      values.cod_banco_ofx,
      values.id_unico,
      values.cod_categoria_movimento,
      values.des_categoria_movimento,
      values.numeroParcela,
      values.seq_despesa,
      values.seq_fatura,
      values.ind_cartao_pago
    ]
    );

    const updateQuery = `UPDATE ${schema}.tab_veiculo
                               SET val_entrada_especie = $1,
                                   cod_banco_entrada = $2
                               WHERE seq_veiculo = $3`;

    const valuesUpdate = [val_entrada_especie, cod_banco_entrada, seq_veiculo]

    await client.query(updateQuery, valuesUpdate);

  }

  async function entradaCartaoF(client, schema, val_entrada_cartao, cod_banco_entrada, des_veiculo, seq_veiculo, ind_tipo_veiculo) {

    const dtaAtual = moment().format()

    const insertQuery = `
          INSERT INTO ${schema}.tab_movimentacao (
            tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
            ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
            des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
            cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
            parcela, seq_despesa, seq_fatura, ind_cartao_pago
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING seq_registro;
        `;

    const values = {
      tipo_movimento: 'E',
      dataAtual: dtaAtual, // Usa a data ajustada
      des_movimento: `Recebimento referente Entrada em Cartão da venda do veiculo ${des_veiculo}`,
      ind_conciliado: false,
      dta_conciliado: null,
      ind_excluido: false,
      ind_alterado: false,
      seq_veiculo,
      des_origem: 'Venda de Veículos em Cartão',
      cod_banco_entrada,
      des_movimento_detalhado: 'Transação realizada no nosso terminal',
      cod_cartao: 0,
      val_entrada_cartao,
      descricao_mov_ofx: null,
      cod_banco_ofx: null,
      id_unico: null,
      cod_categoria_movimento: ind_tipo_veiculo === 'P' ? 95 : 94,
      des_categoria_movimento: ind_tipo_veiculo === 'P' ? 'Venda de Veículos Proprios' : 'Venda de Veiculos de Parceiros',
      numeroParcela: 0,
      seq_despesa: 0,
      seq_fatura: 0,
      ind_cartao_pago: false
    };

    await client.query(insertQuery, [
      values.tipo_movimento,
      values.dataAtual,
      values.des_movimento,
      values.ind_conciliado,
      values.dta_conciliado,
      values.ind_excluido,
      values.ind_alterado,
      values.seq_veiculo,
      values.des_origem,
      values.cod_banco_entrada,
      values.des_movimento_detalhado,
      values.cod_cartao,
      values.val_entrada_cartao,
      values.descricao_mov_ofx,
      values.cod_banco_ofx,
      values.id_unico,
      values.cod_categoria_movimento,
      values.des_categoria_movimento,
      values.numeroParcela,
      values.seq_despesa,
      values.seq_fatura,
      values.ind_cartao_pago
    ]
    );

    const updateQuery = `UPDATE ${schema}.tab_veiculo
                               SET val_entrada_cartao = $1,
                                   cod_banco_entrada = $2
                               WHERE seq_veiculo = $3`;

    const valuesUpdate = [val_entrada_cartao, cod_banco_entrada, seq_veiculo]

    await client.query(updateQuery, valuesUpdate);

  }
}

exports.buscaDadosEmpresa = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * from ${schema}.tab_empresa`;

        const values = []

        const result = await client.query(insertQuery, values);

        result.rows = result.rows.map(r => ({
          ...r,
          logo_empresa: r.logo_empresa ? r.logo_empresa.toString() : undefined
        }));

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.salvaDadosEmpresa = async (req, res) => {
  const { seq_registro, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, email_leads, site, whatsapp,
    observacoes, cep, endereco, numero, complemento, bairro, cidade, estado, logo_empresa } = req.body;

  console.log(req.body)

  const schema = req.headers['schema'];

  const dtaAtual = moment().format();

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        if (!seq_registro) {

          const insertQuery = `INSERT INTO ${schema}.tab_empresa
          (razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, email_leads, site, whatsapp,
           observacoes, cep, endereco, numero, complemento, bairro, cidade, estado, logo_empresa, dta_cadastro)
           VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;

          const values = [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, email_leads, site, whatsapp,
            observacoes, cep, endereco, numero, complemento, bairro, cidade, estado, logo_empresa, dtaAtual]

          const result = await client.query(insertQuery, values);

          return {
            rows: result.rows,
            rowCount: result.rowCount
          };
        } else {

          const updateQuery = `UPDATE ${schema}.tab_empresa
                              SET razao_social        = $1,
                                  nome_fantasia       = $2,
                                  cnpj                = $3,
                                  inscricao_estadual  = $4,
                                  inscricao_municipal = $5,
                                  telefone            = $6,
                                  email               = $7,
                                  email_leads         = $8,
                                  site                = $9,
                                  whatsapp            = $10,
                                  observacoes         = $11,
                                  cep                 = $12,
                                  endereco            = $13,
                                  numero              = $14,
                                  complemento         = $15,
                                  bairro              = $16,
                                  cidade              = $17,
                                  estado              = $18,
                                  logo_empresa        = $19,
                                  dta_alteracao       = $20
                              WHERE seq_registro      = $21;`;

          const values = [razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, telefone, email, email_leads, site, whatsapp,
            observacoes, cep, endereco, numero, complemento, bairro, cidade, estado, logo_empresa, dtaAtual, seq_registro]

          const result = await client.query(updateQuery, values);

          return {
            rows: result.rows,
            rowCount: result.rowCount
          };
        }
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaModeloContrato = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` SELECT * FROM ${schema}.tab_modelo_contrato `;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastroModeloContrato = async (req, res) => {

  const { des_contrato, tipo_contrato, clausulas_contrato, observacoes, ind_padrao = true } = req.body;

  console.log(req.body)

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` INSERT INTO ${schema}.tab_modelo_contrato
                              (des_contrato, tipo_contrato, clausulas_contrato, observacoes, ind_padrao)
                              VALUES
                              ($1, $2, $3, $4, $5)
                              RETURNING seq_registro`;

        const values = [des_contrato, tipo_contrato, clausulas_contrato, observacoes, true]

        const result = await client.query(insertQuery, values);

        const seq_registro = result.rows[0].seq_registro;

        const query = `UPDATE ${schema}.tab_modelo_contrato
                       SET ind_padrao = $1
                       WHERE seq_registro != $2`

        const values1 = [false, seq_registro]

        await client.query(query, values1);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.salvaModeloContrato = async (req, res) => {

  const { seq_registro, des_contrato, tipo_contrato, clausulas_contrato, observacoes, ind_padrao } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` UPDATE ${schema}.tab_modelo_contrato
                               SET des_contrato        = $1,
                                   tipo_contrato       = $2,
                                   clausulas_contrato  = $3,
                                   observacoes         = $4,
                                   ind_padrao          = $5
                             WHERE seq_registro = $6;`;

        const values = [des_contrato, tipo_contrato, clausulas_contrato, observacoes, ind_padrao, seq_registro]

        const updateQuery = `UPDATE ${schema}.tab_modelo_contrato
                               SET ind_padrao = false
                             WHERE seq_registro != $1;`

        const values1 = [seq_registro]

        const result = await client.query(insertQuery, values);

        await client.query(updateQuery, values1);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaFinanciamentos = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * from ${schema}.tab_conta_receber 
                             WHERE ind_pago = $1`;

        const values = [false]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.cadastraVendedor = async (req, res) => {
  const { nom_vendedor, val_comissao, val_fixo, dta_padrao_pagamento, tipo_pagamento } = req.body;



  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT into ${schema}.tab_vendedores
                            (nom_vendedor, val_comissao, val_fixo, dta_padrao_pagamento, tipo_pagamento)
                            VALUES
                            ($1, $2, $3, $4, $5)`;

        const values = [nom_vendedor, val_comissao, val_fixo, dta_padrao_pagamento, tipo_pagamento]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaVendedor = async (req, res) => {
  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = ` SELECT * from ${schema}.tab_vendedores`;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.salvaVendedor = async (req, res) => {
  const { seq_registro, val_comissao, val_fixo, dta_padrao_pagamento, tipo_pagamento, ind_ativo } = req.body;

  console.log(req.body)

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `UPDATE ${schema}.tab_vendedores
                             SET val_comissao = $1,
                                 val_fixo = $2,
                                 dta_padrao_pagamento = $3,
                                 tipo_pagamento = $4,
                                 ind_ativo = $5
                             WHERE seq_registro = $6`;

        const values = [val_comissao, val_fixo, dta_padrao_pagamento, tipo_pagamento, ind_ativo, seq_registro]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

// exports.desfazerVenda = async (req, res) => {
//   const { seq_veiculo } = req.body;

//   const schema = req.headers['schema'];

//   try {
//     const queryResult = await db.transaction(async (client) => {
//       try {
//         // Sua lógica de transação aqui

//         const insertQuery = ` `;

//         const values = []

//         const result = await client.query(insertQuery, values);

//         return {
//           rows: result.rows,
//           rowCount: result.rowCount
//         };
//         // Commit implícito se não houve erro
//       } catch (innerError) {
//         console.error('Erro na transação:', innerError);
//         throw innerError; // Força o rollback
//       }
//     });

//     // Se chegou aqui, a transação foi bem-sucedida
//     return res.status(200).json({
//       success: true,
//       message: 'Operação realizada com sucesso',
//       data: queryResult
//     });
//   } catch (error) {
//     console.error('Erro na operação:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Erro ao processar a requisição',
//       details: error.message,
//       errorDetails: error.stack
//     });
//   }
// }

exports.crlv = async (req, res) => {
  const { seq_veiculo } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const result = await getbase64Campo(client, schema, 'documento', seq_veiculo); //informando o campod a tabela

        console.log(result)

        return {
          rows: result,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.contrato = async (req, res) => {
  const { seq_veiculo } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const result = await getbase64Campo(client, schema, 'img_contrato', seq_veiculo); //informando o campod a tabela

        return {
          rows: result,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

async function getbase64Campo(client, schema, campo, seq_veiculo) {
  try {
    const selectQuery = `SELECT a.${campo} FROM ${schema}.tab_veiculo a WHERE a.seq_veiculo = $1`;
    const values = [seq_veiculo];
    const result = await client.query(selectQuery, values);

    if (result.rows.length === 0) {
      throw new Error('Veículo não encontrado');
    }

    console.log(result)

    const documento = result.rows[0][campo]

    console.log(documento)
    // Verificar o tipo do documento
    if (Buffer.isBuffer(documento)) {
      // Se é Buffer (bytea no PostgreSQL)
      const base64String = documento.toString();
      return base64String;
    } else if (typeof documento === 'string') {
      // Se já é string (texto base64)
      if (documento.startsWith('data:application/pdf;base64,')) {
        return documento; // Já está formatado
      } else {
        return `data:application/pdf;base64,${documento}`;
      }
    } else {
      throw new Error('Formato de documento não suportado');
    }

  } catch (error) {
    console.error('Erro ao recuperar documento:', error);
    throw error;
  }
}

exports.desfazerVenda = async (req, res) => {

  const { item } = req.body;

  const indConsorcio = item.val_consorcio !== null
  const indCartao = item.val_entrada_cartao !== null
  const indEntradaEspecie = item.val_entrada_especie !== null
  const indFinanciado = item.val_financiado !== null
  const indPrazo = item.valor_prazo !== null
  const indTroca = item.ind_troca !== null

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {

        //tratamento do veiculo aqui

        const queryVeiculo = `UPDATE ${schema}.tab_veiculo
        SET val_venda = null,
            ind_status = 'A',
            ind_troca = null,
            dta_venda = null,
            val_lucro = null,
            ind_retorno_vinculado = false,
            ind_financiado = false,
            cod_usuario_vinculado = 0,
            cod_vendedor = null,
            cod_banco = null,
            valor_venda_contrato = null,
            observacao_venda = null,
            img_contrato = null,
            quitacao = null,
            val_financiado = null,
            cod_banco_entrada = null,
            cod_financeira = null,
            des_veiculo_entrada = null,
            total_prazo = null,
            val_consorcio = null,
            val_entrada_cartao = null,
            val_entrada_especie = null,
            val_veiculo_entrada = null,
            valor_prazo = null
        WHERE seq_veiculo = $1`;

        const valuesVeiculo = [item.seq_veiculo]

        const insertQuery = `UPDATE ${schema}.tab_movimentacao
                                SET ind_excluido = true,
                                    des_observacao = 'Venda desfeita'
                                WHERE seq_veiculo = $1`;

        const values = [item.seq_veiculo]

        await client.query(queryVeiculo, valuesVeiculo);

        await client.query(insertQuery, values);

        if (indConsorcio) {

          const insertQuery = `
            UPDATE ${schema}.tab_conta_receber
            SET ind_excluido = true,
                motivo_exclusao = 'Venda desfeita '
            WHERE seq_veiculo = $1
          `;

          const values = [item.seq_veiculo]

          await client.query(insertQuery, values);
        }

        if (indCartao) {

          // const insertQuery = `UPDATE ${schema}.tab_movimentacao
          //                       SET ind_excluido = true,
          //                           des_observacao = 'Venda desfeita'
          //                       WHERE seq_veiculo = $1`;

          // const values = [item.seq_veiculo]

          // await client.query(insertQuery, values);

        }

        if (indEntradaEspecie) {

          // const insertQuery = `UPDATE ${schema}.tab_movimentacao
          // SET ind_excluido = true,
          //     des_observacao = 'Venda desfeita'
          // WHERE seq_veiculo = $1`;

          // const values = [item.seq_veiculo]

          // await client.query(insertQuery, values);

        }

        if (indFinanciado) {

          const insertQuery = `UPDATE ${schema}.tab_conta_receber
                                SET ind_excluido = true,
                                    motivo_exclusao = 'Venda desfeita'
                                WHERE seq_veiculo = $1
                                AND ind_pago = false`;

          const values = [item.seq_veiculo]

          await client.query(insertQuery, values);

        }

        if (indPrazo) {

          const updateQuery = `UPDATE ${schema}.tab_conta_receber
                                SET ind_excluido = true,
                                    des_observacao = 'Venda desfeita '
                                WHERE seq_veiculo = $1`;

          const values = [item.seq_veiculo]

          await client.query(updateQuery, values);

        }

        if (indTroca) {

          const insertQuery = `UPDATE ${schema}.tab_agenda
                                SET ind_cancelado = true,
                                    motivo_cancelamento = 'Venda desfeita'
                                WHERE seq_veiculo = $1`;

          const values = [item.seq_veiculo]

          const insertQuery1 = `UPDATE ${schema}.tab_veiculo
                                 SET ind_status = 'E',
                                     motivo_cancelamento = 'Venda desfeita'
                                 WHERE seq_veiculo_origem = $1`;

          const values1 = [item.seq_veiculo]

          await client.query(insertQuery, values);

          await client.query(insertQuery1, values1);
        }

        // return {
        //   rows: result.rows,
        //   rowCount: result.rowCount
        // };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.receberFinanciamento = async (req, res) => {

  const { seq_registro, cod_banco, des_receita, val_receita, seq_veiculo, cod_tipo } = req.body;

  const schema = req.headers['schema'];

  console.log(req.body)

  const dataAtual = moment().format()

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const uQuery = `UPDATE ${schema}.tab_conta_receber
                             SET ind_pago = $1,
                                 dta_recebimento = $2
                             WHERE seq_registro = $3`;

        const uValues = [true, dataAtual, seq_registro]

        const result = await client.query(uQuery, uValues);

        await entradaFinanciamento(client, schema, des_receita, val_receita, cod_banco, seq_veiculo, dataAtual, cod_tipo)

        async function entradaFinanciamento(client, schema, des_receita, val_receita, cod_banco, seq_veiculo, dtaAtual, cod_tipo) {

          const insertQuery = `
          INSERT INTO ${schema}.tab_movimentacao (
            tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
            ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
            des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
            cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
            parcela, seq_despesa, seq_fatura, ind_cartao_pago
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`;

          const values = {
            tipo_movimento: 'E',
            dtaAtual, // Usa a data ajustada
            des_movimento: cod_tipo === 93 ? 'Financiamento Creditado' : 'Retorno de Financiamento',
            ind_conciliado: false,
            dta_conciliado: null,
            ind_excluido: null,
            ind_alterado: false,
            seq_veiculo,
            des_origem: 'Venda de Veículos',
            cod_banco,
            des_movimento_detalhado: des_receita,
            cod_cartao: 0,
            val_movimento: val_receita,
            descricao_mov_ofx: null,
            cod_banco_ofx: null,
            id_unico: null,
            cod_categoria_movimento: cod_tipo,
            des_categoria_movimento: cod_tipo === 93 ? 'Financiamento Creditado' : 'Retorno de Financiamento',
            numeroParcela: 0,
            seq_despesa: 0,
            seq_fatura: 0,
            ind_cartao_pago: false,
          };

          await client.query(insertQuery, [
            values.tipo_movimento,
            values.dtaAtual,
            values.des_movimento,
            values.ind_conciliado,
            values.dta_conciliado,
            values.ind_excluido,
            values.ind_alterado,
            values.seq_veiculo,
            values.des_origem,
            values.cod_banco,
            values.des_movimento_detalhado,
            values.cod_cartao,
            values.val_movimento,
            values.descricao_mov_ofx,
            values.cod_banco_ofx,
            values.id_unico,
            values.cod_categoria_movimento,
            values.des_categoria_movimento,
            values.numeroParcela,
            values.seq_despesa,
            values.seq_fatura,
            values.ind_cartao_pago
          ]
          );

        }

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }

}

exports.registrarOperacaoParceiro = async (req, res) => {

  // 1. Validação dos headers e schema
  const schema = req.headers['schema'];
  if (!schema) {
    return res.status(400).json({
      success: false,
      message: 'Schema não especificado nos headers'
    });
  }

  // 2. Validação do corpo da requisição
  const { data, tipo } = req.body;
  if (!data) {
    return res.status(400).json({
      success: false,
      message: 'Dados não fornecidos no corpo da requisição'
    });
  }

  // 3. Validação dos campos obrigatórios
  // REMOVI cod_banco e des_banco da validação obrigatória pois podem ser opcionais dependendo do seu caso
  const requiredFields = ['des_movimento', 'dta_movimento', 'val_movimento', 'tipo_movimento', 'nom_parceiro'];
  const missingFields = [];

  requiredFields.forEach(field => {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Campos obrigatórios faltando',
      missingFields: missingFields
    });
  }

  // 4. Validação de tipos de dados
  if (typeof data.val_movimento !== 'number' || isNaN(data.val_movimento)) {
    return res.status(400).json({
      success: false,
      message: 'Valor da movimentação deve ser um número'
    });
  }

  if (!['C', 'D'].includes(data.tipo_movimento)) {
    return res.status(400).json({
      success: false,
      message: 'Tipo de movimentação inválido. Use "C" para crédito ou "D" para débito'
    });
  }

  // 5. Validação da data
  const dataMovimento = new Date(data.dta_movimento);
  if (isNaN(dataMovimento.getTime())) {
    return res.status(400).json({
      success: false,
      message: 'Data da movimentação inválida'
    });
  }

  // 6. Sanitização de valores monetários
  const valorMovimento = parseFloat(data.val_movimento.toFixed(2));

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // 7. Se tiver cod_parceiro, buscar nome do parceiro
        let nomeParceiro = data.nom_parceiro;

        if (data.cod_parceiro && !nomeParceiro) {
          const parceiroQuery = `SELECT nom_parceiro FROM ${schema}.tab_parceiros WHERE seq_registro = $1`;
          const parceiroResult = await client.query(parceiroQuery, [data.cod_parceiro]);

          if (parceiroResult.rows.length > 0) {
            nomeParceiro = parceiroResult.rows[0].nom_parceiro;
          } else {
            nomeParceiro = 'Parceiro Desconhecido';
          }
        } else if (!nomeParceiro) {
          nomeParceiro = 'Todos Parceiros';
        }

        // 8. Query de inserção com validação adicional
        const insertQuery = `
          INSERT INTO ${schema}.tab_conta_parceiro (
            cod_parceiro, 
            nom_parceiro, 
            des_movimento, 
            dta_movimento, 
            val_movimento, 
            tipo_movimento, 
            observacao,
            cod_banco,
            des_banco
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING seq_registro, cod_parceiro, nom_parceiro, des_movimento, 
                    dta_movimento, val_movimento, tipo_movimento, observacao, cod_banco, des_banco
        `;

        const values = [
          data.cod_parceiro || null,
          nomeParceiro,
          data.des_movimento.trim(),
          data.dta_movimento,
          valorMovimento,
          data.tipo_movimento,
          data.observacao ? data.observacao.trim() : null,
          data.cod_banco || null, // Se for opcional
          data.des_banco || null   // Se for opcional
        ];

        const result = await client.query(insertQuery, values);

        // 8.1 - INSERT NA TAB_MOVIMENTACAO DE ACORDO COM O TIPO DE MOVIMENTO

        let resultMov = null

        if(tipo === 'N'){  //N de normal, processo normal de inclusao pela propria tela e I de importaçao ofx

        const insertQueryMov = `
          INSERT INTO ${schema}.tab_movimentacao (
            tipo_movimento, dta_movimento, des_movimento, ind_conciliado, dta_conciliado,
            ind_excluido, ind_alterado, seq_veiculo, des_origem, cod_banco, 
            des_movimento_detalhado, cod_cartao, val_movimento, descricao_mov_ofx, 
            cod_banco_ofx, id_unico, cod_categoria_movimento, des_categoria_movimento, 
            parcela, seq_despesa, seq_fatura, ind_cartao_pago
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING seq_registro`;

        // CORREÇÃO: Os valores precisam ser passados como ARRAY
        const valuesMov = [
          data.tipo_movimento === 'C' ? 'E' : 'S', // 1. tipo_movimento
          data.dta_movimento, // 2. dta_movimento (não dtaAtual)
          data.tipo_movimento === 'C' ? 'Recebimento de Conta de Parceiros' : 'Pagamento de Conta de Parceiros', // 3. des_movimento
          false, // 4. ind_conciliado
          null, // 5. dta_conciliado
          null, // 6. ind_excluido
          false, // 7. ind_alterado
          0, // 8. seq_veiculo
          `Conta de Parceiros: ${nomeParceiro}`, // 9. des_origem
          data.cod_banco || null, // 10. cod_banco
          data.des_movimento.trim(), // 11. des_movimento_detalhado
          0, // 12. cod_cartao
          valorMovimento, // 13. val_movimento
          null, // 14. descricao_mov_ofx
          null, // 15. cod_banco_ofx
          null, // 16. id_unico
          data.tipo_movimento === 'C' ? 90 : 10, // 17. cod_categoria_movimento
          data.tipo_movimento === 'C' ? 'Recebimento de Conta de Parceiros' : 'Pagamento de Conta de Parceiros', // 18. des_categoria_movimento
          0, // 19. parcela
          0, // 20. seq_despesa
          0, // 21. seq_fatura
          false // 22. ind_cartao_pago
        ];

         resultMov = await client.query(insertQueryMov, valuesMov);
        }

        // 9. Se for uma transação de parceiro específico, atualizar saldo total
        if (data.cod_parceiro) {
          const saldoQuery = `
            SELECT COALESCE(SUM(val_movimento), 0) as saldo_total
            FROM ${schema}.tab_conta_parceiro 
            WHERE cod_parceiro = $1
          `;
          const saldoResult = await client.query(saldoQuery, [data.cod_parceiro]);

          return {
            registro_conta_parceiro: result.rows[0],
            registro_movimentacao: resultMov?.rows[0] || 0,
            saldo_atual: parseFloat(saldoResult.rows[0].saldo_total)
          };
        }

        return {
          registro_conta_parceiro: result.rows[0],
          registro_movimentacao: resultMov.rows[0]
        };

      } catch (innerError) {
        console.error('Erro na transação:', {
          error: innerError.message,
          stack: innerError.stack,
          data: data,
          schema: schema
        });
        throw innerError;
      }
    });

    // 10. Log de sucesso (opcional, para auditoria)
    console.log('Operação registrada com sucesso:', {
      schema: schema,
      parceiro: data.cod_parceiro || 'Todos',
      tipo: data.tipo_movimento,
      valor: valorMovimento,
      timestamp: new Date().toISOString()
    });

    // 11. Resposta formatada
    return res.status(201).json({
      success: true,
      message: data.tipo_movimento === 'C'
        ? 'Recebimento registrado com sucesso!'
        : 'Débito registrado com sucesso!',
      data: queryResult,
      metadata: {
        timestamp: new Date().toISOString(),
        valor_formatado: new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        }).format(valorMovimento),
        tipo_operacao: data.tipo_movimento === 'C' ? 'Crédito' : 'Débito'
      }
    });

  } catch (error) {
    console.error('Erro na operação:', {
      error: error.message,
      stack: error.stack,
      endpoint: 'registrarOperacaoParceiro',
      timestamp: new Date().toISOString()
    });

    // 12. Tratamento de erros específicos do PostgreSQL
    let errorMessage = 'Erro ao processar a requisição';
    let statusCode = 500;

    if (error.code === '23505') { // Violação de chave única
      errorMessage = 'Registro duplicado';
      statusCode = 409;
    } else if (error.code === '23503') { // Violação de chave estrangeira
      errorMessage = 'Parceiro não encontrado';
      statusCode = 404;
    } else if (error.code === '22003') { // Valor numérico fora do intervalo
      errorMessage = 'Valor fora do intervalo permitido';
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      details: error.message,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    });
  }
};

exports.buscaContaParceiro = async (req, res) => {

  // 1. Validação básica
  const schema = req.headers['schema'];
  if (!schema) {
    return res.status(400).json({
      success: false,
      message: 'Schema não especificado'
    });
  }

  // CORREÇÃO: Mudar de req.body para req.query para consistência
  const { cod_parceiro } = req.body;

  try {
    // 2. SE não tiver cod_parceiro -> Retorna lista de parceiros com saldo
    if (!cod_parceiro) {
      const query = `
        SELECT 
          p.seq_registro as cod_parceiro,
          p.nom_parceiro,
          COALESCE(SUM(cp.val_movimento), 0) as saldo_total,
          COUNT(cp.seq_registro) as total_movimentacoes
        FROM ${schema}.tab_parceiros p
        LEFT JOIN ${schema}.tab_conta_parceiro cp ON p.seq_registro = cp.cod_parceiro
        WHERE p.ind_status = true
        GROUP BY p.seq_registro, p.nom_parceiro
        ORDER BY p.nom_parceiro
      `;

      const result = await db.query(query);

      return res.status(200).json({
        success: true,
        message: 'Lista de parceiros com saldo carregada',
        data: {
          parceiros: result.rows.map(row => ({
            cod_parceiro: row.cod_parceiro,
            nom_parceiro: row.nom_parceiro,
            saldo_total: parseFloat(row.saldo_total),
            total_movimentacoes: parseInt(row.total_movimentacoes)
          }))
        }
      });
    }

    // 3. SE tiver cod_parceiro -> Retorna últimas 20 movimentações
    const query = `
      SELECT 
        seq_registro,
        cod_parceiro,
        nom_parceiro,
        des_movimento,
        dta_movimento,
        val_movimento,
        tipo_movimento,
        observacao,
        cod_banco,
        des_banco,
        CASE 
          WHEN tipo_movimento = 'C' THEN 'Crédito'
          ELSE 'Débito'
        END as tipo_descricao
      FROM ${schema}.tab_conta_parceiro
      WHERE cod_parceiro = $1
      ORDER BY dta_movimento DESC, seq_registro DESC
      LIMIT 20
    `;

    const result = await db.query(query, [cod_parceiro]);

    // 4. Buscar também o saldo total
    const saldoQuery = `
      SELECT 
        COALESCE(SUM(val_movimento), 0) as saldo_total,
        COUNT(*) as total_movimentacoes
      FROM ${schema}.tab_conta_parceiro
      WHERE cod_parceiro = $1
    `;

    const saldoResult = await db.query(saldoQuery, [cod_parceiro]);

    return res.status(200).json({
      success: true,
      message: 'Histórico do parceiro carregado',
      data: {
        parceiro: {
          cod_parceiro: cod_parceiro,
          saldo_total: parseFloat(saldoResult.rows[0].saldo_total),
          total_movimentacoes: parseInt(saldoResult.rows[0].total_movimentacoes)
        },
        movimentacoes: result.rows.map(row => ({
          ...row,
          val_movimento: parseFloat(row.val_movimento),
          // CORREÇÃO: Formatação de data sem moment
          dta_formatada: new Date(row.dta_movimento).toLocaleDateString('pt-BR')
          // OU se preferir: dta_formatada: row.dta_movimento.split('T')[0].split('-').reverse().join('/')
        }))
      }
    });

  } catch (error) {
    console.error('Erro ao buscar conta parceiro:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar informações do parceiro',
      details: error.message
    });
  }
};

exports.cadastraDespesaFixa = async (req, res) => {

  const { data } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `INSERT INTO ${schema}.tab_despesa_fixas (des_despesa, val_despesa, dta_despesa, cod_tipo_despesa, des_tipo_despesa, ind_status)
                             VALUES
                             ($1, $2, $3, $4, $5, $6)`;

        const values = [data.des_despesa, data.val_despesa, data.dta_despesa, data.cod_tipo_despesa, data.des_tipo_despesa, data.ind_status]

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.buscaDespesasFixas = async (req, res) => {

  const { } = req.body;

  const schema = req.headers['schema'];

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui

        const insertQuery = `SELECT * FROM ${schema}.tab_despesa_fixas`;

        const values = []

        const result = await client.query(insertQuery, values);

        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}

exports.editaDespesaFixa = async (req, res) => {
  const { item, acao } = req.body;
  const schema = req.headers['schema'];

  console.log(item)

  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        if (acao === 'E') {
          // Verifica se o registro existe (opcional, mas recomendado)
          const checkQuery = `SELECT seq_registro FROM ${schema}.tab_despesa_fixas WHERE seq_registro = $1`;
          const checkResult = await client.query(checkQuery, [item.seq_registro]);
          
          if (checkResult.rowCount === 0) {
            throw new Error('Registro não encontrado para exclusão');
          }

          const deleteQuery = `DELETE FROM ${schema}.tab_despesa_fixas WHERE seq_registro = $1`;
          const result = await client.query(deleteQuery, [item.seq_registro]);

          return {
            rows: result.rows,
            rowCount: result.rowCount
          };

        } else if (acao === 'A') {
          // Verifica se o registro existe (opcional)
          const checkQuery = `SELECT seq_registro FROM ${schema}.tab_despesa_fixas WHERE seq_registro = $1`;
          const checkResult = await client.query(checkQuery, [item.seq_registro]);
          
          if (checkResult.rowCount === 0) {
            throw new Error('Registro não encontrado para atualização');
          }

          // CORREÇÃO AQUI: sintaxe correta do UPDATE
          const updateQuery = `
            UPDATE ${schema}.tab_despesa_fixas 
            SET des_despesa = $1, 
                val_despesa = $2, 
                dta_despesa = $3 
            WHERE seq_registro = $4
          `;
          
          const valuesUpdate = [
            item.des_despesa, 
            item.val_despesa, 
            item.dta_despesa, 
            item.seq_registro
          ];

          const result = await client.query(updateQuery, valuesUpdate);

          return {
            rows: result.rows,
            rowCount: result.rowCount
          };

        } else {
          throw new Error('Ação inválida. Use "E" para excluir ou "A" para atualizar');
        }
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message
      // Não exponha o stack em produção: errorDetails: error.stack
    });
  }
};

exports.updateMovimentoFinanceiro = async (req, res) =>{

  const { movimento } = req.body;
  
  const schema = req.headers['schema'];
  
  try {
    const queryResult = await db.transaction(async (client) => {
      try {
        // Sua lógica de transação aqui
        
        const insertQuery = `UPDATE ${schema}.tab_movimentacao 
                             SET COD_CATEGORIA_MOVIMENTO = $1,
                                 des_categoria_movimento = $2,
                                 ind_conciliado = $3,
                                 dta_conciliado = $4
                             WHERE seq_registro = $5 `;
        
        const values =  [ movimento.cod_categoria_movimento, movimento.des_categoria_movimento, true, moment().format(), movimento.seq_registro ]
        
        const result = await client.query(insertQuery, values);
        
        return {
          rows: result.rows,
          rowCount: result.rowCount
        };
        // Commit implícito se não houve erro
      } catch (innerError) {
        console.error('Erro na transação:', innerError);
        throw innerError; // Força o rollback
      }
    });
    
    // Se chegou aqui, a transação foi bem-sucedida
    return res.status(200).json({
      success: true,
      message: 'Operação realizada com sucesso',
      data: queryResult
    });
  } catch (error) {
    console.error('Erro na operação:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar a requisição',
      details: error.message,
      errorDetails: error.stack
    });
  }
}