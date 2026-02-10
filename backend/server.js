const { logger } = require('./otel-logs');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const { trace, metrics } = require('@opentelemetry/api');
require('dotenv').config();

// Helper: adiciona atributos ao span ativo do trace (visíveis no Splunk/OTel)
function setSpanAttributes(attrs) {
  const span = trace.getActiveSpan();
  if (span && attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) {
        const k = key.startsWith('app.') ? key : `app.${key}`;
        if (typeof value === 'object' && !Array.isArray(value)) {
          span.setAttribute(k, JSON.stringify(value));
        } else {
          span.setAttribute(k, value);
        }
      }
    }
  }
}

const app = express();
const port = process.env.PORT || 3000;

logger.info('Service started', {
  service: process.env.OTEL_SERVICE_NAME,
  version: process.env.SERVICE_VERSION,
  environment: process.env.DEPLOYMENT_ENVIRONMENT,
});

// Emit a simple custom metric to validate metrics pipeline for this service.
const meter = metrics.getMeter('app-metrics');
const startupCounter = meter.createCounter('app.startup', {
  description: 'Startup counter to validate metrics export',
});
startupCounter.add(1, {
  'service.name': process.env.OTEL_SERVICE_NAME,
  'deployment.environment': process.env.DEPLOYMENT_ENVIRONMENT,
  'service.version': process.env.SERVICE_VERSION,
});

// Middleware para parsing JSON
app.use(express.json());

// Configuração do pool de conexões PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'cotacoes',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});
pool.on('error', (error) => {
  logger.error('Erro no pool de conex?es do banco de dados', {
    error: error && error.message ? error.message : error,
  });
});


// Estado da conexão com o banco de dados
let isDatabaseConnected = false;
const DB_CHECK_INTERVAL = 5000; // Verificar conexão a cada 5 segundos

// Função para testar a conexão com o banco de dados
async function testDatabaseConnection() {
  try {
    await pool.query('SELECT 1');
    if (!isDatabaseConnected) {
      logger.info('Conexão com o banco de dados estabelecida');
      isDatabaseConnected = true;
      // Tentar inicializar a tabela quando a conexão for estabelecida
      await initDatabase();
    }
    return true;
  } catch (error) {
    if (isDatabaseConnected) {
      logger.warn('Conex?o com o banco de dados perdida', {
        error: error && error.message ? error.message : error,
      });
      isDatabaseConnected = false;
    } else {
      logger.warn('Falha ao conectar com o banco de dados', {
        error: error && error.message ? error.message : error,
      });
    }
    return false;
  }
}

// Função para inicializar a tabela audit
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit (
        id SERIAL PRIMARY KEY,
        endpoint VARCHAR(255) NOT NULL,
        request_data JSONB,
        response_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Tabela audit criada/verificada com sucesso');
  } catch (error) {
    logger.error('Erro ao inicializar banco de dados', { error: error.message });
  }
}

// Função auxiliar para salvar no audit (não bloqueia as APIs)
async function saveToAudit(endpoint, requestData, responseData) {
  // Só tenta salvar se o banco estiver conectado
  if (!isDatabaseConnected) {
    return; // Silenciosamente ignora se o banco não estiver disponível
  }
  
  try {
    await pool.query(
      'INSERT INTO audit (endpoint, request_data, response_data) VALUES ($1, $2, $3)',
      [endpoint, JSON.stringify(requestData), JSON.stringify(responseData)]
    );
  } catch (error) {
    // Se houver erro, marca como desconectado e continua funcionando
    logger.error('Erro ao salvar no audit', { error: error.message });
    isDatabaseConnected = false;
  }
}

// Iniciar verificação periódica da conexão
async function startDatabaseHealthCheck() {
  // Testar imediatamente
  await testDatabaseConnection();
  
  // Configurar verificação periódica
  setInterval(async () => {
    await testDatabaseConnection();
  }, DB_CHECK_INTERVAL);
  
  logger.info('Verificação de conexão com banco de dados iniciada', {
    interval_ms: DB_CHECK_INTERVAL,
  });
}

// Função para gerar sleep aleatório entre 10ms e 2s
function getRandomSleep() {
  const min = 10; // 10ms
  const max = 2000; // 2 segundos em milissegundos
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Rota /sleep - sleep dinâmico entre 500ms e 5s
app.get('/sleep', async (req, res) => {
  const minSleep = 500;
  const maxSleep = 5000;
  const sleepTime = Math.floor(Math.random() * (maxSleep - minSleep + 1)) + minSleep;
  
  const requestData = { sleepTime };
  
  await new Promise(resolve => setTimeout(resolve, sleepTime));
  
  const responseData = {
    message: 'Sleep concluído',
    sleepTime: `${sleepTime}ms`,
    timestamp: new Date().toISOString()
  };

  setSpanAttributes({ sleep_ms: sleepTime, endpoint: '/sleep' });
  
  await saveToAudit('/sleep', requestData, responseData);
  
  res.json(responseData);
});

// Rota /cotacao/dolar - chamar API externa
app.get('/cotacao/dolar', async (req, res) => {
  const requestData = {};
  
  try {
    const response = await axios.get('https://br.dolarapi.com/v1/cotacoes/usd');
    const responseData = response.data;

    setSpanAttributes({ endpoint: '/cotacao/dolar', cotacao: responseData?.compra ?? responseData?.bid ?? responseData?.valor });
    
    await saveToAudit('/cotacao/dolar', requestData, responseData);
    
    // Sleep aleatório entre 10ms e 2s
    const sleepTime = getRandomSleep();
    setSpanAttributes({ sleep_ms: sleepTime });
    await new Promise(resolve => setTimeout(resolve, sleepTime));
    
    res.json(responseData);
  } catch (error) {
    setSpanAttributes({ endpoint: '/cotacao/dolar', error: error.message });
    const errorResponse = {
      error: 'Erro ao buscar cotação do dólar',
      message: error.message
    };
    
    await saveToAudit('/cotacao/dolar', requestData, errorResponse);
    
    res.status(500).json(errorResponse);
  }
});

// Rota /cotacao/euro - chamar API externa
app.get('/cotacao/euro', async (req, res) => {
  const requestData = {};
  
  try {
    const response = await axios.get('https://br.dolarapi.com/v1/cotacoes/eur');
    const responseData = response.data;

    setSpanAttributes({ endpoint: '/cotacao/euro', cotacao: responseData?.compra ?? responseData?.bid ?? responseData?.valor });
    
    await saveToAudit('/cotacao/euro', requestData, responseData);
    
    // Sleep aleatório entre 10ms e 2s
    const sleepTime = getRandomSleep();
    setSpanAttributes({ sleep_ms: sleepTime });
    await new Promise(resolve => setTimeout(resolve, sleepTime));
    
    res.json(responseData);
  } catch (error) {
    setSpanAttributes({ endpoint: '/cotacao/euro', error: error.message });
    const errorResponse = {
      error: 'Erro ao buscar cotação do euro',
      message: error.message
    };
    
    await saveToAudit('/cotacao/euro', requestData, errorResponse);
    
    res.status(500).json(errorResponse);
  }
});

// Rota /conversao/dolar - calcular conversão de reais para dólares
app.post('/conversao/dolar', async (req, res) => {
  const { valor_compra, valor_maximo, nome, categoria } = req.body;
  
  // Validar parâmetros obrigatórios
  if (!valor_compra) {
    return res.status(400).json({
      error: 'Parâmetro valor_compra é obrigatório',
      message: 'Forneça o valor em reais disponível para comprar dólares'
    });
  }
  
  if (!nome) {
    return res.status(400).json({
      error: 'Parâmetro nome é obrigatório',
      message: 'Forneça o nome para logs'
    });
  }
  
  if (!categoria) {
    return res.status(400).json({
      error: 'Parâmetro categoria é obrigatório',
      message: 'Forneça a categoria para logs (Silver, Gold, Diamond)'
    });
  }
  
  // Validar categoria
  const categoriasValidas = ['Silver', 'Gold', 'Diamond'];
  if (!categoriasValidas.includes(categoria)) {
    return res.status(400).json({
      error: 'categoria inválida',
      message: `A categoria deve ser um dos valores: ${categoriasValidas.join(', ')}`
    });
  }
  
  // Validar se valor_compra é um número válido
  const valorCompraNum = parseFloat(valor_compra);
  if (isNaN(valorCompraNum) || valorCompraNum <= 0) {
    return res.status(400).json({
      error: 'valor_compra inválido',
      message: 'O valor_compra deve ser um número positivo'
    });
  }
  
  // Validar valor_maximo se fornecido
  let valorMaximoNum = null;
  if (valor_maximo !== undefined && valor_maximo !== null) {
    valorMaximoNum = parseFloat(valor_maximo);
    if (isNaN(valorMaximoNum) || valorMaximoNum <= 0) {
      return res.status(400).json({
        error: 'valor_maximo inválido',
        message: 'O valor_maximo deve ser um número positivo'
      });
    }
  }
  
  // Log dos parâmetros nome e categoria
  logger.info('Conversão dólar', { nome, categoria });
  setSpanAttributes({ endpoint: '/conversao/dolar', nome, categoria, valor_compra: valorCompraNum, valor_maximo: valorMaximoNum });

  const requestData = { 
    valor_compra: valorCompraNum, 
    valor_maximo: valorMaximoNum,
    nome: nome,
    categoria: categoria
  };
  
  try {
    // 10% das requisições usam URL incorreta para simular erro (usdxxx)
    const COTACAO_USD_OK = 'https://br.dolarapi.com/v1/cotacoes/usd';
    const COTACAO_USD_ERRO = 'https://br.dolarapi.com/v1/cotacoes/usdxxx';
    const usarUrlComErro = Math.random() < 0.1;
    const cotacaoUrl = usarUrlComErro ? COTACAO_USD_ERRO : COTACAO_USD_OK;
    if (usarUrlComErro) setSpanAttributes({ fault_injected: true, cotacao_url: cotacaoUrl });

    const cotacaoResponse = await axios.get(cotacaoUrl);
    const cotacaoData = cotacaoResponse.data;
    
    // Extrair valor da cotação (tentar diferentes campos comuns)
    let cotacao = null;
    if (cotacaoData.compra) {
      cotacao = parseFloat(cotacaoData.compra);
    } else if (cotacaoData.bid) {
      cotacao = parseFloat(cotacaoData.bid);
    } else if (cotacaoData.valor) {
      cotacao = parseFloat(cotacaoData.valor);
    } else if (cotacaoData.cotacao) {
      cotacao = parseFloat(cotacaoData.cotacao);
    } else if (typeof cotacaoData === 'number') {
      cotacao = cotacaoData;
    } else {
      // Tentar encontrar qualquer campo numérico que possa ser a cotação
      const valores = Object.values(cotacaoData).filter(v => typeof v === 'number' && v > 0);
      if (valores.length > 0) {
        cotacao = valores[0];
      }
    }
    
    if (!cotacao || isNaN(cotacao) || cotacao <= 0) {
      throw new Error('Não foi possível extrair o valor da cotação da resposta da API');
    }
    
    // Calcular quantos dólares dá para comprar
    const dolaresComprados = valorCompraNum / cotacao;
    
    // Preparar resposta
    const dolaresCompradosRounded = parseFloat(dolaresComprados.toFixed(2));
    const responseData = {
      valor_compra_reais: valorCompraNum,
      cotacao_dolar: cotacao,
      dolares_comprados: dolaresCompradosRounded,
      timestamp: new Date().toISOString()
    };

    setSpanAttributes({ cotacao_dolar: cotacao, dolares_comprados: dolaresCompradosRounded });
    
    // Verificar limite se valor_maximo foi fornecido
    if (valorMaximoNum !== null) {
      if (valorMaximoNum <= cotacao) {
        responseData.status = 'compra confirmada';
      } else {
        responseData.status = 'valor ultrapassa o limite de compra';
      }
      responseData.valor_maximo = valorMaximoNum;
    }
    
    await saveToAudit('/conversao/dolar', requestData, responseData);
    
    // Sleep aleatório entre 10ms e 2s
    const sleepTime = getRandomSleep();
    setSpanAttributes({ sleep_ms: sleepTime });
    await new Promise(resolve => setTimeout(resolve, sleepTime));
    
    res.json(responseData);
  } catch (error) {
    setSpanAttributes({ error: error.message });
    const errorResponse = {
      error: 'Erro ao calcular conversão de dólar',
      message: error.message
    };
    
    await saveToAudit('/conversao/dolar', requestData, errorResponse);
    
    res.status(500).json(errorResponse);
  }
});

// Rota /week/day - recebe data como parâmetro
app.get('/week/day', async (req, res) => {
  const { date } = req.query;
  
  if (!date) {
    return res.status(400).json({
      error: 'Parâmetro date é obrigatório',
      message: 'Use o formato YYYY-MM-DD, exemplo: /week/day?date=2022-10-18'
    });
  }
  
  // Validar formato da data
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      error: 'Formato de data inválido',
      message: 'Use o formato YYYY-MM-DD'
    });
  }
  
  const requestData = { date };
  
  setSpanAttributes({ endpoint: '/week/day', date });

  try {
    const response = await axios.get(`https://digidates.de/api/v1/week?date=${date}`);
    const responseData = response.data;
    
    await saveToAudit('/week/day', requestData, responseData);
    
    // Sleep aleatório entre 10ms e 2s
    const sleepTime = getRandomSleep();
    setSpanAttributes({ sleep_ms: sleepTime });
    await new Promise(resolve => setTimeout(resolve, sleepTime));
    
    res.json(responseData);
  } catch (error) {
    setSpanAttributes({ error: error.message });
    const errorResponse = {
      error: 'Erro ao buscar semana da data',
      message: error.message
    };
    
    await saveToAudit('/week/day', requestData, errorResponse);
    
    res.status(500).json(errorResponse);
  }
});

// Rota /audit - listar todos os registros da tabela audit
app.get('/audit', async (req, res) => {
  if (!isDatabaseConnected) {
    return res.status(503).json({
      error: 'Banco de dados não disponível',
      message: 'A conexão com o banco de dados não está disponível no momento',
      database_connected: false
    });
  }
  
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const result = await pool.query(
      'SELECT * FROM audit ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [parseInt(limit), parseInt(offset)]
    );
    
    const countResult = await pool.query('SELECT COUNT(*) FROM audit');
    const total = parseInt(countResult.rows[0].count);

    setSpanAttributes({ endpoint: '/audit', limit: parseInt(limit), offset: parseInt(offset), total });
    
    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      data: result.rows
    });
  } catch (error) {
    setSpanAttributes({ endpoint: '/audit', error: error.message });
    isDatabaseConnected = false;
    res.status(500).json({
      error: 'Erro ao buscar registros de audit',
      message: error.message
    });
  }
});

// Rota /clean - apagar todos os registros da tabela audit
app.delete('/clean', async (req, res) => {
  if (!isDatabaseConnected) {
    return res.status(503).json({
      error: 'Banco de dados não disponível',
      message: 'A conexão com o banco de dados não está disponível no momento',
      database_connected: false
    });
  }
  
  try {
    // Contar registros antes de deletar
    const countResult = await pool.query('SELECT COUNT(*) FROM audit');
    const totalBefore = parseInt(countResult.rows[0].count);
    
    // Deletar todos os registros
    await pool.query('DELETE FROM audit');
    
    // Resetar a sequência do ID (opcional, mas útil para manter IDs sequenciais)
    await pool.query('ALTER SEQUENCE audit_id_seq RESTART WITH 1');

    setSpanAttributes({ endpoint: '/clean', deleted_count: totalBefore });
    
    res.json({
      message: 'Todos os registros foram apagados com sucesso',
      deletedCount: totalBefore,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    setSpanAttributes({ endpoint: '/clean', error: error.message });
    isDatabaseConnected = false;
    res.status(500).json({
      error: 'Erro ao apagar registros de audit',
      message: error.message
    });
  }
});

// Rota de health check
app.get('/health', async (req, res) => {
  // Sempre retorna ok para a API, independente do banco
  res.json({ 
    status: 'ok', 
    api: 'operational',
    database: isDatabaseConnected ? 'connected' : 'disconnected' 
  });
});

// Iniciar servidor e verificação de conexão
app.listen(port, '0.0.0.0', () => {
  logger.info('Servidor rodando', { port });
  logger.warn('APIs funcionarão normalmente mesmo sem conexão com o banco de dados');
  // Iniciar verificação de saúde do banco de dados
  startDatabaseHealthCheck();
});
