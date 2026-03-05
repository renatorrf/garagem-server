const router = require("express-promise-router")();
const autoscar = require("../controllers/integrador-autoscar.controller");
const garagemWeb = require("../controllers/garagemweb.controller");

//busca geral de integradores

router.post("/buscaIntegradoresAtivos", garagemWeb.buscaIntegradoresAtivos);

//Rotas Autoscar



router.get("/buscaMarcaAutoscar", autoscar.buscaMarca); 

router.get("/buscaMarcaModeloAutoscar", autoscar.buscaMarcaModelo); 

router.get("/buscaMarcaModeloVersaoAutoscar", autoscar.buscaMarcaModeloVersao); 

router.post("/salvarAutosCar", autoscar.salvarAutosCar); 

router.post("/buscaDadosAutoscar", autoscar.buscaDadosAutoscar); 

router.post("/analisaVeiculoAutosCar", autoscar.analisaVeiculoAutosCar);

module.exports = router;