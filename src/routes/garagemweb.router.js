/**
 * arquivo: routes/fasthelproutes.js
 * descriçao: arquivo responsavel pelas rotas da API
 * data: 14/03/2022
 * autor: Renato Filho
*/

const router = require("express-promise-router")();
const garagemWeb = require("../controllers/garagemweb.controller");
const leadController = require('../controllers/leadController');
const drfGaragem = require("../controllers/drfWebGaragem.controller");

//=> Definindo as rotas do CRUD - Fasthelp

// => Rota para criar/inserir usuario : (POST) : localhost:3000/api/fasthelp-createUser
//festhelp-user abaixo é a rota que insere no postman para acessar esse metodo (createUser).

router.post("/cadastraVeiculo", garagemWeb.cadastraVeiculo);

router.post("/buscaVeiculo", garagemWeb.buscaVeiculo);  
router.post("/excluirVeiculo", garagemWeb.excluirVeiculo);  
router.post("/buscaImgVeiculo", garagemWeb.buscaImgVeiculo);  
router.post("/salvaVeiculo", garagemWeb.salvaVeiculo);  
router.post("/finalizaVendaVeiculo", garagemWeb.finalizaVendaVeiculo); 
router.post("/vinculaContratoVeiculo", garagemWeb.vinculaContratoVeiculo); 
router.post("/buscaCrlv", garagemWeb.crlv);
router.post("/buscaContrato", garagemWeb.contrato); 
router.post("/desfazerVenda", garagemWeb.desfazerVenda);

router.post("/cadastraCompromissoAgenda", garagemWeb.cadastraCompromissoAgenda);

router.post("/buscaCompromissosAgenda", garagemWeb.buscaCompromissosAgenda);

router.post("/cadastraParceiros", garagemWeb.cadastraParceiros);
router.post("/buscaParceiros", garagemWeb.buscaParceiros);
router.post("/editaParceiros", garagemWeb.editaParceiros); 
router.post("/registrarOperacaoParceiro", garagemWeb.registrarOperacaoParceiro); 
router.post("/buscaContaParceiro", garagemWeb.buscaContaParceiro); 

router.post("/cadastraDespesaFixa", garagemWeb.cadastraDespesaFixa); 
router.post("/buscaDespesasFixas", garagemWeb.buscaDespesasFixas); 
router.post("/editaDespesaFixa", garagemWeb.editaDespesaFixa);

router.post("/cadastraBanco", garagemWeb.cadastraBanco);
router.post("/buscaBanco", garagemWeb.buscaBanco);
router.post("/editaBanco", garagemWeb.editaBanco);

router.post("/cadastraCartao", garagemWeb.cadastraCartao);
router.post("/buscaCartao", garagemWeb.buscaCartao);
router.post("/editaCartao", garagemWeb.editaCartao);  

router.post("/vinculaBancoFinanceiras", garagemWeb.vinculaBancoFinanceiras);  
router.post("/buscaFinanceiras", garagemWeb.buscaFinanceiras);

router.post("/inserirMovimento", garagemWeb.inserirMovimento); 
router.post("/alteraMovimento", garagemWeb.alteraMovimento);  

router.post("/inserirDespesaVeiculo", garagemWeb.inserirDespesaVeiculo);
router.post("/buscaDespesaVeiculo", garagemWeb.buscaDespesaVeiculo); 

router.post("/buscaMovimentoFinanceiro", garagemWeb.buscaMovimentoFinanceiro); 
router.post("/importarFinanceiroOFX", garagemWeb.importarFinanceiroOFX); 
router.post("/conciliarEncontrados", garagemWeb.conciliarEncontrados); 
router.post("/updateMovimentoFinanceiro", garagemWeb.updateMovimentoFinanceiro);

router.post("/cadastraDespesaOperacional", garagemWeb.cadastraDespesaOperacional);
router.post("/buscaDespesaOperacional", garagemWeb.buscaDespesaOperacional); 

router.post("/faturaCartao", garagemWeb.faturaCartao); 
router.post("/buscafaturaCartao", garagemWeb.buscafaturaCartao); 
router.post("/liquidarFaturaCartao", garagemWeb.liquidarFaturaCartao); 
router.post("/buscaFinanciamentos", garagemWeb.buscaFinanciamentos); 
router.post("/receberFinanciamento", garagemWeb.receberFinanciamento);

router.post("/buscaCliente", garagemWeb.buscaCliente); 
router.post("/cadastrarCliente", garagemWeb.cadastrarCliente); 
router.post("/vinculaVeiculoCliente", garagemWeb.vinculaVeiculoCliente); 

router.post("/buscaDadosEmpresa", garagemWeb.buscaDadosEmpresa); 
router.post("/salvaDadosEmpresa", garagemWeb.salvaDadosEmpresa); 

router.post("/cadastroModeloContrato", garagemWeb.cadastroModeloContrato);  
router.post("/buscaModeloContrato", garagemWeb.buscaModeloContrato);
router.post("/salvaModeloContrato", garagemWeb.salvaModeloContrato);  

router.post("/cadastraVendedor", garagemWeb.cadastraVendedor); 
router.post("/buscaVendedor", garagemWeb.buscaVendedor); 
router.post("/salvaVendedor", garagemWeb.salvaVendedor);


module.exports = router;