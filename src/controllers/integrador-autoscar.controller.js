const axios = require('axios');
const db = require("../config/database");
const moment = require('moment');
const { getSchemaFromReq } = require('../utils/tenantContext');
const TenantIntegrationService = require('../services/TenantIntegrationService');

const token = null;

exports.buscaMarca = async (req, res) => {
    const type = 1;
    const baseUrl = 'https://dhqmwf73sb.execute-api.us-east-1.amazonaws.com/prd/brand';
    const schema = getSchemaFromReq(req) || 'integrador_autoscar'
    
    try {
        // 1. Faz a solicitação HTTP
        const response = await axios.get(`${baseUrl}?type=${type}`);
        const marcas = response.data; // Recebe o array diretamente
        
        console.log('Resposta da API:', marcas);
        console.log('URL:', `${baseUrl}?type=${type}`);

        // 2. Insere no banco de dados
        await db.transaction(async (client) => {

            await client.query(`DELETE FROM ${schema}.tab_marca`)
            const insertQuery = `
                INSERT INTO ${schema}.tab_marca (id, "idFipe", name, status)
                VALUES ($1, $2, UPPER($3), $4)
            `;

            // Insere todas as marcas
            for (const marca of marcas) {
                await client.query(insertQuery, [
                    marca.id,
                    marca.idFipe,
                    marca.name,
                    marca.status
                ]);
            }

            await client.query(`UPDATE ${schema}.tab_marca
                                SET name = unaccent(name)
                                WHERE name ~ '[áéíóúâêîôûãõäëïöüçýñÁÉÍÓÚÂÊÎÔÛÃÕÄËÏÖÜÇÝÑ]';`)
        });

        // 3. Retorna resposta única
        res.status(200).json({
            success: true,
            message: "Marcas atualizadas com sucesso",
            totalRecords: marcas.length,
            data: marcas
        });
        
    } catch (error) {
        console.error('Erro no processo:', error);
        
        res.status(500).json({
            success: false,
            message: "Falha no processo de marcas",
            error: error.message,
            details: error.response?.data || null
        });
    }
};

exports.buscaMarcaModelo = async (req, res) => {
    const type = 1;
    const baseUrl = 'https://dhqmwf73sb.execute-api.us-east-1.amazonaws.com/prd/model/findByBrand/';
    const schema = getSchemaFromReq(req) || 'integrador_autoscar';
    
    // Configurações ajustáveis
    const config = {
        timeout: 15000, // 15 segundos (aumentado)
        retries: 2,     // Número de tentativas
        delayBetweenRequests: 1000 // 1 segundo entre requisições
    };

    try {
        // 1. Obter marcas do banco de dados
        const marcas = await db.query(`
            SELECT id as cod_marca, name
            FROM ${schema}.tab_marca 
        `);
        
        if (!marcas.rows || marcas.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Nenhuma marca ativa encontrada no banco de dados"
            });
        }

        // 2. Coletar todos os modelos com tratamento de erro robusto
        const todosModelos = [];
        const marcasComErro = [];

        // Processar marcas em série com delay
        for (const [index, marca] of marcas.rows.entries()) {
            // Delay progressivo para evitar sobrecarga
            if (index > 0) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }

            let tentativas = 0;
            let success = false;
            
            while (tentativas < config.retries && !success) {
                tentativas++;
                try {
                    const url = `${baseUrl}${encodeURIComponent(marca.name)}?type=${type}`;
                    console.log(`Coletando modelos para: ${marca.name} (Tentativa ${tentativas})`);
                    
                    const response = await axios.get(url, { 
                        timeout: config.timeout 
                    });
                    
                    const modelos = response.data;

                    if (!Array.isArray(modelos)) {
                        throw new Error(`Resposta inválida: ${typeof modelos}`);
                    }

                    // Adiciona ao array de todos os modelos
                    modelos.forEach(modelo => {
                        todosModelos.push({
                            cod_marca: marca.cod_marca,
                            name: modelo.toString().toUpperCase().trim(),
                            name_marca: marca.name
                        });
                    });

                    console.log(`Coletados ${modelos.length} modelos para ${marca.name}`);
                    success = true;

                } catch (error) {
                    console.error(`Erro na tentativa ${tentativas} para ${marca.name}:`, error.message);
                    
                    if (tentativas >= config.retries) {
                        marcasComErro.push({
                            marca: marca.name,
                            error: error.message
                        });
                    }
                }
            }
        }

        // 3. Fazer inserção única em transação (mesmo código anterior)
        if (todosModelos.length > 0) {
            await db.transaction(async (client) => {
                // Limpar modelos existentes
                await client.query(`
                    DELETE FROM ${schema}.tab_marca_modelo 
                    WHERE cod_marca = ANY($1::int[])
                `, [marcas.rows.map(m => m.cod_marca)]);
                
                // Preparar arrays para UNNEST
                const codMarcas = todosModelos.map(m => m.cod_marca);
                const nomesModelos = todosModelos.map(m => m.name);
                const nomesMarca = todosModelos.map(m => m.name_marca);
                
                // Inserção única em lote
                await client.query(`
                    INSERT INTO ${schema}.tab_marca_modelo (cod_marca, name, name_marca)
                    SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[])
                    ON CONFLICT (cod_marca, name, name_marca) DO NOTHING
                `, [codMarcas, nomesModelos, nomesMarca]);

                await client.query(`
                    DELETE FROM ${schema}.tab_marca_modelo 
                    WHERE name IN ($1, $2)
                  `, ['AUTOSCAR', '']);

                await client.query(`UPDATE ${schema}.tab_marca_modelo
                    SET name_marca = unaccent(name_marca)
                    WHERE name_marca ~ '[áéíóúâêîôûãõäëïöüçýñÁÉÍÓÚÂÊÎÔÛÃÕÄËÏÖÜÇÝÑ]';`)
            });
        }

        // 4. Retornar resposta
        res.status(200).json({
            success: true,
            message: "Processo concluído",
            estatisticas: {
                totalMarcas: marcas.rows.length,
                marcasProcessadas: marcas.rows.length - marcasComErro.length,
                modelosInseridos: todosModelos.length,
                marcasComErro: marcasComErro.length > 0 ? marcasComErro : null,
                configuracao: {
                    timeout: config.timeout,
                    tentativas: config.retries
                }
            }
        });
        
    } catch (error) {
        console.error('Erro no processo principal:', error);
        res.status(500).json({
            success: false,
            message: "Falha no processo",
            error: error.message
        });
    }
};

exports.buscaMarcaModeloVersao = async (req, res) => {
    const type = 1;
    const baseUrl = 'https://dhqmwf73sb.execute-api.us-east-1.amazonaws.com/prd/model/findByBrandModel/';
    const schema = getSchemaFromReq(req) || 'integrador_autoscar';
    
    // Configurações ajustáveis
    const config = {
        timeout: 15000, // 15 segundos (aumentado)
        retries: 2,     // Número de tentativas
        delayBetweenRequests: 1000 // 1 segundo entre requisições
    };

    try {
        // 1. Obter marcas do banco de dados
        const marcas = await db.query(`
            SELECT seq_registro as id, name, name_marca
            FROM ${schema}.tab_marca_modelo
        `);
        
        if (!marcas.rows || marcas.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Nenhuma marca ativa encontrada no banco de dados"
            });
        }

        // 2. Coletar todos os modelos com tratamento de erro robusto
        const todosModelos = [];
        const marcasComErro = [];

        // Processar marcas em série com delay
        for (const [index, marca] of marcas.rows.entries()) {
            // Delay progressivo para evitar sobrecarga
            if (index > 0) {
                await new Promise(resolve => setTimeout(resolve, config.delayBetweenRequests));
            }

            let tentativas = 0;
            let success = false;
            
            while (tentativas < config.retries && !success) {
                tentativas++;
                try {
                    const url = `${baseUrl}${encodeURIComponent(marca.name_marca)}/${marca.name}/?type=${type}`;
                    console.log(`Coletando modelos para: ${marca.name_marca} - ${marca.name} (Tentativa ${tentativas})`);
                    
                    const response = await axios.get(url, { 
                        timeout: config.timeout 
                    });
                    
                    const modelos = response.data;

                    if (!Array.isArray(modelos)) {
                        throw new Error(`Resposta inválida: ${typeof modelos}`);
                    }

                    // Adiciona ao array de todos os modelos
                    modelos.forEach(modelo => {
                        todosModelos.push({
                            id: modelo.id,
                            name: modelo.name.toString().toUpperCase().trim(),
                            fabricationYear: modelo.fabricationYear,
                            modelYear: modelo.modelYear,
                            version: modelo.version.toString().toUpperCase(),
                            motor: modelo.motor,
                            brandName: modelo.brandName,
                            seq_marca: marca.id
                        });
                    });

                    console.log(`Coletados ${modelos.length} modelos para ${marca.name_marca} - ${marca.name}`);
                    success = true;

                } catch (error) {
                    console.error(`Erro na tentativa ${tentativas} para ${marca.name_marca} - ${marca.name}:`, error.message);
                    
                    if (tentativas >= config.retries) {
                        marcasComErro.push({
                            marca: marca.name,
                            error: error.message
                        });
                    }
                }
            }
        }

        // 3. Fazer inserção única em transação (mesmo código anterior)
        if (todosModelos.length > 0) {
            await db.transaction(async (client) => {
                // Limpar modelos existentes
                await client.query(`
                    DELETE FROM ${schema}.tab_marca_versao
                    WHERE seq_marca = ANY($1::int[])
                `, [marcas.rows.map(m => m.id)]);
                
                // Preparar arrays para UNNEST
                const id = todosModelos.map(m => m.id);
                const name = todosModelos.map(m => m.name);
                const fabricationYear = todosModelos.map(m => m.fabricationYear);
                const modelYear = todosModelos.map(m => m.modelYear);
                const version = todosModelos.map(m => m.version);
                const motor = todosModelos.map(m => m.motor);
                const brandName = todosModelos.map(m => m.brandName);
                const seq_marca = todosModelos.map(m => m.seq_marca);

                
                // Inserção única em lote
                await client.query(`
                    INSERT INTO ${schema}.tab_marca_versao (id, name, "fabricationYear", "modelYear", version, motor, "brandName", seq_marca)
                    SELECT * FROM UNNEST($1::int[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::int[])
                    ON CONFLICT (id, name, "fabricationYear", "modelYear", version, motor, "brandName", seq_marca) DO NOTHING
                `, [id, name, fabricationYear, modelYear, version, motor, brandName, seq_marca]);
            });
        }

        // 4. Retornar resposta
        res.status(200).json({
            success: true,
            message: "Processo concluído",
            estatisticas: {
                totalMarcas: marcas.rows.length,
                marcasProcessadas: marcas.rows.length - marcasComErro.length,
                modelosInseridos: todosModelos.length,
                marcasComErro: marcasComErro.length > 0 ? marcasComErro : null,
                configuracao: {
                    timeout: config.timeout,
                    tentativas: config.retries
                }
            }
        });
        
    } catch (error) {
        console.error('Erro no processo principal:', error);
        res.status(500).json({
            success: false,
            message: "Falha no processo",
            error: error.message
        });
    }
};

exports.salvarAutosCar = async (req, res) => {
    const { seq_registro, usuario, senha, connected, mensagem_predefinida } = req.body;
    const schema = getSchemaFromReq(req);
    
    // Validação dos campos obrigatórios
    if (!usuario || !senha) {
        return res.status(400).json({
            success: false,
            message: 'Usuário e senha são obrigatórios'
        });
    }

    const baseUrl = 'https://dhqmwf73sb.execute-api.us-east-1.amazonaws.com/prd/auth/login';

    try {
        // Fazendo a requisição para a API da AutosCar
        const response = await axios.post(baseUrl, {
            email: usuario,
            password: senha
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Se chegou aqui, a autenticação foi bem-sucedida
        const token = response.data.token;

        await TenantIntegrationService.upsertIntegration('autoscar', {
            schema,
            integrationName: 'AutosCar',
            externalId: String(seq_registro),
            config: { usuario, mensagemPredefinida: mensagem_predefinida },
            secret: senha,
            token,
            isActive: true,
            metadata: { connected: !!token, connectedAt: new Date().toISOString() },
        });

        await db.transaction(async (client) => {

            const insertQuery = `
                UPDATE ${schema}.tab_integradores 
                SET usuario = $1, 
                    senha = $2, 
                    mensagem_predefinida = $3, 
                    ind_status = $4, 
                    connected = $5,
                    token = $6
                where seq_registro = $7
                `;

            const values =  [ usuario, senha, mensagem_predefinida, true , token ? true : false, token, seq_registro ]

            await client.query(insertQuery, values);
        });

        return res.status(200).json({
            success: true,
            message: 'Autenticação realizada com sucesso',
            //token: token,
            connected: true
        });
    } catch (error) {
        console.error('Erro na integração com AutosCar:', error);
        
        // Tratamento específico para erro de autenticação
        if (error.response && error.response.data && error.response.data.error) {
            return res.status(401).json({
                success: false,
                message: 'Credenciais inválidas',
                details: error.response.data.error.message
            });
        }
        
        // Tratamento para outros tipos de erro
        return res.status(500).json({
            success: false,
            message: 'Erro ao conectar com o serviço AutosCar',
            details: error.message
        });
    }
};

exports.buscaDadosAutoscar = async (req, res) => {
    const { seq_registro } = req.body;
    const schema = getSchemaFromReq(req);
    
    try {
        const result = await db.transaction(async (client) => {
            const query = `SELECT seq_registro, usuario, senha, mensagem_predefinida, ind_status, connected FROM ${schema}.tab_integradores WHERE seq_registro = $1`;
            const values = [seq_registro];
            
            const queryResult = await client.query(query, values);
            
            // Retorna apenas os dados relevantes para o front
            return {
                rows: queryResult.rows,
                rowCount: queryResult.rowCount
            };
        });
        
        // Se chegou aqui, a transação foi bem-sucedida
        return res.status(200).json({
            success: true,
            message: 'Operação realizada com sucesso',
            registros: result.rows[0],
        });
        
    } catch (error) {
        console.error('Erro na operação:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar a requisição no servidor',
            details: error.message,
            errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

exports.analisaVeiculoAutosCar = async (req, res) => {
    const { veiculo } = req.body;
    const schema = getSchemaFromReq(req);
    console.log(veiculo.des_veiculo)
    const modelo_completo = veiculo.des_veiculo.toUpperCase();
    const cambioProcurado = veiculo.cambio.toUpperCase(); // 'MANUAL' ou 'AUTOMATICO'

    try {
        const result = await db.transaction(async (client) => {
            // Extrai marca e modelo base do nome completo
            const partesModelo = modelo_completo.split(' ');
            console.log('partes modelo',partesModelo)
            const marcaBase = veiculo.marca; // Primeira palavra é a marca
            const modeloBase = veiculo.modelo || ''; // Segunda palavra é o modelo base
            
            console.log('select autoscar',marcaBase, modeloBase, veiculo.ano_fabricacao, veiculo.ano_modelo)
            const query = `SELECT a.*, b.name_marca from ${schema}.tab_marca_versao a
                          inner join ${schema}.tab_marca_modelo b on (a.seq_marca = b.seq_registro)
                          WHERE b.name_marca like $1
                          AND A.name like $2
                          AND A."fabricationYear" = $3
                          and a."modelYear" = $4`;
            const values = [marcaBase, modeloBase, veiculo.ano_fabricacao, veiculo.ano_modelo];

            console.log(query, values)
            
            const queryResult = await client.query(query, values);
            
            if (queryResult.rowCount === 0) {
                return { rows: [], rowCount: 0 };
            }

            // Palavras-chave do modelo completo (excluindo marca e modelo base)
            const palavrasChave = partesModelo
                .filter(word => word !== marcaBase && word !== modeloBase)
                .map(word => word.toUpperCase());


            // Normaliza o câmbio procurado para padrão de comparação
            const cambioNormalizado = cambioProcurado.includes('AUTO') ? 'AUT' : 
                                    cambioProcurado.includes('MEC') || cambioProcurado.includes('MANUAL') ? 'MEC' : '';

            // Adiciona pontuação a cada versão
            const versoesComPontuacao = queryResult.rows.map(versao => {
                const versaoUpper = versao.version.toUpperCase();
                let pontuacao = 0;
                let palavrasEncontradas = [];
                let cambioEncontrado = '';

                // 1. Verifica palavras-chave do modelo
                palavrasChave.forEach(palavra => {
                    // Define pesos diferentes para tipos de características
                    let peso = 10; // Valor padrão
                    
                    // Aumenta peso para motorizações (1.0, 2.0, etc.)
                    if (palavra.match(/^\d+\.\d+$/)) peso = 50;
                    
                    // Aumenta peso para siglas importantes (TIVCT, GTDI, AWD, etc.)
                    else if (palavra.match(/^(TIVCT|GTDI|GTI|AWD|FWD|VVT|CVT|TURBO|SE|SE\/SE|SE PLUS)$/)) peso = 20;
                    
                    // Aumenta peso para tipos de combustível (FLEX, GASOLINA, DIESEL, etc.)
                    else if (palavra.match(/^(FLEX|GASOLINA|DIESEL|ELETRICO|HIBRIDO)$/)) peso = 15;
                
                    // Busca a palavra na versão do veículo
                    const posicao = versaoUpper.indexOf(palavra);
                    
                    if (posicao >= 0) {
                        // Pontuação base pelo encontro da palavra
                        pontuacao += peso;
                        palavrasEncontradas.push(palavra);
                        
                        // Bônus por posição (quanto mais no início, maior o bônus)
                        const posicaoBonus = Math.max(0, 10 - (posicao / 3));
                        pontuacao += posicaoBonus;
                        
                        // Bônus por correspondência exata (se a palavra está isolada)
                        const regex = new RegExp(`(^|\\s)${palavra}($|\\s)`);
                        if (regex.test(versaoUpper)) {
                            pontuacao += 8;
                        }
                        
                        // Bônus adicional se for uma característica importante no início
                        if (posicao < 15 && peso >= 20) {
                            pontuacao += 5;
                        }
                    }
                    
                    // Penaliza versões que contêm termos não procurados (opcional)
                    if (versaoUpper.includes(' PLUS ') && !palavrasChave.includes('PLUS')) {
                        pontuacao -= 3;
                    }
                });

                // 2. Verifica câmbio (50 pontos se coincidir)
                if (versaoUpper.includes(' AUT ') || versaoUpper.includes(' AUT.') || versaoUpper.includes(' AUTOMAT')) {
                    cambioEncontrado = 'AUTOMATICO';
                    if (cambioNormalizado === 'AUT') {
                        pontuacao += 50;
                    }
                } 
                else if (versaoUpper.includes(' MEC ') || versaoUpper.includes(' MEC.') || versaoUpper.includes(' MANUAL')) {
                    cambioEncontrado = 'MANUAL';
                    if (cambioNormalizado === 'MEC') {
                        pontuacao += 50;
                    }
                }

                return {
                    ...versao,
                    pontuacao,
                    palavrasEncontradas,
                    cambioEncontrado,
                    cambioCoincide: (cambioNormalizado && cambioEncontrado) ? 
                                    (cambioNormalizado === 'AUT' && cambioEncontrado === 'AUTOMATICO') || 
                                    (cambioNormalizado === 'MEC' && cambioEncontrado === 'MANUAL') : false
                };
            });

            // Ordena pela maior pontuação
            versoesComPontuacao.sort((a, b) => b.pontuacao - a.pontuacao);

            return {
                rows: versoesComPontuacao,
                rowCount: queryResult.rowCount,
                melhorMatch: versoesComPontuacao[0],
                parametrosBusca: {
                    marca: marcaBase,
                    modelo: modeloBase,
                    cambio: cambioProcurado,
                    palavrasChave
                }
            };
        });
        
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum veículo encontrado com os critérios informados'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Operação realizada com sucesso',
            registros: result.rows,
            melhorMatch: result.melhorMatch,
            parametrosBusca: result.parametrosBusca,
            modeloProcurado: modelo_completo,
            cambioProcurado
        });
        
    } catch (error) {
        console.error('Erro na operação:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar a requisição no servidor',
            details: error.message,
            errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};


// exports.analisaVeiculoAutosCar = async (req, res) => {
//     const { veiculo } = req.body;
//     const schema = getSchemaFromReq(req);
//     const modelo_completo = veiculo.des_veiculo.toUpperCase();
//     const cambioProcurado = veiculo.cambio.toUpperCase();

//     try {
//         const result = await db.transaction(async (client) => {
//             // Extrai marca e modelo base do nome completo
//             const partesModelo = modelo_completo.split(/\s+/);
//             const marcaBase = partesModelo[0];
//             const modeloBase = partesModelo[1] || '';
            
//             // Identifica palavras-chave mais relevantes (ignora artigos, versões básicas)
//             const palavrasIgnorar = new Set([marcaBase, modeloBase]);
//             const palavrasChave = partesModelo
//                 .filter(word => !palavrasIgnorar.has(word))
//                 .map(word => word.replace(/[^A-Z0-9.]/g, '')) // Remove caracteres especiais
//                 .filter(word => word.length > 1); // Ignora palavras muito curtas

//             const query = `SELECT a.*, b.name_marca from ${schema}.tab_marca_versao a
//                           inner join ${schema}.tab_marca_modelo b on (a.seq_marca = b.seq_registro)
//                           WHERE b.name_marca like $1
//                           AND A.name like $2
//                           AND A."fabricationYear" = $3
//                           and a."modelYear" = $4`;
//             const values = [marcaBase, modeloBase, veiculo.ano_fabricacao, veiculo.ano_modelo];
            
//             const queryResult = await client.query(query, values);
            
//             if (queryResult.rowCount === 0) {
//                 return { rows: [], rowCount: 0 };
//             }

//             // Normaliza o câmbio procurado
//             const cambioNormalizado = cambioProcurado.includes('AUTO') ? 'AUT' : 
//                                     cambioProcurado.includes('MEC') || cambioProcurado.includes('MANUAL') ? 'MEC' : '';

//             // Adiciona pontuação ponderada a cada versão
//             const versoesComPontuacao = queryResult.rows.map(versao => {
//                 const versaoUpper = versao.version.toUpperCase();
//                 let pontuacao = 0;
//                 let palavrasEncontradas = [];
//                 let cambioEncontrado = '';

//                 // Verifica cada palavra-chave com pesos diferentes
//                 palavrasChave.forEach(palavra => {
//                     // Motorização tem peso maior
//                     const peso = palavra.match(/^\d+\.\d+$/) ? 20 : 10;
                    
//                     if (versaoUpper.includes(palavra)) {
//                         pontuacao += peso;
//                         palavrasEncontradas.push(palavra);
                        
//                         // Bônus por posição (se aparecer no início)
//                         const posicao = versaoUpper.indexOf(palavra);
//                         if (posicao < 30) pontuacao += 5;
//                     }
//                 });

//                 // Verifica câmbio (50 pontos se coincidir)
//                 if (versaoUpper.includes(' AUT ') || versaoUpper.includes(' AUT.') || versaoUpper.includes(' AUTOMAT')) {
//                     cambioEncontrado = 'AUTOMATICO';
//                     if (cambioNormalizado === 'AUT') pontuacao += 50;
//                 } 
//                 else if (versaoUpper.includes(' MEC ') || versaoUpper.includes(' MEC.') || versaoUpper.includes(' MANUAL')) {
//                     cambioEncontrado = 'MANUAL';
//                     if (cambioNormalizado === 'MEC') pontuacao += 50;
//                 }

//                 // Penaliza versões muito longas (indica que tem muitos extras não procurados)
//                 const lengthPenalty = Math.max(0, versaoUpper.split(/\s+/).length - palavrasChave.length - 5) * 3;
//                 pontuacao -= lengthPenalty;

//                 return {
//                     ...versao,
//                     pontuacao,
//                     palavrasEncontradas,
//                     cambioEncontrado,
//                     cambioCoincide: cambioNormalizado && cambioEncontrado && 
//                                    ((cambioNormalizado === 'AUT' && cambioEncontrado === 'AUTOMATICO') || 
//                                     (cambioNormalizado === 'MEC' && cambioEncontrado === 'MANUAL'))
//                 };
//             });

//             // Ordena pela maior pontuação
//             versoesComPontuacao.sort((a, b) => b.pontuacao - a.pontuacao);

//             return {
//                 rows: versoesComPontuacao,
//                 rowCount: queryResult.rowCount,
//                 melhorMatch: versoesComPontuacao[0],
//                 parametrosBusca: {
//                     marca: marcaBase,
//                     modelo: modeloBase,
//                     cambio: cambioProcurado,
//                     palavrasChave,
//                     palavrasIgnoradas: Array.from(palavrasIgnorar)
//                 }
//             };
//         });
        
//         if (result.rowCount === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Nenhum veículo encontrado com os critérios informados'
//             });
//         }

//         return res.status(200).json({
//             success: true,
//             message: 'Operação realizada com sucesso',
//             registros: result.rows,
//             melhorMatch: result.melhorMatch,
//             parametrosBusca: result.parametrosBusca,
//             modeloProcurado: modelo_completo,
//             cambioProcurado
//         });
        
//     } catch (error) {
//         console.error('Erro na operação:', error);
//         return res.status(500).json({
//             success: false,
//             message: 'Erro ao processar a requisição no servidor',
//             details: error.message,
//             errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
//         });
//     }
// };