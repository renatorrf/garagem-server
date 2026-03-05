/**
 * arquivo: routes/index.js
 * descriçao: arquivo responsavel pela chamada da API na aplicaçao no lado do back-end
 * data: 14/03/2022
 * autor: Renato Filho
*/

const express = require("express"); // sempre instanciar o express numa variavel pois ele fará a rota de acesso


const router = express.Router();

router.get("/api", (req, res) => {
     res.status(200).send({
        success: "Voce conseguiu! HTTPS",
        message: "Seja bem vindo a API node.js + PostgreSQL + Ionic(Angular)",
        version: "1.0.0"
    });
});


module.exports = router;