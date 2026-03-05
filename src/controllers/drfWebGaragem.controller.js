/* eslint-disable no-unused-vars */
/**
 * arquivo: config/database.js
 * descriçao: arquivo responsavel pela logica do CRUD (API)
 * data: 14/03/2022
 * autor: Renato Filho
 */

const db = require("../config/database");
require("dotenv-safe").config();
const moment = require("moment");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const { Console } = require("console");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");




//=> metodo responsavel por listar os usuarios por ID
exports.fazerLogin = async (req, res) => {
  let userBonus = null;

 const { nom_usuario, senha } = req.body;

  const schema = await db.queryGaragem(`select seq_usuario, nom_usuario, senha, telefone, ind_tipo, img_usuario, codigo_usuario, ranking, ind_elegivel, nome_completo, pix, cod_parceiro from tab_usuario
                                where nom_usuario = $1
                                and senha = $2`,[nom_usuario, senha]);
  console.log(schema.rowCount)

  if (schema.rowCount > 0) {

    if(schema.rows[0].ind_tipo == "C"){
      userBonus = await db.queryGaragem(`select 
                                  sum(val_movimento) as val_movimento 
                                  from tab_bonus_usuario 
                                  where seq_usuario = $1`, [schema.rows[0].seq_usuario]);
    }

    const id = (schema.rows[0].codigo_usuario * 100) / 5;

    const response = schema.rows.map(row => {
      const { seq_usuario, nom_usuario, telefone, ind_tipo, img_usuario, codigo_usuario, ranking, ind_elegivel, nome_completo, pix, cod_parceiro } = row;
      const base64Image = img_usuario !== null ? img_usuario.toString() : null;

      return {
        id: id,
        seq_usuario,
        nom_usuario, 
        telefone, 
        ind_tipo, 
        img_usuario: base64Image, 
        codigo_usuario,
        ranking,
        ind_elegivel,
        bonus: userBonus !== null? userBonus.rows[0].val_movimento :null,
        nome_completo,
        pix,
        cod_parceiro
      };
    });

    const token = jwt.sign({ id }, process.env.SECRET, {
      expiresIn: 6000, // 1h de prazo para expirar a sessao.
    });
    res.status(200).json({ auth: true, token: token, user: response });
    //Se existir usuario e senha, abre a sessão com um token.
  } else {
    res.status(500).json({
      message: "Usuário e Senha inválidos ou não existentes.",
    });
  }
};

exports.cadastroContaBanco = async (req, res) =>{
  const { des_conta, num_conta} = req.body;

  try {

    await db.queryGaragem(`insert into tab_conta_banco 
                                    (des_conta, num_conta) 
                                    values ( $1, $2)`,[des_conta, num_conta]);

    res.status(200).json({
      message: "Cadastro realizado com sucesso.",
    });             
    
  } catch (error) {
    res.status(500).json({
      message: "Erro ao cadastrar a conta bancaria" + error,
    }); 
  }
};

exports.listaContaBanco = async (req, res) =>{

  try {

    const result = await db.queryGaragem("select seq_conta, des_conta, num_conta, false as ind_selecionado, ind_cc_investidor, ind_tipo from tab_conta_banco");

    res.status(200).json({
      message: result.rows,
    });             
    
  } catch (error) {
    res.status(500).json({
      message: "Erro ao consultar conta bancaria" + error,
    }); 
  }
};

exports.cadastraVeiculo = async (req, res) =>{

  let { des_veiculo, valor_compra, observacao, data_compra, img_veiculo, des_origem, banco, ind_tipo_veiculo, 
    des_proprietario, val_venda_esperado, cod_parceiro, documento, nome_documento, renavam, placa, ano, des_veiculo_completa, 
    chassis, modelo, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor } = req.body;

  try {

    await db.queryGaragem(`
    INSERT INTO tab_veiculo (
      des_veiculo,
      val_compra,
      val_venda,
      observacoes,
      ind_status,
      dta_compra,
      dta_venda,
      ind_troca,
      seq_veiculo_origem,
      img_veiculo,
      ind_tipo_veiculo,
      des_proprietario,
      ind_retorno_vinculado,
      cod_usuario_vinculado,
      ind_ocorrencia_aberta,
      val_venda_esperado,
      cod_parceiro,
      documento, 
      nome_documento, renavam, placa, ano, des_veiculo_completa, chassis, modelo, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor
    ) VALUES (
      $1,
      $2,
      null,
      $3,
      'A',
      $4,
      null,
      null,
      null,
      $5,
      $6,
      $7,
      FALSE,
      0,
      FALSE,
      $8,
      $9,
      $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    )
  `, [des_veiculo, valor_compra, observacao, data_compra, img_veiculo, ind_tipo_veiculo, des_proprietario, 
      val_venda_esperado, cod_parceiro, documento, nome_documento, renavam, placa, ano, des_veiculo_completa, 
      chassis, modelo, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor]);

  if(ind_tipo_veiculo === 'P'){

    await db.queryGaragem(`insert into tab_movimentacao
    (
    ind_tipo,
    val_movimento,
    des_origem,
    ind_conciliado,
    data,
    tipo_movimento,
    seq_conta_banco
    )values(
    'S',
    $1,
    $2,
    'N',
    $3,
    'CV',
    $4
    )`,[valor_compra, des_origem, data_compra, banco]);  

  }

  if(ind_tipo_veiculo === 'I'){

    await db.queryGaragem(`insert into tab_movimentacao
    (
    ind_tipo,
    val_movimento,
    des_origem,
    ind_conciliado,
    data,
    tipo_movimento,
    seq_conta_banco,
    des_detalhes
    )values(
    'S',
    $1,
    $2,
    'N',
    $3,
    'CV',
    $4,
    'Compra com Investidor ${des_proprietario}'
    )`,[valor_investido_proprio, des_origem, data_compra, banco]);  

    
    await db.queryGaragem(`insert into tab_movimentacao_investidor
    (
    ind_tipo,
    val_movimento,
    des_origem,
    dta_movimento,
    tipo_movimento,
    cod_investidor
    )values(
    'S',
    $1,
    $2,
    $3,
    'CV',
    $4
    )`,[valor_investido_investidor, des_origem, data_compra, cod_parceiro]); 

  }
 
    res.status(200).json({
      message: "Cadastro realizado com sucesso.",
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em cadastrar o Veiculo:" + error
    });
  }



};

exports.cadastraDocumentoVeiculo = async (req, res) =>{

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

exports.lancarDespesa = async (req, res) =>{

  let { cod_despesa, des_despesa, val_despesa, observacao, cod_tipo_despesa, img_despesa, dta_despesa, des_origem, banco, tipo_movimento, prazo } = req.body;

  try {
    await db.queryGaragem("BEGIN");
    await db.queryGaragem(`insert into tab_despesa
                    (
                    des_despesa, 
                    val_despesa, 
                    observacao, 
                    ind_excluido,
                    cod_tipo_despesa,
                    img_despesa,
                    dta_despesa
                   )values(
                    $1,
                    $2,
                    $3,
                   'N',
                    $4,
                    $5,
                    $6
                    )`,[des_despesa, val_despesa, observacao, cod_tipo_despesa, img_despesa, dta_despesa]);


     await db.queryGaragem(`insert into tab_movimentacao
                    (
                      ind_tipo,
                      val_movimento,
                      des_origem,
                      ind_conciliado,
                      data,
                      tipo_movimento,
                      seq_conta_banco
                    )values(
                    'S',
                    $1,
                    $2,
                    'N',
                    $3,
                    $4,
                    $5
                    )`,[val_despesa, des_origem, dta_despesa, tipo_movimento, banco]); 


    if(prazo){
      await db.queryGaragem("update tab_despesas_fixas set prazo = prazo -1 where cod_despesa = $1",[cod_despesa])
    }

    await db.queryGaragem("COMMIT");

  res.status(200).json({
    message: "Despesa lançada com sucesso.",
  });
                    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em cadastrar o Veiculo:" + error
    });
  }

};

exports.tipoDespesa = async (req, res) =>{

  let { ind_tipo } = req.body;

  try {

    const result = await db.queryGaragem("select cod_tipo_despesa, des_tipo_despesa, tipo_movimento from tab_tipo_despesa where ind_tipo = $1",[ind_tipo]);
    
    res.status(200).json({
      message: result.rows
    });
  } catch (error) {
    
    res.status(500).json({
      message: "Falha em obter tipos de depesas:" + error
    });
  }
};

exports.tipoReceita = async (req, res) =>{


  console.log(req.body);
  let { ind_tipo } = req.body;

  try {

    const result = await db.queryGaragem("select cod_tipo_receita, des_tipo_receita, tipo_movimento from tab_tipo_receita where ind_tipo = $1",[ind_tipo]);
    
    res.status(200).json({
      message: result.rows
    });
  } catch (error) {
    
    res.status(500).json({
      message: "Falha em obter tipos de receitas:" + error
    });
  }
};

exports.criaReceitaReceber = async (req, res) =>{

  let { des_receita, val_receita, observacoes, cod_tipo_receita, dta_receita, des_origem, ind_gera_despesa, banco, tipo_movimento } = req.body;

  try {
    await db.queryGaragem(`insert into tab_receitas
    (
      des_receita, 
      val_receita, 
      observacoes,
      cod_tipo_receita,
      dta_receita,
      ind_status
    ) values (
      $1,
      $2,
      $3,
      $4,
      $5,
      'A'
    )`,[des_receita, val_receita, observacoes, cod_tipo_receita, dta_receita]);

    if(ind_gera_despesa === "S"){
      await db.queryGaragem(`insert into tab_movimentacao
      (
        ind_tipo,
        val_movimento,
        des_origem,
        ind_conciliado,
        data,
        tipo_movimento,
        seq_conta_banco
      )values(
      'S',
      $1,
      $2,
      'N',
      $3,
      $4,
      $5
      )`,[val_receita, des_origem, dta_receita, tipo_movimento, banco]);    
    }
    res.status(200).json({
      message: "Receita a receber inclusa com sucesso.",
      data: [{des_receita, val_receita, observacoes}]
    });

  } catch (error) {
    res.status(500).json({
      message: "Falha os incluir receita:" + error
    });
  }

};

exports.listaReceitaReceber = async (req, res) =>{

  try {

    const result = await db.queryGaragem(`select 
                                  a.cod_receita, 
                                  a.des_receita, 
                                  a.val_receita, 
                                  a.observacoes, 
                                  a.ind_status,
                                  a.dta_receita,
                                  b.des_tipo_receita,
                                  b.cod_tipo_receita,
                                  b.tipo_movimento,
                                  a.seq_veiculo
                                  from tab_receitas a
                                  inner join tab_tipo_receita b on (a.cod_tipo_receita = b.cod_tipo_receita)
                                  where ind_status = 'A'
                                  order by a.cod_receita desc`);

    res.status(200).json({
      message: result.rows,
    });
    
  } catch (error) {
    
    res.status(500).json({
      message: "Falha em obter lista de despesas fixas:" + error
    });
  }

};

exports.listaDespesaFixa = async (req, res) =>{

  try {

    const result = await db.queryGaragem(`select 
                                  a.cod_despesa, 
                                  a.des_despesa, 
                                  a.val_despesa, 
                                  a.observacoes, 
                                  b.des_tipo_despesa,
                                  b.cod_tipo_despesa,
                                  b.tipo_movimento,
                                  a.prazo
                                  from tab_despesas_fixas a
                                  inner join tab_tipo_despesa b on (a.cod_tipo_despesa = b.cod_tipo_despesa)`);

    res.status(200).json({
      message: result.rows,
    });
    
  } catch (error) {
    
    res.status(500).json({
      message: "Falha em obter lista de despesas fixas:" + error
    });
  }

};

exports.criaDespesaFixa = async (req, res) =>{

  let { des_despesa, val_despesa, observacoes, cod_tipo_despesa } = req.body;

  try {
    
    await db.queryGaragem(`insert into tab_despesas_fixas 
    (
      des_despesa, 
      val_despesa, 
      observacoes,
      cod_tipo_despesa
    ) values (
      $1,
      $2,
      $3,
      $4
    )`,[des_despesa, val_despesa, observacoes, cod_tipo_despesa]);

    res.status(200).json({
      message: "Despesa fixa inclusa com sucesso.",
      data: [{des_despesa, val_despesa, observacoes}]
    });

  } catch (error) {
    res.status(500).json({
      message: "Falha em obter lista de despesas fixas:" + error
    });
  }

};

exports.deleteDespesaFixa = async (req, res) =>{

  let {cod_despesa} = req.body;

  try {

    await db.queryGaragem("delete from tab_despesas_fixas where cod_despesa = $1",[cod_despesa]);

    res.status(200).json({
      message: "Despesa fixa excluida com sucesso.",
    });
    
  } catch (error) {
    
    res.status(500).json({
      message: "Falha em excluir despesa fixa:" + error
    });

  }

};

exports.listaDespesasLancadas = async (req, res) => {

  let img = "";
  try {
    const queryGaragem = `
      SELECT   
        seq_despesa,
        des_despesa,
        val_despesa,
        observacao,
        ind_excluido,
        cod_tipo_despesa,
        img_despesa,
        dta_despesa
      FROM tab_despesa
      ORDER BY seq_despesa DESC
    `;

    const result = await db.queryGaragem(queryGaragem);

    const response = result.rows.map(row => {
      const { seq_despesa, des_despesa, val_despesa, observacao, ind_excluido, cod_tipo_despesa, img_despesa, dta_despesa } = row;
      const base64Image = img_despesa !== null ? img_despesa.toString() : null;

      return {
        seq_despesa,
        des_despesa,
        val_despesa,
        observacao,
        ind_excluido,
        cod_tipo_despesa,
        img_despesa: base64Image,
        dta_despesa
      };
    });

    res.status(200).json({
      message: response
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao buscar despesas: " + error
    });
  }
};

exports.getTotalDespesasFixas = async (req, res) =>{

  try {
    const result = await db.queryGaragem(`select 
                                    case 
                                    when sum(val_despesa) is null
                                    then CAST(0 as numeric)
                                    else sum(val_despesa)
                                    end as val_total_desp_fixa
                                    from tab_despesas_fixas`);

    res.status(200).json({
      message: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao buscar total de despesas fixas: " + error
    });
  }

};

exports.getTotalReceitaReceber = async (req, res) =>{

  try {
    const result = await db.queryGaragem(`select 
                                    case 
                                    when sum(val_receita) is null
                                    then CAST(0 as numeric)
                                    else sum(val_receita)
                                    end as val_total_receita_receber
                                    from tab_receitas where ind_status = 'A'`);

    res.status(200).json({
      message: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao buscar total de despesas fixas: " + error
    });
  }

};

exports.receitaRecebida = async (req, res) =>{

    let {cod_receita, val_receita, dta_receita, des_origem, banco, tipo_movimento, seq_veiculo} = req.body;

    try {

      await db.queryGaragem("BEGIN");

      await db.queryGaragem("update tab_receitas set ind_status = 'F' where cod_receita = $1",[cod_receita]);

      if(tipo_movimento === "EF"){ // emprestimos fornecidos converte para emprestimos recebidos nessa funcao
        tipo_movimento = "ER";
      }

      await db.queryGaragem(`insert into tab_movimentacao
      (
        ind_tipo,
        val_movimento,
        des_origem,
        ind_conciliado,
        data,
        tipo_movimento,
        seq_conta_banco,
        seq_veiculo
      )values(
      'E',
      $1,
      $2,
      'N',
      $3,
      $4,
      $5,
      $6
      )`,[val_receita, des_origem, dta_receita, tipo_movimento, banco, seq_veiculo]);  

      if(tipo_movimento === "RF"){ //retorno de financiamentos
        await db.queryGaragem(`insert into tab_lucro_retirada
                        (val_lucro, val_retirada, des_origem, seq_veiculo, data, ind_tipo)
                        values
                        ($1, 0, $2, $3, $4, 'RF')`,[val_receita, des_origem, seq_veiculo, dta_receita]);

        await db.queryGaragem("update tab_veiculo set ind_retorno_vinculado = TRUE where seq_veiculo = $1", [seq_veiculo]);
      }

      await db.queryGaragem("COMMIT");

      res.status(200).json({
        message: "Receita alterada para recebida"
      });
      
    } catch (error) {
      await db.queryGaragem("ROLLBACK");
      res.status(500).json({
        message: "Falha em alterar a receita para recebida"
      });
    }

};

exports.veiculosAbertos = async (req, res) =>{

  try {

    const result = await db.queryGaragem(`select 
                                    seq_veiculo, 
                                    des_veiculo, 
                                    val_compra, 
                                    val_venda, 
                                    observacoes, 
                                    dta_compra, 
                                    ind_troca, 
                                    seq_veiculo_origem, 
                                    img_veiculo,
                                    ind_tipo_veiculo,
                                    des_proprietario,
                                    cod_usuario_vinculado,
                                    val_venda_esperado,
                                    km, ano, des_veiculo_completa, ind_publicado, documento, nome_documento, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor, 
                                    id_integracao, img_veiculo_1, img_veiculo_2, img_veiculo_3, img_veiculo_4, img_veiculo_5, img_veiculo_6, status
                                    from tab_veiculo
                                    where ind_status = 'A'
                                    order by dta_compra desc`);

      const response =  result.rows.map(row => {
        const { seq_veiculo, des_veiculo, val_compra, val_venda, observacoes, dta_compra, ind_troca, 
          seq_veiculo_origem, img_veiculo, ind_tipo_veiculo, des_proprietario, cod_usuario_vinculado, 
          val_venda_esperado, km, ano, des_veiculo_completa, ind_publicado, documento, nome_documento, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor,
          id_integracao, img_veiculo_1, img_veiculo_2, img_veiculo_3, img_veiculo_4, img_veiculo_5, img_veiculo_6, status } = row;
        const base64Image = img_veiculo !== null ? img_veiculo.toString() : null;
        const base64Documento = documento !== null ? documento.toString() : null;
        const cadastrar_veiculo_autoscar = false

        const img1 = img_veiculo_1 !== null ? img_veiculo_1.toString() : null
        const img2 = img_veiculo_2 !== null ? img_veiculo_2.toString() : null
        const img3 = img_veiculo_3 !== null ? img_veiculo_3.toString() : null
        const img4 = img_veiculo_4 !== null ? img_veiculo_4.toString() : null
        const img5 = img_veiculo_5 !== null ? img_veiculo_5.toString() : null
        const img6 = img_veiculo_6 !== null ? img_veiculo_6.toString() : null

        const fotos = []; // Declara fotos como um array vazio

        fotos.push(img1);
        fotos.push(img2);
        fotos.push(img3);
        fotos.push(img4);
        fotos.push(img5);
        fotos.push(img6);
        
        return {
          seq_veiculo, 
          des_veiculo, 
          val_compra, 
          val_venda,
          observacoes, 
          dta_compra, 
          ind_troca, 
          seq_veiculo_origem, 
          img_veiculo: base64Image,
          ind_tipo_veiculo,
          des_proprietario,
          cod_usuario_vinculado,
          val_venda_esperado,
          km, ano, des_veiculo_completa,
          ind_publicado,
          documento: base64Documento,
          nome_documento,
          valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor,
          cadastrar_veiculo_autoscar : cadastrar_veiculo_autoscar,
          id_integracao,
          fotos,
          status
        };
      });

    res.status(200).json({
      message: response
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lista de veiculos para venda"
    });
  }

};

exports.veiculosAbertosParceiro = async (req, res) =>{

  const { cod_parceiro } = req.body;

  try {

    const result = await db.queryGaragem(`select 
                                    seq_veiculo, 
                                    des_veiculo, 
                                    val_compra, 
                                    val_venda, 
                                    observacoes, 
                                    dta_compra, 
                                    ind_troca, 
                                    seq_veiculo_origem, 
                                    img_veiculo,
                                    ind_tipo_veiculo,
                                    des_proprietario,
                                    cod_usuario_vinculado,
                                    val_venda_esperado,
                                    km, ano, des_veiculo_completa, ind_publicado, documento, nome_documento, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor
                                    from tab_veiculo
                                    where ind_status = 'A'
                                    and ind_tipo_veiculo = 'T'
                                    and cod_parceiro = $1
                                    order by dta_compra desc`,[cod_parceiro]);

      const response =  result.rows.map(row => {
        const { seq_veiculo, des_veiculo, val_compra, val_venda, observacoes, dta_compra, ind_troca, 
          seq_veiculo_origem, img_veiculo, ind_tipo_veiculo, des_proprietario, cod_usuario_vinculado, 
          val_venda_esperado, km, ano, des_veiculo_completa, ind_publicado, documento, nome_documento, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor} = row;
        const base64Image = img_veiculo !== null ? img_veiculo.toString() : null;
        const base64Documento = documento !== null ? documento.toString() : null;
        
        return {
          seq_veiculo, 
          des_veiculo, 
          val_compra, 
          val_venda,
          observacoes, 
          dta_compra, 
          ind_troca, 
          seq_veiculo_origem, 
          img_veiculo: base64Image,
          ind_tipo_veiculo,
          des_proprietario,
          cod_usuario_vinculado,
          val_venda_esperado,
          km, ano, des_veiculo_completa,
          ind_publicado,
          documento: base64Documento,
          nome_documento, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor
        };
      });

    res.status(200).json({
      message: response
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lista de veiculos para venda"
    });
  }

};


exports.lancaDespesaVeiculo = async (req, res) =>{

  const { seq_veiculo, des_despesa, val_despesa, ind_status, dta_despesa, observacao, cod_tipo_despesa, img_despesa, des_origem, banco, ind_tipo } = req.body;

  try {

    await db.queryGaragem(`insert into tab_despesa_veiculo (
                      seq_veiculo,
                      des_despesa,
                      val_despesa,
                      ind_status,
                      dta_despesa,
                      observacao,
                      cod_tipo_despesa,
                      img_despesa,
                      ind_tipo
                    ) values (
                      $1,
                      $2,
                      $3,
                      $4,
                      $5,
                      $6,
                      $7,
                      $8,
                      $9
                    )
                    `,[seq_veiculo, des_despesa, val_despesa, ind_status, dta_despesa, observacao, cod_tipo_despesa, img_despesa, ind_tipo]);

                    
      await db.queryGaragem(`insert into tab_movimentacao
      (
      ind_tipo,
      val_movimento,
      des_origem,
      ind_conciliado,
      data,
      tipo_movimento,
      seq_conta_banco,
      des_detalhes,
      seq_veiculo
      )values(
      'S',
      $1,
      $2,
      'N',
      $3,
      'DV',
      $4,
      $5,
      $6
      )`,[val_despesa, des_origem, dta_despesa, banco, des_despesa, seq_veiculo]);  

      res.status(200).json({
        message: "Despesa registrada com sucesso"
      });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em incluir despesa no veiculo"
    });
  }

};

exports.lancaDespesaVeiculoParceiro = async (req, res) =>{

  const { seq_veiculo, des_despesa, val_despesa, ind_status, dta_despesa, observacao, cod_tipo_despesa, img_despesa, des_origem, banco } = req.body;

  try {

    await db.queryGaragem(`insert into tab_despesa_veiculo_parceiro (
                      seq_veiculo,
                      des_despesa,
                      val_despesa,
                      ind_status,
                      dta_despesa,
                      observacao,
                      cod_tipo_despesa,
                      img_despesa
                    ) values (
                      $1,
                      $2,
                      $3,
                      $4,
                      $5,
                      $6,
                      $7,
                      $8
                    )
                    `,[seq_veiculo, des_despesa, val_despesa, ind_status, dta_despesa, observacao, cod_tipo_despesa, img_despesa]);

      res.status(200).json({
        message: "Despesa registrada com sucesso"
      });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em incluir despesa no veiculo"
    });
  }

};

exports.listaDespesaVeiculo = async (req, res) =>{

  const { seq_veiculo } = req.body; 

  try {

    const result = await db.queryGaragem(`select   
                                    a.seq_despesa,
                                    a.seq_veiculo,
                                    a.des_despesa,
                                    a.val_despesa,
                                    a.ind_status,
                                    a.dta_despesa,
                                    a.observacao,
                                    a.cod_tipo_despesa,
                                    b.des_tipo_despesa,
                                    a.img_despesa,
                                    a.ind_tipo
                                    from tab_despesa_veiculo a
                                    inner join tab_tipo_despesa b on (a.cod_tipo_despesa = b.cod_tipo_despesa)
                                    where seq_veiculo = $1`,[seq_veiculo]);

    res.status(200).json({
      message: result.rows
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em obter lista de despesas do veiculo"
    });
  }

};

exports.listaDespesasVeiculoParceiro = async (req, res) =>{

  const { seq_veiculo } = req.body; 

  try {

    const result = await db.queryGaragem(`select   
                                    a.seq_despesa,
                                    a.seq_veiculo,
                                    a.des_despesa,
                                    a.val_despesa,
                                    a.ind_status,
                                    a.dta_despesa,
                                    a.observacao,
                                    a.cod_tipo_despesa,
                                    b.des_tipo_despesa,
                                    a.img_despesa 
                                    from tab_despesa_veiculo_parceiro a
                                    inner join tab_tipo_despesa b on (a.cod_tipo_despesa = b.cod_tipo_despesa)
                                    where seq_veiculo = $1`,[seq_veiculo]);

    res.status(200).json({
      message: result.rows
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em obter lista de despesas do veiculo"
    });
  }

};

exports.finalizaVendaVeiculo = async (req, res) =>{

  const { dados } = req.body;

  const veiculoRecebido = dados[0].veiculoRecebido;
  const data = dados[0].data;
  const veiculoVendido = dados[0].veiculoVendido;
  const pagamentoBanco = dados[0].pagamentoBanco;
  const pagamentoEspecie = dados[0].pagamentoEspecie;
  const des_origem = dados[0].des_origem;
  const volta = dados[0].volta;
  const banco = dados[0].banco;
  const lucro = dados[0].lucro;
  const quitacao = dados[0].quitacao
  const val_financiado = dados[0].val_financiado
  const comissaoLoja = dados[0].comissaoLoja

  try {

    await db.queryGaragem("BEGIN");

    if(veiculoRecebido.length == 0){ //sem veiculo na troca

      await db.queryGaragem(`update tab_veiculo
      set val_venda = $1,
          dta_venda = $2,
          ind_status = 'V',
          val_lucro = $3,
          ind_troca = 'N',
          ind_financiado = $4,
          cod_usuario_vinculado = 0,
          origem_venda = $5,
          cod_vendedor = $6,
          quitacao = $7,
          val_financiado = $8
      where seq_veiculo = $9`,[veiculoVendido.val_venda, data, lucro, veiculoVendido.ind_financiado, veiculoVendido.origem_venda, veiculoVendido.cod_vendedor, quitacao, val_financiado, veiculoVendido.seq_veiculo, ]);

      if(veiculoVendido.ind_financiado === true){
        await db.queryGaragem(`insert into tab_receitas 
        (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita)
        values
        ($1, 'Retorno ${veiculoVendido.des_veiculo}', 3, 'A', $2)`,[veiculoVendido.seq_veiculo, data])
      }

    }else{ // com veiculo na troca
      for (const row of veiculoRecebido) {
        await db.queryGaragem(`
          INSERT INTO tab_veiculo (
            des_veiculo,
            val_compra,
            val_venda,
            observacoes,
            ind_status,
            dta_compra,
            dta_venda,
            ind_troca,
            seq_veiculo_origem,
            img_veiculo,
            ind_retorno_vinculado,
            ind_tipo_veiculo,
            ind_ocorrencia_aberta,
            ind_financiado
          ) VALUES (
            $1,
            $2,
            null,
            $3,
            'A',
            $4,
            null,
            'S',
            $5,
            $6,
            FALSE,
            'P',
            FALSE,
            FALSE
          )
        `, [row.des_veiculo, row.val_compra, row.observacoes, data, veiculoVendido.seq_veiculo, row.img_veiculo]);
      }

      await db.queryGaragem(`update tab_veiculo
      set val_venda = $1,
          dta_venda = $2,
          ind_status = 'V',
          val_lucro = $3,
          ind_troca = 'S',
          ind_financiado = $4,
          cod_usuario_vinculado = 0
      where seq_veiculo = $5`,[veiculoVendido.val_venda, data, lucro, veiculoVendido.ind_financiado, veiculoVendido.seq_veiculo]);

      if(veiculoVendido.ind_financiado === true){
        await db.queryGaragem(`insert into tab_receitas 
        (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita)
        values
        ($1, 'Retorno ${veiculoVendido.des_veiculo}', 3, 'A', $2)`,[veiculoVendido.seq_veiculo, data])
      }
    }

    if(pagamentoBanco > 0){  // contendo valor de recebimento
      await db.queryGaragem(`insert into tab_movimentacao
      (
        ind_tipo,
        val_movimento,
        des_origem,
        ind_conciliado,
        data,
        tipo_movimento,
        seq_conta_banco,
        seq_veiculo
      )values(
      'E',
      $1,
      $2,
      'N',
      $3,
      'VV',
      $4,
      $5
      )`,[pagamentoBanco, des_origem, data, banco, veiculoVendido.seq_veiculo]);
    }

    if(pagamentoEspecie > 0 || pagamentoEspecie !== null){  // contendo valor de recebimento

      await db.queryGaragem(`insert into tab_movimento_especie
      (
        val_movimento,
        dta_movimento,
        ind_depositado,
        seq_veiculo
      )values(
        $1,
        $2,
        'N',
        $3
      )`,[pagamentoEspecie, data, veiculoVendido.seq_veiculo]);
    }
    
    if(volta > 0){ // contendo valor a ser voltado ao cliente
      await db.queryGaragem(`insert into tab_movimentacao
      (
      ind_tipo,
      val_movimento,
      des_origem,
      ind_conciliado,
      data,
      tipo_movimento,
      seq_conta_banco,
      seq_veiculo
      )values(
      'S',
      $1,
      'Volta para cliente',
      'N',
      $2,
      'VO',
      $3,
      $4
      )`,[volta, data, banco, veiculoVendido.seq_veiculo]);
    }

    if(veiculoVendido.comissao > 0){ // contendo comissao sobre a venda
      await db.queryGaragem(`insert into tab_movimentacao
      (
      ind_tipo,
      val_movimento,
      des_origem,
      ind_conciliado,
      data,
      tipo_movimento,
      seq_conta_banco,
      seq_veiculo
      )values(
      'S',
      $1,
      'Comissao ${des_origem}',
      'N',
      $2,
      'CO',
      $3,
      $4
      )`,[veiculoVendido.comissao, data, banco, veiculoVendido.seq_veiculo]);

    }

    if(veiculoVendido.ind_tipo_veiculo == 'I'){
      await db.queryGaragem(`insert into tab_movimentacao
        (
        ind_tipo,
        val_movimento,
        des_origem,
        ind_conciliado,
        data,
        tipo_movimento,
        seq_conta_banco,
        seq_veiculo
        )values(
        'E',
        $1,
        'Comissao Loja ${des_veiculo} ${des_proprietario}',
        'N',
        $2,
        'CL',
        $3,
        $4
        )`,[comissaoLoja, data, banco, seq_veiculo]);
    }

    await db.queryGaragem(`insert into tab_lucro_retirada
                    (val_lucro, val_retirada, des_origem, seq_veiculo, data, ind_tipo)
                    values
                    ($1, 0, $2, $3, $4, 'VV')`,[lucro, des_origem, veiculoVendido.seq_veiculo, data]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Processo de venda efetuado com sucesso."
    });
    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em realizar finalização do veiculo, tente novamente."
    });
  }
};

exports.finalizaVendaVeiculoParceiro = async (req, res) =>{
 
  const { dados, des_proprietario, cod_parceiro } = req.body;

  const veiculoRecebido = dados[0].veiculoRecebido;
  const data = dados[0].data;
  const veiculoVendido = dados[0].veiculoVendido;
  const des_origem = dados[0].des_origem;
  const lucro = dados[0].lucro;

  try {

    await db.queryGaragem("BEGIN");

    if(veiculoRecebido.length == 0){ //sem veiculo na troca

      await db.queryGaragem(`update tab_veiculo
      set val_venda = $1,
          dta_venda = $2,
          ind_status = 'V',
          val_lucro = $3,
          ind_troca = 'N',
          ind_financiado = $4,
          cod_usuario_vinculado = 0,
          origem_venda = $5,
          cod_vendedor = $6
      where seq_veiculo = $7`,[veiculoVendido.val_venda, data, lucro, veiculoVendido.ind_financiado, veiculoVendido.origem_venda, veiculoVendido.cod_vendedor, veiculoVendido.seq_veiculo, ]);

      if(veiculoVendido.ind_financiado === true){
        await db.queryGaragem(`insert into tab_receitas 
        (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita)
        values
        ($1, 'Retorno ${veiculoVendido.des_veiculo}', 3, 'A', $2)`,[veiculoVendido.seq_veiculo, data])
      }

    }else{ // com veiculo na troca
      for (const row of veiculoRecebido) {
        await db.queryGaragem(`
          INSERT INTO tab_veiculo (
            des_veiculo,
            val_compra,
            val_venda,
            observacoes,
            ind_status,
            dta_compra,
            dta_venda,
            ind_troca,
            seq_veiculo_origem,
            img_veiculo,
            ind_retorno_vinculado,
            ind_tipo_veiculo,
            des_proprietario,
            cod_parceiro
          ) VALUES (
            $1,
            $2,
            null,
            $3,
            'A',
            $4,
            null,
            'S',
            $5,
            $6,
            FALSE,
            TRUE,
            $7,
            $8
          )
        `, [row.des_veiculo, row.val_compra, row.observacoes, data, veiculoVendido.seq_veiculo, row.img_veiculo, des_proprietario, cod_parceiro]);
      }

      await db.queryGaragem(`update tab_veiculo
      set val_venda = $1,
          dta_venda = $2,
          ind_status = 'V',
          val_lucro = $3,
          ind_troca = 'S',
          ind_financiado = $4,
          cod_usuario_vinculado = 0
      where seq_veiculo = $5`,[veiculoVendido.val_venda, data, lucro, veiculoVendido.ind_financiado, veiculoVendido.seq_veiculo]);

      if(veiculoVendido.ind_financiado === true){
        await db.queryGaragem(`insert into tab_receitas 
        (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita)
        values
        ($1, 'Retorno ${veiculoVendido.des_veiculo}', 3, 'A', $2)`,[veiculoVendido.seq_veiculo, data])
      }
    }

    if(veiculoVendido.comissao > 0){ // contendo comissao sobre a venda
      await db.queryGaragem(`insert into tab_receitas 
      (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita, val_receita)
      values
      ($1, 'Comissao Venda ${veiculoVendido.des_veiculo}', 4, 'A', $2, $3)`,[veiculoVendido.seq_veiculo, data, veiculoVendido.comissao])

    }

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Processo de venda efetuado com sucesso."
    });
    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em realizar finalização do veiculo, tente novamente."
    });
  }
};

exports.listaMovimentacao = async (req, res) =>{

  const { banco } = req.body;

  try {

    if(banco === "Todas"){
      const result = await db.queryGaragem(`select 
      seq_movimentacao,
      ind_tipo,
      val_movimento,
      des_origem,
      ind_conciliado,
      data,
      tipo_movimento,
      seq_conta_banco,
      seq_veiculo ,
      dta_conciliacao,
      des_detalhes
      from tab_movimentacao 
      where seq_conta_banco in (2,3,6,7)
      and data <= 'today'
                                      order by data desc, seq_movimentacao  limit 30`);

      const saida = await db.queryGaragem(`select       
                                            case when sum(a.val_movimento) is null 
                                            then 0
                                            else cast(sum(a.val_movimento) as numeric)
                                            end as val_saida from tab_movimentacao a
                                            where a.ind_tipo = 'S'
                                            and data <= 'today'
                                            and seq_conta_banco in (2,3,6,7)`);
          
      const entrada = await db.queryGaragem(`select       
                                            case when sum(a.val_movimento) is null 
                                            then 0
                                            else cast(sum(a.val_movimento) as numeric)
                                            end as val_entrada from tab_movimentacao a
                                            where a.ind_tipo = 'E'
                                            and data <= 'today'
                                            and seq_conta_banco in (2,3,6,7)`);

      res.status(200).json({
        message: result.rows,
        saida: saida.rows,
        entrada: entrada.rows
      });

    }else{
      const result = await db.queryGaragem(`select  a.seq_movimentacao,
                                                    a.ind_tipo,
                                                    a.val_movimento,
                                                    a.des_origem,
                                                    a.ind_conciliado,
                                                    a.data,
                                                    a.tipo_movimento,
                                                    a.seq_conta_banco,
                                                    a.seq_veiculo ,
                                                    a.des_detalhes,
                                                    a.dta_conciliacao from tab_movimentacao a
                                      where a.seq_conta_banco = $1 
                                      and data <= 'today'
                                      order by a.data desc, a.seq_movimentacao   limit 30`,[banco]);

      const saida = await db.queryGaragem(`select case when sum(a.val_movimento) is null 
                                      then 0
                                      else cast(sum(a.val_movimento) as numeric)
                                      end as val_saida from tab_movimentacao a
                                      where a.seq_conta_banco = $1 
                                      and data <= 'today'
                                      and a.ind_tipo = 'S'`,[banco]);

      const entrada = await db.queryGaragem(`select case when sum(a.val_movimento) is null 
                                        then 0
                                        else cast(sum(a.val_movimento) as numeric)
                                        end as val_entrada from tab_movimentacao a
                                        where a.seq_conta_banco = $1 
                                        and data <= 'today'
                                        and a.ind_tipo = 'E'`,[banco]);

      res.status(200).json({
        message: result.rows,
        saida: saida.rows,
        entrada: entrada.rows
      });
    }

  } catch (error) {
        res.status(500).json({
      message: "Falha em obter movimentos, tente novamente."
    });
  }

};

exports.conciliaMov = async (req, res) =>{

  const { seq_movimentacao, dta_conciliacao } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_movimentacao set ind_conciliado = 'S', dta_conciliacao = $2 where seq_movimentacao = $1 ",[seq_movimentacao, dta_conciliacao]);

    await db.queryGaragem("COMMIT");
    res.status(200).json({
      message: "Movimento Conciliado."
    });
    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em realizar finalização do veiculo, tente novamente."
    });
  }
};

exports.veiculosVendidos = async (req, res) =>{

  const { registros } = req.body;

  try {

    const result = await db.queryGaragem(`select 
                                    a.seq_veiculo, 
                                    a.des_veiculo, 
                                    a.val_compra, 
                                    a.val_venda, 
                                    a.val_lucro,
                                    a.observacoes, 
                                    a.dta_compra, 
                                    a.ind_troca, 
                                    a.dta_venda,
                                    a.seq_veiculo_origem, 
                                    a.img_veiculo ,
                                    a.ind_tipo_veiculo,
                                    a.des_proprietario,
                                    a.ind_retorno_vinculado,
                                    a.ind_financiado,
                                    a.cod_usuario_vinculado,
                                    a.ind_ocorrencia_aberta,
                                    a.img_contrato,
                                    b.nome_completo,
                                    a.valor_investido_investidor, a.valor_investido_proprio, a.ind_veiculo_investidor
                                    from tab_veiculo a
                                    left join tab_usuario b on (a.cod_usuario_vinculado = b.seq_usuario)
                                    where a.ind_status = 'V'
                                    order by a.dta_venda desc limit ${registros}`);

      const response =  result.rows.map(row => {
        const { seq_veiculo, des_veiculo, val_compra, val_venda, observacoes, dta_compra, val_lucro, 
                dta_venda, ind_troca, seq_veiculo_origem, img_veiculo, ind_tipo_veiculo, des_proprietario, 
                ind_retorno_vinculado, ind_financiado, cod_usuario_vinculado, ind_ocorrencia_aberta, nome_completo, img_contrato, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor } = row;

        const base64Image = img_veiculo !== null ? img_veiculo.toString() : null;
        const base64ImageContrato = img_contrato !== null ? img_contrato.toString() : null;
        
        return {
          seq_veiculo, 
          des_veiculo, 
          val_compra, 
          val_venda,
          observacoes, 
          dta_compra, 
          dta_venda,
          val_lucro,
          ind_troca, 
          seq_veiculo_origem, 
          img_veiculo: base64Image,
          ind_tipo_veiculo,
          des_proprietario,
          ind_retorno_vinculado,
          ind_financiado,
          cod_usuario_vinculado,
          ind_ocorrencia_aberta,
          nome_completo,
          img_contrato: base64ImageContrato,
          valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor
        };
      });

    res.status(200).json({
      message: response
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lista de veiculos Vendidos"
    });
  }

};

exports.veiculosVendidosParceiro = async (req, res) =>{

  const { cod_parceiro } = req.body;

  try {

    const result = await db.queryGaragem(`select 
                                    a.seq_veiculo, 
                                    a.des_veiculo, 
                                    a.val_compra, 
                                    a.val_venda, 
                                    a.val_lucro,
                                    a.observacoes, 
                                    a.dta_compra, 
                                    a.ind_troca, 
                                    a.dta_venda,
                                    a.seq_veiculo_origem, 
                                    a.img_veiculo ,
                                    a.ind_tipo_veiculo,
                                    a.des_proprietario,
                                    a.ind_retorno_vinculado,
                                    a.ind_financiado,
                                    a.cod_usuario_vinculado,
                                    a.ind_ocorrencia_aberta,
                                    b.nome_completo,
                                    a.img_contrato,
                                    a.valor_investido_investidor, a.valor_investido_proprio, a.ind_veiculo_investidor
                                    from tab_veiculo a
                                    left join tab_usuario b on (a.cod_usuario_vinculado = b.seq_usuario)
                                    where a.ind_status = 'V'
                                    and a.cod_parceiro = $1
                                    order by a.dta_venda desc limit 20`,[cod_parceiro]);

      const response =  result.rows.map(row => {
        const { seq_veiculo, des_veiculo, val_compra, val_venda, observacoes, dta_compra, val_lucro, 
                dta_venda, ind_troca, seq_veiculo_origem, img_veiculo, ind_tipo_veiculo, des_proprietario, 
                ind_retorno_vinculado, ind_financiado, cod_usuario_vinculado, ind_ocorrencia_aberta, nome_completo, img_contrato, valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor } = row;

        const base64Image = img_veiculo !== null ? img_veiculo.toString() : null;
        const base64ImageContrato = img_contrato !== null ? img_contrato.toString() : null;
        
        return {
          seq_veiculo, 
          des_veiculo, 
          val_compra, 
          val_venda,
          observacoes, 
          dta_compra, 
          dta_venda,
          val_lucro,
          ind_troca, 
          seq_veiculo_origem, 
          img_veiculo: base64Image,
          ind_tipo_veiculo,
          des_proprietario,
          ind_retorno_vinculado,
          ind_financiado,
          cod_usuario_vinculado,
          ind_ocorrencia_aberta,
          nome_completo,
          img_contrato: base64ImageContrato,
          valor_investido_investidor, valor_investido_proprio, ind_veiculo_investidor
        };
      });

    res.status(200).json({
      message: response
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lista de veiculos Vendidos"
    });
  }

};

exports.desfazerVendaVeiculo = async (req, res) => {
  const { seq_veiculo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("DELETE FROM tab_movimentacao WHERE seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_lucro_retirada WHERE seq_veiculo = $1 and ind_tipo = 'VV'", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_veiculo WHERE seq_veiculo_origem = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_usuario_veiculo where seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_bonus_usuario where seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_movimento_especie where seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_ocorrencia_veiculo where seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("DELETE FROM tab_receitas where seq_veiculo = $1", [seq_veiculo]);
    await db.queryGaragem("UPDATE tab_veiculo SET val_venda = null, ind_status = 'A', dta_venda = null, ind_troca = 'N', ind_financiado = FALSE, val_lucro = null, ind_retorno_vinculado = FALSE, cod_usuario_vinculado = 0 WHERE seq_veiculo = $1", [seq_veiculo]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Venda Desfeita com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");

    res.status(500).json({
      message: "Falha em desfazer a venda, tente novamente: " + error
    });
  }
};

exports.transferenciaEntreContas = async (req, res) => {
  const { seq_conta_origem, seq_conta_destino, des_conta_origem, des_conta_destino, valor, data } = req.body;

  console.log(req.body);
  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`insert into tab_movimentacao 
                      ( 
                        ind_tipo, 
                        val_movimento, 
                        des_origem, 
                        ind_conciliado, 
                        data, 
                        tipo_movimento, 
                        seq_conta_banco
                      ) values (
                        'E',$1, 'Transferência Recebida: ' || $2, 'N', $3, 'TE', $4
                      )`, [valor, des_conta_origem, data, seq_conta_destino]);
    await db.queryGaragem(`insert into tab_movimentacao
                      ( 
                        ind_tipo, 
                        val_movimento, 
                        des_origem, 
                        ind_conciliado, 
                        data, 
                        tipo_movimento, 
                        seq_conta_banco
                      ) values (
                        'S',$1, 'Transferência Enviada: ' || $2, 'N', $3, 'TS', $4
                      )`, [valor, des_conta_destino, data, seq_conta_origem]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Transferencia Realizada com Sucesso"
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");

    res.status(500).json({
      message: "Falha em realizar a transferencia, tente novamente: " + error
    });
  }
};

exports.listaLucroOperacao = async ( req, res ) =>{

  try {
    await db.queryGaragem("BEGIN");

    const lucroCarro = await db.queryGaragem(`select 
                                        'Venda do '||des_veiculo as des_veiculo, 
                                        val_lucro,
                                        dta_venda
                                        from tab_veiculo
                                        where ind_status = 'V'
                                        AND ind_tipo_veiculo in ('P', 'I') order by dta_venda desc`);

    const somaLucroCarro = await db.queryGaragem(`select 
                                        sum(val_lucro) as val_lucro
                                        from tab_veiculo
                                        where ind_status = 'V'
                                        AND ind_tipo_veiculo in ('P', 'I')`);
    
    const retornoFinanciamento = await db.queryGaragem("select val_movimento, des_origem, data from tab_movimentacao where tipo_movimento in ('RF', 'TF') order by data desc");

    const somaRetornoFinanciamento = await db.queryGaragem("select sum(val_movimento) as val_movimento  from tab_movimentacao where tipo_movimento in ('RF', 'TF')");

    const listaDeRetiradas = await db.queryGaragem("select val_movimento, des_origem, data from tab_movimentacao where tipo_movimento in ('RS') order by data desc");

    const somalistaDeRetiradas = await db.queryGaragem("select sum(val_movimento) as val_movimento  from tab_movimentacao where tipo_movimento in ('RS')");

    await db.queryGaragem("COMMIT");
    res.status(200).json({
      lucroCarro: lucroCarro.rows,
      retornoFinanciamento: retornoFinanciamento.rows,
      somaLucroCarro: somaLucroCarro.rows,
      somaRetornoFinanciamento: somaRetornoFinanciamento.rows,
      listaDeRetiradas: listaDeRetiradas.rows,
      somalistaDeRetiradas: somalistaDeRetiradas.rows
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");

    res.status(500).json({
      message: "Falha em buscar Lucros da operacao, tente novamente: " + error
    });
  }

};

exports.retiradaLucro = async (req, res) =>{

  const { valor, banco, favorecido, data } = req.body;

  console.log(req.body);

  try {

    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`insert into tab_movimentacao
    ( 
      ind_tipo, 
      val_movimento, 
      des_origem, 
      ind_conciliado, 
      data, 
      tipo_movimento, 
      seq_conta_banco
    ) values (
      'S',$1, 'Retirada Lucro: ' || $2, 'N', $3, 'RS', $4
    )`, [valor, favorecido, data, banco]);

    await db.queryGaragem("insert into tab_lucro_retirada (val_lucro, val_retirada, des_origem, data, ind_tipo ) values (0, $1, 'Retirada Lucro: ' || $2, $3, 'RS')",[valor, favorecido, data]);
    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Retirada Efetuada com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");

    res.status(500).json({
      message: "Falha em realizar retirada, tente novamente: " + error
    });
  }
  
};

exports.dre = async (req, res) =>{

  const { dataInicial, dataFinal } = req.body;

  try {

    await db.queryGaragem("BEGIN");
    const despesaVeiculo = await db.queryGaragem("select case when sum(val_despesa) = 0 OR sum(val_despesa) is NULL then 0 else sum(val_despesa) end as val_movimento, 'Despesas com Veículos' as des_origem from tab_despesa_veiculo where  cod_tipo_despesa <> 18 and dta_despesa BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const comissaoLoja = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Comissões Loja' as des_origem from tab_movimentacao where tipo_movimento = 'CL' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const despesaAdministrativas = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Despesas Administrativas' as des_origem from tab_movimentacao where tipo_movimento = 'DA' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const despesasComFinanciamentos = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Despesas com Financimentos' as des_origem from tab_movimentacao where tipo_movimento = 'DF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const retornoFinanciamento=  await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Retorno Financiamentos' as des_origem from tab_movimentacao where tipo_movimento = 'RF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const taxaFinanciamento=  await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Taxa Financiamentos' as des_origem from tab_movimentacao where tipo_movimento = 'TF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const lucroVeiculo = await db.queryGaragem("select case when sum(val_lucro) = 0 OR sum(val_lucro) is NULL then 0 else sum(val_lucro) end as val_movimento, 'Lucro de Veículos' as des_origem from tab_lucro_retirada where ind_tipo = 'VV' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const retiradas = await db.queryGaragem("select case when sum(val_retirada) = 0 OR sum(val_retirada) is NULL then 0 else sum(val_retirada) end as val_movimento, 'Lucro de Veículos' as des_origem from tab_lucro_retirada where ind_tipo = 'RS' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const emprestimosFornecidos = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Emprestimos Fornecidos' as des_origem from tab_movimentacao where tipo_movimento = 'EF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const emprestimosRecebidos = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Emprestimos Recebidos' as des_origem from tab_movimentacao where tipo_movimento = 'ER' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const resultadoVeiculo = await db.queryGaragem(`select 
                                                        des_veiculo, 
                                                        val_compra, 
                                                        val_venda, 
                                                        val_lucro, 
                                                        (val_venda - val_compra) as diferenca, 
                                                        case 
                                                            when val_venda <> 0 then ROUND((val_lucro * 100) / (val_venda - val_compra), 2) 
                                                            else 0 
                                                        end as colaboracao,
                                                        (select ROUND(avg(case 
                                                                             when val_venda <> 0 then (val_lucro * 100) / (val_venda - val_compra) 
                                                                             else 0 
                                                                         end), 2)
                                                         from tab_veiculo 
                                                         where 
                                                             ind_status = 'V' 
                                                             and ind_tipo_veiculo = 'P'
                                                             and dta_venda >= '2024-01-01') as media_colaboracao
                                                    from 
                                                        tab_veiculo 
                                                    where 
                                                        ind_status = 'V' 
                                                        and ind_tipo_veiculo = 'P'
                                                        and dta_venda >= $1
                                                      order by colaboracao `,[dataInicial]);
    const recebimentoAvulsoVeiculo = await db.queryGaragem("select   case when sum(val_movimento) = 0 OR sum(val_movimento) is NULL then 0 else sum(val_movimento) end as val_movimento, 'Recebimento Avulso Veiculo' as des_origem from tab_movimentacao where tipo_movimento = 'RA' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const ferros = await db.queryGaragem(`SELECT SUM(val_movimento) AS val_movimento, des_origem
    FROM (
        SELECT 
            CASE 
                WHEN SUM(val_despesa) = 0 OR SUM(val_despesa) IS NULL THEN 0 
                ELSE SUM(val_despesa) 
            END AS val_movimento, 
            'Despesas com Veículos' AS des_origem 
        FROM tab_despesa_veiculo 
        WHERE cod_tipo_despesa = 18 
        AND dta_despesa BETWEEN $1 AND $2
        
        UNION ALL
        
        SELECT 
            CASE 
                WHEN SUM(val_despesa) = 0 OR SUM(val_despesa) IS NULL THEN 0 
                ELSE SUM(val_despesa) 
            END AS val_movimento, 
            'Despesas com Veículos' AS des_origem 
        FROM tab_despesa 
        WHERE cod_tipo_despesa = 25 
        AND dta_despesa BETWEEN $1 AND $2
    ) AS combined_results
    GROUP BY des_origem;`,[dataInicial, dataFinal]);
    const retornoVeiculoProprio = await db.queryGaragem(`select case when sum(val_lucro) = 0 OR sum(val_lucro) is NULL then 0 else sum(val_lucro) end as val_movimento, 'Retornos de Veículos Próprios' as des_origem from tab_lucro_retirada aa
    where aa.ind_tipo = 'RF'
    and aa.seq_veiculo in (select seq_veiculo from tab_veiculo bb
    where aa.seq_veiculo = bb.seq_veiculo
    and bb.ind_tipo_veiculo = 'P')
    and data BETWEEN $1 AND $2`,[dataInicial, dataFinal])

    const despesaVeiculoAnalitico = await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'DV' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const comissaoLojaAnalitico = await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'CL' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const despesaAdministrativasAnalitico = await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'DA' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const despesasComFinanciamentosAnalitico = await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'DF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const retornoFinanciamentoAnalitico =  await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'RF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const taxaFinanciamentoAnalitico =  await db.queryGaragem("select des_origem as des_movimento, data, val_movimento from tab_movimentacao where tipo_movimento = 'TF' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
    const lucroVeiculoAnalitico = await db.queryGaragem("select des_origem as des_movimento, data, val_lucro as val_movimento from tab_lucro_retirada where ind_tipo = 'VV' and data BETWEEN $1 and $2",[dataInicial, dataFinal]);
        
    await db.queryGaragem("COMMIT");

    const convertToInt = (rows) => {
      return rows.map(row => {
        return {
          ...row,
          val_movimento: parseInt(row.val_movimento, 10) || 0 // Convertendo para inteiro ou retornando 0 se não for possível converter
        };
      });
    };
    res.status(200).json({
      despesaVeiculo: convertToInt(despesaVeiculo.rows),
      despesaAdministrativas: convertToInt(despesaAdministrativas.rows),
      despesasComFinanciamentos: convertToInt(despesasComFinanciamentos.rows),
      retornoFinanciamento: convertToInt(retornoFinanciamento.rows),
      taxaFinanciamento: convertToInt(taxaFinanciamento.rows),
      lucroVeiculo: convertToInt(lucroVeiculo.rows),
      retiradas: convertToInt(retiradas.rows),
      emprestimosFornecidos: convertToInt(emprestimosFornecidos.rows),
      emprestimosRecebidos: convertToInt(emprestimosRecebidos.rows),
      comissaoLoja: convertToInt(comissaoLoja.rows),
      recebimentoAvulsoVeiculo: convertToInt([0]),
      ferros: convertToInt(ferros.rows),
      despesaVeiculoAnalitico: despesaVeiculoAnalitico.rows,
      comissaoLojaAnalitico: comissaoLojaAnalitico.rows,
      despesaAdministrativasAnalitico: despesaAdministrativasAnalitico.rows,
      despesasComFinanciamentosAnalitico: despesasComFinanciamentosAnalitico.rows,
      retornoFinanciamentoAnalitico: retornoFinanciamentoAnalitico.rows,
      taxaFinanciamentoAnalitico: taxaFinanciamentoAnalitico.rows,
      lucroVeiculoAnalitico: lucroVeiculoAnalitico.rows,
      retornoVeiculoProprio: convertToInt(retornoVeiculoProprio.rows),
      resultadoVeiculo: convertToInt(resultadoVeiculo.rows)
    });

    console.log(convertToInt(retornoVeiculoProprio.rows))
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em buscar dados da DRE, tente novamente: " + error
    });
  }

};

exports.buscaLembrete = async (req, res) =>{

  try {

    const result = await db.queryGaragem("select * from tab_lembrete");
    
    const result1 = await db.queryGaragem(`select a.des_ocorrencia, b.nome_completo, b.telefone, c.des_veiculo
                                    from tab_ocorrencia_veiculo a
                                    inner join tab_usuario b on (a.seq_usuario = b.seq_usuario)
                                    inner join tab_veiculo c on (a.seq_veiculo = c.seq_veiculo)
                                    where a.ind_concluido = FALSE`);

    const result2 = await db.queryGaragem(`SELECT a.modelo, a.ano, a.km 
                                    FROM TAB_OFERTA_VEICULO a
                                    WHERE ind_concluido = FALSE`);     
                                    
    const result3 = await db.queryGaragem("select nom_pessoa, telefone from tab_indicacao_cliente where ind_status <> 'F'");

    await db.queryGaragem("COMMIT");   

      res.status(200).json({
        message: result.rows,
        message1: result1.rows,
        message2: result2.rows,
        message3: result3.rows
      });

  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lembretes, tente novamente: " + error
    });
  }

};

exports.removeLembrete = async (req, res) =>{

  const { seq_lembrete } = req.body;

  try {

    await db.queryGaragem("delete from tab_lembrete where seq_lembrete = $1",[seq_lembrete]);
    res.status(200).json({
      message: "Lembrete excluido com sucesso."
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em excluir lembrete, tente novamente: " + error
    });
  }

};

exports.insereLembrete = async (req, res) =>{

  const { des_lembrete } = req.body;
  try {

    await db.queryGaragem("insert into tab_lembrete (des_lembrete) values ($1)",[des_lembrete]);
    res.status(200).json({
      message: "Lembrete incluso com sucesso."
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em incluir lembrete, tente novamente: " + error
    });
  }
};

exports.buscaValoresEspecie = async (req, res) =>{

  try {
    const result = await db.queryGaragem(`select     
                                        a.seq_movimento,
                                        a.val_movimento,
                                        a.dta_movimento,
                                        a.ind_depositado,
                                        a.dta_deposito,
                                        a.comprovante_deposito,
                                        a.seq_veiculo,
                                        b.des_veiculo
                                        from tab_movimento_especie a
                                        inner join tab_veiculo b on (a.seq_veiculo = b.seq_veiculo)`);

     const response =  result.rows.map(row => {
       const { seq_movimento, val_movimento, dta_movimento, ind_depositado, dta_deposito, comprovante_deposito, seq_veiculo, des_veiculo } = row;
       const base64Image = comprovante_deposito !== null ? comprovante_deposito.toString() : null;
       
       return {
        seq_movimento, 
        val_movimento, 
        dta_movimento, 
        ind_depositado, 
        dta_deposito, 
        comprovante_deposito: base64Image, 
        seq_veiculo, des_veiculo
       };
     });
    res.status(200).json({
      message: response
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lembretes, tente novamente: " + error
    });
  }

};

exports.realizarDeposito = async (req, res) =>{

  const { seq_movimento, val_movimento, seq_conta_banco, seq_veiculo, dta_deposiito, des_veiculo, comprovante_deposito } = req.body;
  
  try {
    await db.queryGaragem("BEGIN");
    await db.queryGaragem(`insert into tab_movimentacao
                                              ( 
                                                ind_tipo, 
                                                val_movimento, 
                                                des_origem, 
                                                ind_conciliado, 
                                                data, 
                                                tipo_movimento, 
                                                seq_conta_banco,
                                                seq_veiculo
                                              ) values (
                                                'E',
                                                $1,
                                                'Depósito: ' || $2, 
                                                'N', 
                                                $3, 
                                                'DP', 
                                                $4,
                                                $5
                                              )`, [val_movimento, des_veiculo, dta_deposiito, seq_conta_banco, seq_veiculo]);

     await db.queryGaragem(`update tab_movimento_especie
                                                set
                                                ind_depositado = 'S',
                                                dta_deposito = $1,
                                                comprovante_deposito = $2
                                                where seq_movimento = $3`,[dta_deposiito, comprovante_deposito, seq_movimento ]);
    await db.queryGaragem("COMMIT");
    res.status(200).json({
      message: "Depósito Realizado com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em buscar lembretes, tente novamente: " + error
    });
  }

};

exports.finalizaVeiculoDeParceiros = async( req, res) =>{

  const {seq_veiculo, des_veiculo, des_proprietario, ind_financiado, comissao, banco, data, cod_vendedor, origem_venda} = req.body;

  try {

    if(ind_financiado === true){
      await db.queryGaragem(`update tab_veiculo
      set ind_status = 'V',
          ind_financiado = TRUE,
          dta_venda = $2,
          cod_vendedor = $3,
          cod_usuario_vinculado = 0
      where seq_veiculo = $1`,[seq_veiculo, data, cod_vendedor]);

      await db.queryGaragem(`insert into tab_receitas 
                              (seq_veiculo, des_receita, cod_tipo_receita, ind_status, dta_receita)
                              values
                              ($1, 'Retorno ${des_veiculo}', 3, 'A', $2)`,[seq_veiculo, data])
    }else{
      await db.queryGaragem(`update tab_veiculo
      set ind_status = 'V',
      cod_usuario_vinculado = 0,
      dta_venda = $2,
      cod_vendedor = $3,
      origem_venda = $4
      where seq_veiculo = $1`,[seq_veiculo, data, cod_vendedor, origem_venda]);
    }

    await db.queryGaragem(`insert into tab_movimentacao
    (
    ind_tipo,
    val_movimento,
    des_origem,
    ind_conciliado,
    data,
    tipo_movimento,
    seq_conta_banco,
    seq_veiculo
    )values(
    'E',
    $1,
    'Comissao Loja ${des_veiculo} ${des_proprietario}',
    'N',
    $2,
    'CL',
    $3,
    $4
    )`,[comissao, data, banco, seq_veiculo]);

    res.status(200).json({
      message: "Veiculo Encerrado"
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em encerrar veiculo, tente novamente: " + error
    });
  }
};

exports.cadastroUsuario = async( req, res) =>{

  const { nom_usuario, senha, dta_nasc, telefone, img_usuario, nome_completo} = req.body;

  const sequenciaAleatoria = gerarCodigo();

  try {

    const result = await db.queryGaragem("select * from tab_usuario where nom_usuario = $1",[nom_usuario]);

    if(result.rowCount > 0){
      res.status(500).json({
        message: "Já existe um usuário utilizando este nome, tente outro diferente."
      });
    }else{
      await db.queryGaragem(`insert into tab_usuario 
      (nom_usuario, senha, telefone, ind_tipo, img_usuario, codigo_usuario, dta_nasc, ind_elegivel, nome_completo)
      values
      ($1, $2, $3, 'C', $4, $5, $6, 'S', $7)`,[nom_usuario, senha, telefone, img_usuario, sequenciaAleatoria, dta_nasc, nome_completo]);

      res.status(200).json({
        message: "Cadastro Realizado com sucesso"
      });
    }
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em realizar cadastro, tente novamente: " + error
    });
  }

};

function gerarCodigo() {
  // Gera um número aleatório entre 10000 e 99999
  const codigo = Math.floor(10000 + Math.random() * 90000);
  return codigo; // Converte para string
}

exports.listaDeClientes = async (req, res) =>{

  try {

    const result = await db.queryGaragem("select seq_usuario, nom_usuario, codigo_usuario from tab_usuario where ind_tipo = 'C'");

    res.status(200).json({
      message: result.rows
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em consultar clientes, tente novamente: " + error
    });
  }

};

exports.indicacao = async (req, res) =>{

  const { nom_pessoa, telefone, cod_usuario_indicacao, nom_pessoa_indicacao } = req.body;

  try {

    await db.queryGaragem(`INSERT INTO TAB_INDICACAO_CLIENTE
                     (nom_pessoa, telefone, cod_usuario_indicacao, nom_pessoa_indicacao,  ind_status)
                     VALUES
                     ($1, $2, $3, $4, 'A')
                    `,[nom_pessoa, telefone, cod_usuario_indicacao, nom_pessoa_indicacao]);
                    
    res.status(200).json({
      message: "Indicação Realizado, esperamos que você ganhe a gratificacao!"
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em realizar inidicação, tente novamente: " + error
    });
  }
};

exports.vincularClienteVeiculo = async (req, res) =>{

  const { codigo_usuario, seq_veiculo, seq_usuario, val_movimento } = req.body;

  try {

    if(val_movimento > 0){

      await db.queryGaragem(`INSERT INTO TAB_BONUS_USUARIO 
                                  (seq_usuario, val_movimento, ind_tipo, seq_veiculo)
                                  values
                                  ($1, $2, 'Bônus de Compra', $3)`,[seq_usuario, val_movimento, seq_veiculo]);
    }

    await db.queryGaragem(`INSERT INTO TAB_usuario_veiculo
                    (codigo_usuario, seq_veiculo, seq_usuario)
                    VALUES
                    ($1, $2, $3)`,[codigo_usuario, seq_veiculo, seq_usuario]);

    await db.queryGaragem(`update TAB_usuario
                    set ranking = ranking + 1
                    where seq_usuario = $1`,[seq_usuario]);
    
    await db.queryGaragem("update tab_veiculo set cod_usuario_vinculado = $1 where seq_veiculo = $2",[seq_usuario, seq_veiculo]);
   
    res.status(200).json({
      message: "Vinculo Realizado com Sucesso."
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em realizar vinculo, tente novamente: " + error
    });
  }

};

exports.buscaVeiculoUsuario = async (req, res) =>{

  const { seq_usuario } = req.body;

  try {

    const result = await db.queryGaragem(`select 
                                    seq_veiculo, 
                                    des_veiculo, 
                                    val_compra, 
                                    val_venda, 
                                    val_lucro,
                                    observacoes, 
                                    dta_compra, 
                                    ind_troca, 
                                    dta_venda,
                                    seq_veiculo_origem, 
                                    img_veiculo ,
                                    ind_tipo_veiculo,
                                    des_proprietario,
                                    ind_retorno_vinculado,
                                    ind_financiado,
                                    cod_usuario_vinculado,
                                    img_contrato
                                    from tab_veiculo
                                    where ind_status = 'V'
                                    and cod_usuario_vinculado = $1
                                    order by dta_venda desc`,[seq_usuario]);

      const response =  result.rows.map(row => {
        const { seq_veiculo, des_veiculo, val_compra, val_venda, observacoes, dta_compra, val_lucro, 
          dta_venda, ind_troca, seq_veiculo_origem, img_veiculo, ind_tipo_veiculo, des_proprietario, 
          ind_retorno_vinculado, ind_financiado, cod_usuario_vinculado, img_contrato } = row;

        const base64Image = img_veiculo !== null ? img_veiculo.toString() : null;
        const base64ImageContrato = img_contrato !== null ? img_contrato.toString() : null;
        
        return {
          seq_veiculo, 
          des_veiculo, 
          val_compra, 
          val_venda,
          observacoes, 
          dta_compra, 
          dta_venda,
          val_lucro,
          ind_troca, 
          seq_veiculo_origem, 
          img_veiculo: base64Image,
          ind_tipo_veiculo,
          des_proprietario,
          ind_retorno_vinculado,
          ind_financiado,
          cod_usuario_vinculado,
          img_contrato: base64ImageContrato
        };
      });

    res.status(200).json({
      message: response
    });
    
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar lista de veiculos" + error
    });
  }

};

exports.buscaIndicacao = async (req, res) =>{

  try {

    const result = await db.queryGaragem("select seq_indicacao, nom_pessoa, telefone, cod_usuario_indicacao, nom_pessoa_indicacao, ind_gerou_venda, ind_status from tab_indicacao_cliente");

    res.status(200).json({
      message: result.rows
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar inidicação, tente novamente: " + error
    });

  }
};

exports.atualizaIndicacao = async (req, res) =>{

  const { seq_indicacao, ind_gerou_venda, ind_status, comprovante } = req.body;

  try {

    await db.queryGaragem("update tab_indicacao_cliente set ind_gerou_venda = $1, ind_status = $2, comprovante = $3 where seq_indicacao = $4",[ind_gerou_venda, ind_status, comprovante, seq_indicacao]);
    
    res.status(200).json({
      message: "Indicação encerrada"
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em atualizar inidicação, tente novamente: " + error
    });
  }
};

exports.buscaIndicacaoAreaCliente = async (req, res) =>{

  const { cod_usuario_indicacao } = req.body;

  console.log(req.body);

  try {

    const result = await db.queryGaragem("select nom_pessoa, telefone, ind_gerou_venda, ind_status, comprovante from tab_indicacao_cliente where cod_usuario_indicacao = $1",[cod_usuario_indicacao]);

    
    const response =  result.rows.map(row => {
      const { nom_pessoa, telefone, ind_gerou_venda, ind_status, comprovante } = row;
      const base64Image = comprovante !== null ? comprovante.toString() : null;
      
      return {
        nom_pessoa, telefone, ind_gerou_venda, ind_status, comprovante:base64Image
      };
    });
    
    res.status(200).json({
      message: response
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em buscar minhas inidicação, tente novamente: " + error
    });
  }
}; 

exports.enviarOcorrencia = async (req, res) =>{

  const { des_ocorrencia, img_ocorrencia, seq_veiculo, seq_usuario } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_veiculo set ind_ocorrencia_aberta = TRUE where seq_veiculo = $1",[seq_veiculo]);

    await db.queryGaragem(`INSERT INTO TAB_OCORRENCIA_VEICULO
                                    (des_ocorrencia, img_ocorrencia, seq_veiculo, seq_usuario, ind_concluido)
                                    values
                                    ($1, $2, $3, $4, FALSE)`,[des_ocorrencia, img_ocorrencia, seq_veiculo, seq_usuario]);
    await db.queryGaragem("COMMIT");
    res.status(200).json({
      message: "Ocorrência registrada com sucesso, \n Entraremos em contato com você."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em iniciar ocorrencia, tente novamente: " + error
    });
  }
};


exports.buscaOcorrencia = async (req, res) =>{

  const { seq_veiculo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    const result = await db.queryGaragem(`select a.seq_ocorrencia, a.des_ocorrencia, a.img_ocorrencia, b.nome_completo, b.telefone, a.ind_concluido, a.resposta_ocorrencia, a.img_resposta_ocorrencia
                                    from tab_ocorrencia_veiculo a
                                    inner join tab_usuario b on (a.seq_usuario = b.seq_usuario)
                                    where a.seq_veiculo = $1
                                    order by a.seq_ocorrencia desc`,[seq_veiculo]);

    const response =  result.rows.map(row => {
      const { seq_ocorrencia, des_ocorrencia, img_ocorrencia ,nome_completo, telefone, ind_concluido, resposta_ocorrencia, img_resposta_ocorrencia } = row;
      const base64Image = img_ocorrencia !== null ? img_ocorrencia.toString() : null;
      const base64Image1 = img_resposta_ocorrencia !== null ? img_resposta_ocorrencia.toString() : null;
      
      return {
        seq_ocorrencia, des_ocorrencia, img_ocorrencia: base64Image ,nome_completo, telefone, ind_concluido, resposta_ocorrencia, img_resposta_ocorrencia: base64Image1
      };
    });
    await db.queryGaragem("COMMIT");   

      res.status(200).json({
        message: response
      });

  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em iniciar ocorrencia, tente novamente: " + error
    });
  }
};

exports.respostaOcorrencia = async (req, res) =>{

  const { seq_ocorrencia, resposta_ocorrencia, img_resposta_ocorrencia } = req.body;

  try {
    await db.queryGaragem("BEGIN");
    await db.queryGaragem(`update TAB_OCORRENCIA_VEICULO 
                          set resposta_ocorrencia = $1,
                              img_resposta_ocorrencia = $2
                          where seq_ocorrencia = $3`,[resposta_ocorrencia, img_resposta_ocorrencia, seq_ocorrencia]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Resposta Enviada"
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em enviar resposta da ocorrencia, tente novamente: " + error
    });
  }
};

exports.buscaOcorrenciaAreaCliente = async (req, res) =>{

  const { seq_usuario } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    const result = await db.queryGaragem(`select a.seq_ocorrencia, a.des_ocorrencia, a.img_ocorrencia, b.nome_completo, b.telefone, a.ind_concluido, a.resposta_ocorrencia, a.img_resposta_ocorrencia, c.des_veiculo
                                    from tab_ocorrencia_veiculo a
                                    inner join tab_usuario b on (a.seq_usuario = b.seq_usuario)
                                    inner join tab_veiculo c on (a.seq_veiculo = c.seq_veiculo)
                                    where a.seq_usuario = $1`,[seq_usuario]);

    const response =  result.rows.map(row => {
      const { seq_ocorrencia, des_ocorrencia, img_ocorrencia ,nome_completo, telefone, ind_concluido, resposta_ocorrencia, img_resposta_ocorrencia, des_veiculo } = row;
      const base64Image = img_ocorrencia !== null ? img_ocorrencia.toString() : null;
      const base64Image1 = img_resposta_ocorrencia !== null ? img_resposta_ocorrencia.toString() : null;
      
      return {
        seq_ocorrencia, des_ocorrencia, img_ocorrencia: base64Image ,nome_completo, telefone, ind_concluido, resposta_ocorrencia, img_resposta_ocorrencia: base64Image1, des_veiculo
      };
    });
    await db.queryGaragem("COMMIT");   

      res.status(200).json({
        message: response
      });

  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em iniciar ocorrencia, tente novamente: " + error
    });
  }
};

exports.finalizaOcorrencia = async (req, res) =>{

  const { seq_ocorrencia, seq_veiculo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`update TAB_OCORRENCIA_VEICULO 
                          set ind_concluido = TRUE
                          where seq_ocorrencia = $1`,[seq_ocorrencia]);

    await db.queryGaragem(`update TAB_VEICULO 
                          set ind_ocorrencia_aberta = FALSE
                          where seq_veiculo = $1`,[seq_veiculo]);


    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Ocorrência Finalizada com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em enviar resposta da ocorrencia, tente novamente: " + error
    });
  }
};

exports.pixUsuario = async (req, res) =>{

  const { seq_usuario, pix } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`update TAB_USUARIO 
                          set pix = $2
                          where seq_usuario = $1`,[seq_usuario, pix]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Pix Salvo com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em salvar pix, tente novamente: " + error
    });
  }
};

exports.ofertarVeiculo = async (req, res) => {
  const { modelo, ano, km, proprietario, telefone, valor, leilao, seq_usuario, img_veiculo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    // Construindo a lista de campos de imagens dinamicamente
    const imageColumns = img_veiculo.map((_, index) => `img_${index + 1}`).join(", ");

    // Construindo a lista de placeholders dinamicamente para as imagens
    const imagePlaceholders = img_veiculo.map((_, index) => `$${index + 10}`).join(", "); // Começa com $9 devido ao seq_usuario

    // Criando a consulta SQL dinamicamente com base na quantidade de imagens
    const queryGaragem = `
      INSERT INTO TAB_OFERTA_VEICULO 
      (modelo, ano, km, proprietario, telefone, valor, leilao, seq_usuario, ind_concluido ${imageColumns})
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, false, ${imagePlaceholders})
    `;

    // Construindo um array com os valores das imagens para a consulta SQL
    const imageValues = img_veiculo.slice(0, 6); // Limitando a 6 imagens para o exemplo

    await db.queryGaragem(queryGaragem, [modelo, ano, km, proprietario, telefone, valor, leilao, seq_usuario, ...imageValues]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Oferta Enviada com Sucesso, Aguarde nosso retorno."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em enviar oferta, tente novamente: " + error
    });
  }
};

exports.buscaOfertasAreaCliente = async (req, res) =>{

  const { seq_usuario } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    const result = await db.queryGaragem(`SELECT seq_oferta, modelo, ano, km, proprietario, telefone, valor, leilao, valor_contra_proposta, comprovante, resultou_compra, observacao, img_1
                                    FROM TAB_OFERTA_VEICULO
                                    WHERE seq_usuario = $1`,[seq_usuario]);

                                    
    const response = result.rows.map(row => {
      const { seq_oferta, modelo, ano, km, proprietario, telefone, valor, leilao, valor_contra_proposta, comprovante, resultou_compra, observacao, img_1 } = row;
      const base64Image = comprovante !== null ? comprovante.toString() : null;
      const base64Image1 = img_1 !== null ? img_1.toString() : null;

      return {
        seq_oferta, modelo, ano, km, proprietario, telefone, valor, leilao, valor_contra_proposta, comprovante: base64Image, resultou_compra, observacao, img_1: base64Image1
      };
    });

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: response
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em salvar pix, tente novamente: " + error
    });
  }
};

exports.buscaOfertasVeiculos = async (req, res) =>{

  try {
    await db.queryGaragem("BEGIN");

    const result = await db.queryGaragem(`SELECT a.seq_oferta, a.modelo, a.ano, a.km, a.proprietario, a.telefone, a.valor, a.leilao, 
                                    a.resultou_compra, a.observacao, a.comprovante, b.pix, a.img_1, a.img_2, a.img_3, a.img_4, a.img_5, a.img_6, a.ind_concluido
                                    FROM TAB_OFERTA_VEICULO a
                                    inner join tab_usuario b on (a.seq_usuario = b.seq_usuario)
                                    WHERE ind_concluido = FALSE`);

    const response = result.rows.map(row => {
      const { seq_oferta, modelo, ano, km, proprietario, telefone, valor, leilao, resultou_compra, observacao, comprovante, img_1, img_2, img_3, img_4, img_5, img_6, ind_concluido, pix } = row;
      const base64Image1 = img_1 !== null ? img_1.toString() : null;
      const base64Image2 = img_2 !== null ? img_2.toString() : null;
      const base64Image3 = img_3 !== null ? img_3.toString() : null;
      const base64Image4 = img_4 !== null ? img_4.toString() : null;
      const base64Image5 = img_5 !== null ? img_5.toString() : null;
      const base64Image6 = img_6 !== null ? img_6.toString() : null;

      return {
        seq_oferta, modelo, ano, km, proprietario, telefone, valor, leilao, resultou_compra, observacao, comprovante,
        img_veiculo : [base64Image1,base64Image2,base64Image3,base64Image4,base64Image5,base64Image6], ind_concluido, pix
      };
    });

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: response
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em salvar pix, tente novamente: " + error
    });
  }
};

exports.atualizaStatusOfertasVeiculos = async (req, res) =>{

  const { seq_oferta, resultou_compra, observacao, ind_concluido, comprovante } = req.body;

  console.log(req.body);

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`update TAB_OFERTA_VEICULO 
                          set resultou_compra = $1,
                              observacao = $2,
                              ind_concluido = $3,
                              comprovante = $4
                          where seq_oferta = $5`,[resultou_compra, observacao, ind_concluido, comprovante, seq_oferta]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Oferta atualizada com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em atualizar oferta, tente novamente: " + error
    });
  }
};

exports.metricaVendaVeiculo = async (req, res) =>{

  const { dta_inicial, dta_final } = req.body;

  try {

    await db.queryGaragem("BEGIN");

    const vendaPropria = await db.queryGaragem(`
                                              WITH meses AS (
                                                  SELECT generate_series(0, 6) AS num
                                              ),
                                              ultimos_meses AS (
                                                  SELECT 
                                                      EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                      EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                      TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM YYYY') AS nome_mes
                                                  FROM meses
                                              )
                                              SELECT 
                                                  u.mes,
                                                  u.nome_mes,
                                                  COUNT(v.dta_venda) AS contagem
                                              FROM ultimos_meses u
                                              LEFT JOIN tab_veiculo v 
                                                  ON EXTRACT(YEAR FROM v.dta_venda) = u.ano
                                                  AND EXTRACT(MONTH FROM v.dta_venda) = u.mes
                                                  AND v.ind_status = 'V'
                                                  AND v.ind_tipo_veiculo = 'P'
                                              GROUP BY u.mes, u.nome_mes, u.ano
                                              ORDER BY u.ano ASC, u.mes ASC;
                                              `);
    
    const vendaTerceiros = await db.queryGaragem(`
                                              WITH meses AS (
                                                  SELECT generate_series(0, 6) AS num
                                              ),
                                              ultimos_meses AS (
                                                  SELECT 
                                                      EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                      EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                      TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM YYYY') AS nome_mes
                                                  FROM meses
                                              )
                                                  SELECT 
            u.mes,
            u.nome_mes,
            COUNT(v.dta_venda) AS contagem
        FROM ultimos_meses u
        LEFT JOIN tab_veiculo v 
            ON EXTRACT(YEAR FROM v.dta_venda) = u.ano
            AND EXTRACT(MONTH FROM v.dta_venda) = u.mes
            AND v.ind_status = 'V'
            AND v.ind_tipo_veiculo = 'T'
           -- AND v.dta_venda BETWEEN $1 AND $2
                                              GROUP BY u.mes, u.nome_mes, u.ano
                                              ORDER BY u.ano ASC, u.mes ASC;`);
    
    const vendaInvestidor = await db.queryGaragem(`
WITH meses AS (
                                                  SELECT generate_series(0, 6) AS num
                                              ),
                                              ultimos_meses AS (
                                                  SELECT 
                                                      EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                      EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                      TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM YYYY') AS nome_mes
                                                  FROM meses
                                              )
        SELECT 
            u.mes,
            u.nome_mes,
            COUNT(v.dta_venda) AS contagem
        FROM ultimos_meses u
        LEFT JOIN tab_veiculo v 
            ON EXTRACT(YEAR FROM v.dta_venda) = u.ano
            AND EXTRACT(MONTH FROM v.dta_venda) = u.mes
            AND v.ind_status = 'V'
            AND v.ind_tipo_veiculo = 'I'
           -- AND v.dta_venda BETWEEN $1 AND $2
        GROUP BY u.mes, u.nome_mes, u.ano
                                              ORDER BY u.ano ASC, u.mes ASC;`);
    
    const mesesDeVenda = await db.queryGaragem(`
WITH meses AS (
                                                  SELECT generate_series(0, 6) AS num
                                              ),
                                              ultimos_meses AS (
                                                  SELECT 
                                                      EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                      EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                      TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM YYYY') AS nome_mes
                                                  FROM meses
                                              )
        SELECT 
            u.mes,
            u.nome_mes,
            COUNT(v.dta_venda) AS contagem
        FROM ultimos_meses u
        LEFT JOIN tab_veiculo v 
            ON EXTRACT(YEAR FROM v.dta_venda) = u.ano
            AND EXTRACT(MONTH FROM v.dta_venda) = u.mes
            AND v.ind_status = 'V'
            --AND v.dta_venda BETWEEN $1 AND $2
        GROUP BY u.mes, u.nome_mes, u.ano
                                              ORDER BY u.ano ASC, u.mes ASC;`);
    
    await db.queryGaragem("COMMIT");
    

    res.status(200).json({
      message: vendaPropria.rows,
      message1: vendaTerceiros.rows,
      message2: mesesDeVenda.rows,
      message3: vendaInvestidor.rows
    });
    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em buscar metricas de vendas, tente novamente: " + error
    });
  }

};

exports.metricaVendaVendedor = async (req, res) =>{

  try {

    await db.queryGaragem("BEGIN");

const moment = require("moment");

// Obter a lista de vendedores
const vendedoresResult = await db.queryGaragem(
  `SELECT DISTINCT cod_vendedor, nom_vendedor FROM tab_vendedor ORDER BY nom_vendedor`
);
const vendedores = vendedoresResult.rows;

// Criar um array com os últimos 12 meses (incluindo o mês atual)
const meses = [];
for (let i = 0; i < 6; i++) {
  const dataRef = moment().subtract(i, "months"); // Subtrai os meses corretamente
  meses.push({
    mes: dataRef.month() + 1, // Meses em moment() começam do zero, por isso +1
    dta_inicial: dataRef.startOf("month").format("YYYY-MM-DD"),
    dta_final: dataRef.endOf("month").format("YYYY-MM-DD"),
  });
}

// Reverter a ordem para exibir os meses do mais antigo para o mais recente
meses.reverse();

// Obter a quantidade de vendas por vendedor e por mês
const vendaVendedor = [];

for (const vendedor of vendedores) {
  const { cod_vendedor, nom_vendedor } = vendedor;
  const qtd_vendas = [];

  for (const { mes, dta_inicial, dta_final } of meses) {
    const vendaResult = await db.queryGaragem(
      `SELECT COUNT(*) AS qtd_venda
       FROM tab_veiculo
       WHERE cod_vendedor = $1 AND dta_venda BETWEEN $2 AND $3`,
      [cod_vendedor, dta_inicial, dta_final]
    );

    const qtd_venda_apurada = vendaResult.rows[0].qtd_venda;
    qtd_vendas.push(qtd_venda_apurada);
  }

  vendaVendedor.push({
    label: nom_vendedor,
    data: qtd_vendas,
    pointRadius: 10,
    pointHoverRadius: 15,
  });
}

// Buscar os nomes dos meses corretamente para exibição
const mesesDeVenda = await db.queryGaragem(
  `WITH meses AS (
    SELECT generate_series(0, 6) AS num
)
SELECT 
    EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
    EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
    TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'TMMonth YYYY') AS nome_mes
FROM meses
ORDER BY ano, mes;
`
);

await db.queryGaragem("COMMIT");


    res.status(200).json({
      message: vendaVendedor,
      message1: mesesDeVenda.rows
    });
    
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em buscar metricas de vendas, tente novamente: " + error
    });
  }

};

exports.buscaVendedores = async(req, res) =>{

  try {

    await db.queryGaragem("BEGIN");

    const result = await db.queryGaragem("select * from tab_vendedor");

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: result.rows
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em buscar vendedores: " + error
    });
  }

};

exports.publicarVeiculo = async (req, res) => {
  const { seq_veiculo, nova_img, des_veiculo_completa, val_venda_esperado, km, ano, img_veiculo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    // Construindo a lista de campos de imagens e placeholders dinamicamente
    const imageAssignments = img_veiculo
      .map((_, index) => `img_veiculo_${index + 1} = $${index + 6}`)
      .join(", ");

    // Criando a consulta SQL dinamicamente com base na quantidade de imagens
    const queryGaragem = `
      UPDATE TAB_VEICULO
      SET des_veiculo_completa = $1, 
          val_venda_esperado = $2, 
          km = $3, 
          des_veiculo = $1,
          ind_publicado = true,
          ano = $4,
          img_veiculo = $5,
          ${imageAssignments}
      WHERE seq_veiculo = $${img_veiculo.length + 6}
    `;

    // Construindo um array com os valores das imagens para a consulta SQL
    const imageValues = img_veiculo.slice(0, 6); // Limitando a 6 imagens para o exemplo

    // Executando a consulta SQL com os valores corretos
    await db.queryGaragem(queryGaragem, [
      des_veiculo_completa, 
      val_venda_esperado, 
      km, 
      ano, 
      nova_img,
      ...imageValues,
      seq_veiculo // Adicionando o seq_veiculo como último parâmetro
    ]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Veiculo publicado com Sucesso."
    });
  } catch (error) {
    await db.queryGaragem("ROLLBACK");
    res.status(500).json({
      message: "Falha em enviar oferta, tente novamente: " + error
    });
  }
};

exports.veiculosAbertosAreaCliente = async (req, res) => {
  try {
    const result = await db.queryGaragem(`
      SELECT 
        val_venda_esperado,
        km,
        ano,
        des_veiculo_completa,
        img_veiculo_1,
        img_veiculo_2,
        img_veiculo_3,
        img_veiculo_4,
        img_veiculo_5,
        img_veiculo_6
      FROM tab_veiculo
      WHERE ind_status = 'A'
      and ind_publicado = true
      order by des_veiculo_completa
    `);

    const response = result.rows.map(row => {
      const {
        val_venda_esperado,
        km,
        ano,
        des_veiculo_completa,
        img_veiculo_1,
        img_veiculo_2,
        img_veiculo_3,
        img_veiculo_4,
        img_veiculo_5,
        img_veiculo_6
      } = row;

      // Converting buffer images to base64 if they exist
      const base64Images = [img_veiculo_1, img_veiculo_2, img_veiculo_3, img_veiculo_4, img_veiculo_5, img_veiculo_6].map(img => img ? img.toString() : null);

      return {
        val_venda_esperado,
        km,
        ano,
        des_veiculo_completa,
        img_veiculo_1: base64Images[0],
        img_veiculo_2: base64Images[1],
        img_veiculo_3: base64Images[2],
        img_veiculo_4: base64Images[3],
        img_veiculo_5: base64Images[4],
        img_veiculo_6: base64Images[5]
      };
    });

    res.status(200).json({
      message: response
    });
  } catch (error) {
    console.error('Erro ao buscar lista de veículos para venda:', error);
    res.status(500).json({
      message: "Falha em buscar lista de veículos para venda.",
      error: error.message
    });
  }
};

exports.cadastrarCliente = async (req, res) => {
  const { seq_veiculo, des_cidade, des_logradouro, des_uf, email, estado_civil, nom_bairro, nom_cliente, num_cep, num_cnpj_cpf, num_rg_ie, telefone, dta_nasc, valor_venda_contrato, chassis, placa, renavam, km, observacao_venda } = req.body;

  const sequenciaAleatoria = gerarCodigo();

  const nom_usuario = obterPrimeiroEUltimoNome(nom_cliente);

  try {
    await db.queryGaragem("BEGIN");

    const existeCliente = await db.queryGaragem("SELECT * FROM tab_cliente WHERE num_cnpj_cpf = $1", [num_cnpj_cpf]);

    if (existeCliente.rowCount > 0) {
      const result = await db.queryGaragem("SELECT max(seq_usuario) AS seq_usuario, codigo_usuario, nom_usuario FROM tab_usuario WHERE cod_cliente = $1 group by 2,3", [existeCliente.rows[0].cod_cliente]);

      const { seq_usuario, codigo_usuario } = result.rows[0];

      await db.queryGaragem(`INSERT INTO TAB_usuario_veiculo (codigo_usuario, seq_veiculo, seq_usuario) VALUES ($1, $2, $3)`, [codigo_usuario, seq_veiculo, seq_usuario]);

      await db.queryGaragem(`UPDATE TAB_usuario SET ranking = ranking + 1 WHERE seq_usuario = $1`, [seq_usuario]);

      await db.queryGaragem(`UPDATE tab_veiculo 
                              SET cod_usuario_vinculado = $1, 
                                  valor_venda_contrato = $2,
                                  chassis = $3,
                                  placa = $4,
                                  renavam = $5,
                                  km = $6,
                                  observacao_venda = $7
                              WHERE seq_veiculo = $8`, [seq_usuario, valor_venda_contrato, chassis, placa, renavam, km, observacao_venda, seq_veiculo]);

      res.status(200).json({
        message: "Vinculo realizado com sucesso",
        usuarioApp: nom_usuario,
        cadastrado: true
      });
    } else {
      const queryCliente = `
        INSERT INTO TAB_CLIENTE 
        (des_cidade, des_logradouro, des_uf, email, estado_civil, nom_bairro, nom_cliente, num_cep, num_cnpj_cpf, num_rg_ie, telefone, dta_nasc)
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

      await db.queryGaragem(queryCliente, [des_cidade, des_logradouro, des_uf, email, estado_civil, nom_bairro, nom_cliente, num_cep, num_cnpj_cpf, num_rg_ie, telefone, dta_nasc]);

      const resultCliente = await db.queryGaragem("SELECT max(cod_cliente) AS cod_cliente FROM tab_cliente WHERE num_cnpj_cpf = $1", [num_cnpj_cpf]);

      const ultimoCliente = resultCliente.rows[0].cod_cliente;

      await db.queryGaragem(`INSERT INTO tab_usuario 
          (nom_usuario, senha, telefone, ind_tipo, codigo_usuario, dta_nasc, ind_elegivel, nome_completo, cod_cliente)
          VALUES
          ($1, $2, $3, 'C', $4, $5, 'S', $6, $7)`, [nom_usuario, 'prime2024', telefone, sequenciaAleatoria, dta_nasc, nom_cliente, ultimoCliente]);

      const resultUsuario = await db.queryGaragem("SELECT max(seq_usuario) AS seq_usuario FROM tab_usuario WHERE cod_cliente = $1", [ultimoCliente]);

      const ultimoUsuario = resultUsuario.rows[0].seq_usuario;

      await db.queryGaragem(`INSERT INTO TAB_usuario_veiculo (codigo_usuario, seq_veiculo, seq_usuario) VALUES ($1, $2, $3)`, [sequenciaAleatoria, seq_veiculo, ultimoUsuario]);

      await db.queryGaragem(`UPDATE TAB_usuario SET ranking = ranking + 1 WHERE seq_usuario = $1`, [ultimoUsuario]);

      await db.queryGaragem(`UPDATE tab_veiculo 
      SET cod_usuario_vinculado = $1,
          valor_venda_contrato = $2,
          chassis = $3,
          placa = $4,
          renavam = $5,
          km = $6,
          observacao_venda = $7
      WHERE seq_veiculo = $8`, [ultimoUsuario, valor_venda_contrato, chassis, placa, renavam, km, observacao_venda ? observacao_venda : 'Nada Especificado' , seq_veiculo]);

      await db.queryGaragem("COMMIT");

      res.status(200).json({
        message: "Cadastro realizado com sucesso",
        usuarioApp: nom_usuario,
        cadastrado: true
      });
    }

  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em cadastrar cliente, tente novamente: " + error
    });

  }
};

function obterPrimeiroEUltimoNome(nomeCompleto) {
  // Divida o nome completo em partes usando espaços como delimitadores
  const partesNome = nomeCompleto.trim().split(' ');

  // Pegue a primeira parte do nome (primeiro nome)
  const primeiroNome = partesNome[0];

  // Pegue a última parte do nome (último nome)
  const ultimoNome = partesNome[partesNome.length - 1];

  // Concatene o primeiro e o último nome com um ponto no meio
  const resultado = `${primeiroNome}.${ultimoNome}`.toLowerCase();

  return resultado;
}

exports.salvaContratoVeiculo = async(req, res) =>{

  const { seq_veiculo, base64 } = req.body;

  try {

    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_veiculo set img_contrato = $1 where seq_veiculo = $2",[base64, seq_veiculo]);

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Contrato Salvo com Sucesso"
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em gravar contrato, salve-o no computador " + error
    });
  }
};


exports.atualizaDesVeiculo = async (req, res) =>{

  const { seq_veiculo, des_veiculo_completa } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_veiculo set des_veiculo_completa = $1, des_veiculo = $1 where seq_veiculo = $2",[des_veiculo_completa, seq_veiculo])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Descrição Atualizada com Sucesso."
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em atualizar a descrição, tente novamente. " + error
    });
  }

};

exports.alterarSenha = async (req, res) =>{

  const { seq_usuario, senha } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_usuario set senha = $1 where seq_usuario = $2",[senha, seq_usuario])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Senha Atualizada com Sucesso."
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em atualizar a descrição, tente novamente. " + error
    });
  }

};

exports.alterarImagem = async (req, res) =>{

  const { seq_usuario, img } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem("update tab_usuario set img_usuario = $1 where seq_usuario = $2",[img, seq_usuario])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Foto Atualizada com Sucesso."
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em atualizar a descrição, tente novamente. " + error
    });
  }

};

exports.buscaAtivosPassivos = async (req, res) =>{

  try {
    await db.queryGaragem("BEGIN");

    const ativos = await db.queryGaragem(`select sum(valor) as total_valor from (
      select sum(a.val_despesa) as valor
      from tab_despesa_veiculo a
      inner join tab_veiculo b on (a.seq_veiculo = b.seq_veiculo)
      where b.ind_tipo_veiculo = 'P'
      and b.ind_status = 'A'
  
      union all
  
      select sum(b.valor_investido_proprio) as valor
      from tab_veiculo b
      where b.ind_tipo_veiculo = 'I'
      and b.ind_status = 'A'
      
      union all
      
      select sum(b.val_compra) as valor
      from tab_veiculo b
      where b.ind_tipo_veiculo = 'P'
      and b.ind_status = 'A'
      ) as subquery;`)

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: ativos.rows
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em buscar informaçoes de ativos/passivos, tente novamente. " + error
    });
  }

};

exports.buscaParceiros = async (req, res) =>{

  try {
    await db.queryGaragem("BEGIN");

    const parceiros = await db.queryGaragem("select * from tab_parceiros")

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: parceiros.rows
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em buscar parceiros, tente novamente. " + error
    });
  }

};

exports.atualizaVeiculoAutoscar = async (req, res) =>{

  const { seq_veiculo, des_veiculo, placa, val_venda, val_venda_esperado, id_integracao, renavam, chassis, km, ano, des_veiculo_completa,
          img_veiculo, img_veiculo_1, img_veiculo_2, img_veiculo_3, img_veiculo_4, img_veiculo_5, img_veiculo_6 } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`
    UPDATE tab_veiculo SET
      des_veiculo = $1,
      placa = $2,
      val_venda = $3,
      val_venda_esperado = $4,
      id_integracao = $5,
      renavam = $6,
      chassis = $7,
      km = $8,
      ano = $9,
      des_veiculo_completa = $10,
      img_veiculo = $11,
      img_veiculo_1 = $12,
      img_veiculo_2 = $13,
      img_veiculo_3 = $14,
      img_veiculo_4 = $15,
      img_veiculo_5 = $16,
      img_veiculo_6 = $17
    WHERE seq_veiculo = $18;
  `,[des_veiculo, placa, val_venda, val_venda_esperado, id_integracao, renavam, chassis, km, ano, des_veiculo_completa,
    img_veiculo, img_veiculo_1, img_veiculo_2, img_veiculo_3, img_veiculo_4, img_veiculo_5, img_veiculo_6, seq_veiculo])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Atualização Efetuada com Sucesso"
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em buscar parceiros, tente novamente. " + error
    });
  }

};


exports.alteraStatusVeiculo = async (req, res) =>{

  const { seq_veiculo, status } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`update tab_veiculo set status = '' where seq_veiculo = $1`,[ seq_veiculo])
    await db.queryGaragem(`update tab_veiculo set status = $1 where seq_veiculo = $2`,[status, seq_veiculo])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Status atualizado com sucesso"
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em atualizar status, tente novamente. " + error
    });
  }

};



exports.removerVeiculo = async (req, res) =>{

  const { seq_veiculo, motivo } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    await db.queryGaragem(`update tab_veiculo set ind_status = 'X', motivo_exclusao = $2 where seq_veiculo = $1`,[ seq_veiculo, motivo ])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Exclusão realizada com Sucesso."
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha em atualizar status, tente novamente. " + error
    });
  }

};

exports.despesaReceita = async (req, res) =>{

  const { dataInicial, dataFinal } = req.body;

  try {
    await db.queryGaragem("BEGIN");

    const despesas = await db.queryGaragem(`WITH meses AS (
                                                SELECT generate_series(0, 11) AS num
                                            ),
                                            ultimos_meses AS (
                                                SELECT 
                                                    EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                    EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                    TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM') || ' ' || 
                                                    TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'YYYY') AS nome_mes
                                                FROM meses
                                            )
                                            SELECT 
                                                u.mes,
                                                u.nome_mes,
                                                COALESCE(SUM(v.val_movimento), 0) AS VALOR
                                            FROM ultimos_meses u
                                            LEFT JOIN tab_movimentacao v 
                                                ON EXTRACT(YEAR FROM v.data) = u.ano 
                                                AND EXTRACT(MONTH FROM v.data) = u.mes
                                                AND v.tipo_movimento IN ('DA', 'DF', 'RS')
                                            GROUP BY u.ano, u.mes, u.nome_mes, u.ano
                                            ORDER BY u.ano, u.mes;`)

    const receitas = await db.queryGaragem(`WITH meses AS (
                                                SELECT generate_series(0, 11) AS num
                                            ),
                                            ultimos_meses AS (
                                                SELECT 
                                                    EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month' * num) AS ano,
                                                    EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month' * num) AS mes,
                                                    TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'FMMM') || ' ' || 
                                                    TO_CHAR(CURRENT_DATE - INTERVAL '1 month' * num, 'YYYY') AS nome_mes
                                                FROM meses
                                            )
                                            SELECT 
                                                u.mes,
                                                u.nome_mes,
                                                COALESCE(SUM(subquery.VALOR), 0) AS VALOR
                                            FROM ultimos_meses u
                                            LEFT JOIN (
                                                -- Obtendo valores de tab_movimentacao
                                                SELECT 
                                                    EXTRACT(YEAR FROM v.data) AS ano,
                                                    EXTRACT(MONTH FROM v.data) AS mes,
                                                    COALESCE(SUM(v.val_movimento), 0) AS VALOR
                                                FROM tab_movimentacao v
                                                WHERE v.tipo_movimento IN ('RF', 'TF', 'CL')
                                                GROUP BY ano, mes

                                                UNION ALL

                                                -- Obtendo valores de tab_lucro_retirada
                                                SELECT 
                                                    EXTRACT(YEAR FROM v.data) AS ano,
                                                    EXTRACT(MONTH FROM v.data) AS mes,
                                                    COALESCE(SUM(v.val_lucro), 0) AS VALOR
                                                FROM tab_lucro_retirada v
                                                WHERE v.ind_tipo IN ('VV')
                                                GROUP BY ano, mes
                                            ) AS subquery
                                            ON subquery.ano = u.ano AND subquery.mes = u.mes
                                            GROUP BY u.mes, u.nome_mes, u.ano
                                            ORDER BY u.ano, u.mes;

                                            `)

    const totalDespesa = await db.queryGaragem(`SELECT 
                                                COALESCE(SUM(v.val_movimento), 0) AS VALOR
                                            FROM tab_movimentacao v 
                                                where v.data BETWEEN $1 AND $2
                                                AND v.tipo_movimento IN ('DA', 'DF', 'RS')`,['2024.01.01',dataFinal])


    const totalReceita = await db.queryGaragem(`
                                              SELECT SUM(VALOR) AS VALOR
                                              FROM (
                                                  SELECT 
                                                      COALESCE(SUM(v.val_movimento), 0) AS VALOR
                                                  FROM tab_movimentacao v
                                                  WHERE v.data BETWEEN $1 AND $2
                                                  AND v.tipo_movimento IN ('RF', 'TF', 'CL')

                                                  UNION ALL

                                                  SELECT 
                                                      COALESCE(SUM(v.val_lucro), 0) AS VALOR
                                                  FROM tab_lucro_retirada v
                                                  WHERE v.data BETWEEN $1 AND $2
                                                  AND v.ind_tipo IN ('VV')
                                              ) AS subquery`,['2024.01.01',dataFinal])

    await db.queryGaragem("COMMIT");

    res.status(200).json({
      message: "Consulta realizada com Sucesso.",
      despesas: despesas.rows,
      receitas: receitas.rows,
      totalDespesa: totalDespesa.rows,
      totalReceita: totalReceita.rows
    });
    
  } catch (error) {
    try {
      await db.queryGaragem("ROLLBACK");
    } catch (rollbackError) {
      console.error("Erro ao fazer o rollback: ", rollbackError);
    }

    // Enviar a resposta com status 500 e a mensagem de erro
    res.status(500).json({
      message: "Falha buscar despesa x receitas, tente novamente. " + error
    });
  }

};