const axios = require('axios');
require('dotenv').config();

// URL base da API do backend
const BACKEND_URL = process.env.BACKEND_URL || 'http://api:3000';

// Função auxiliar para fazer chamadas GET ao backend
async function callBackend(endpoint, params = {}) {
  try {
    let url = `${BACKEND_URL}${endpoint}`;
    
    // Forçar IPv4 quando usar localhost (evita problema com IPv6 ::1)
    if (url.includes('localhost')) {
      url = url.replace('localhost', '127.0.0.1');
    }
    
    console.log(`Chamando ${url} com parâmetros:`, params);
    
    const response = await axios.get(url, { params });
    
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

// Função auxiliar para fazer chamadas POST ao backend
async function callBackendPost(endpoint, body = {}) {
  try {
    let url = `${BACKEND_URL}${endpoint}`;
    
    // Forçar IPv4 quando usar localhost (evita problema com IPv6 ::1)
    if (url.includes('localhost')) {
      url = url.replace('localhost', '127.0.0.1');
    }
    
    console.log(`Chamando POST ${url} com body:`, body);
    
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

// Lista de endpoints para chamar continuamente
const endpoints = [
  { path: '/sleep', params: {}, method: 'GET' },
  { path: '/cotacao/dolar', params: {}, method: 'GET' },
  { path: '/cotacao/euro', params: {}, method: 'GET' },
  { path: '/week/day', params: {}, method: 'GET' }, // Data será gerada aleatoriamente
  { path: '/conversao/dolar', method: 'POST' }, // Body será gerado aleatoriamente
];

// Função para gerar intervalo aleatório entre 500ms e 1s
function getRandomInterval() {
  const min = 500; // 500ms
  const max = 1000; // 1 segundo em milissegundos
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Função para gerar uma data aleatória no formato YYYY-MM-DD
function getRandomDate() {
  // Gerar data aleatória entre 2000-01-01 e hoje
  const startDate = new Date('2000-01-01');
  const endDate = new Date();
  
  const startTimestamp = startDate.getTime();
  const endTimestamp = endDate.getTime();
  
  const randomTimestamp = startTimestamp + Math.random() * (endTimestamp - startTimestamp);
  const randomDate = new Date(randomTimestamp);
  
  // Formatar como YYYY-MM-DD
  const year = randomDate.getFullYear();
  const month = String(randomDate.getMonth() + 1).padStart(2, '0');
  const day = String(randomDate.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

// Função para gerar valor máximo aleatório (pode ser vazio ou entre 3 e 7 com casa decimal)
function getRandomValorMaximo() {
  // 50% de chance de ser vazio (null/undefined)
  if (Math.random() < 0.5) {
    return undefined;
  }
  
  // Gerar valor aleatório entre 3 e 7 com 2 casas decimais
  const min = 3;
  const max = 7;
  const valor = Math.random() * (max - min) + min;
  return parseFloat(valor.toFixed(2));
}

// Função para gerar valor de compra aleatório (entre 100 e 10000 reais)
function getRandomValorCompra() {
  const min = 100;
  const max = 10000;
  const valor = Math.random() * (max - min) + min;
  return parseFloat(valor.toFixed(2));
}

// Função para gerar nome aleatório
function getRandomNome() {
  const nomes = [
    'João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Souza',
    'Juliana Ferreira', 'Roberto Alves', 'Fernanda Lima', 'Ricardo Martins', 'Patricia Rocha',
    'Lucas Pereira', 'Camila Rodrigues', 'Bruno Carvalho', 'Amanda Gomes', 'Felipe Ribeiro',
    'Larissa Araujo', 'Gabriel Dias', 'Isabela Moreira', 'Rafael Barbosa', 'Beatriz Nunes'
  ];
  return nomes[Math.floor(Math.random() * nomes.length)];
}

// Função para gerar categoria aleatória (Silver, Gold, Diamond)
function getRandomCategoria() {
  const categorias = ['Silver', 'Gold', 'Diamond'];
  return categorias[Math.floor(Math.random() * categorias.length)];
}

// Função para chamar uma API aleatória do backend
async function callRandomAPI() {
  const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  
  // Gerar data aleatória para /week/day se necessário
  if (randomEndpoint.path === '/week/day') {
    randomEndpoint.params.date = getRandomDate();
  }
  
  try {
    console.log(`[${new Date().toISOString()}] Chamando ${randomEndpoint.method} ${randomEndpoint.path}...`);
    
    let result;
    
    // Se for POST, usar callBackendPost
    if (randomEndpoint.method === 'POST') {
      if (randomEndpoint.path === '/conversao/dolar') {
        const body = {
          valor_compra: getRandomValorCompra(),
          valor_maximo: getRandomValorMaximo(),
          nome: getRandomNome(),
          categoria: getRandomCategoria()
        };
        // Remover valor_maximo se for undefined
        if (body.valor_maximo === undefined) {
          delete body.valor_maximo;
        }
        result = await callBackendPost(randomEndpoint.path, body);
      } else {
        result = await callBackendPost(randomEndpoint.path, randomEndpoint.body || {});
      }
    } else {
      // GET request
      result = await callBackend(randomEndpoint.path, randomEndpoint.params);
    }
    
    if (result.success) {
      console.log(`[${new Date().toISOString()}] ✓ Sucesso em ${randomEndpoint.method} ${randomEndpoint.path}`);
    } else {
      console.error(`[${new Date().toISOString()}] ✗ Erro em ${randomEndpoint.method} ${randomEndpoint.path}:`, result.error);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Exceção ao chamar ${randomEndpoint.method} ${randomEndpoint.path}:`, error.message);
  }
}

// Função para iniciar o loop contínuo de chamadas
async function startContinuousCalls() {
  console.log('========================================');
  console.log('🤖 Robot iniciado');
  console.log(`📡 Backend URL: ${BACKEND_URL}`);
  console.log('🔄 Iniciando chamadas contínuas...');
  console.log('========================================');
  
  // Aguardar um pouco para garantir que o backend está pronto
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  while (true) {
    await callRandomAPI();
    
    const interval = getRandomInterval();
    const seconds = (interval / 1000).toFixed(1);
    console.log(`⏳ Aguardando ${seconds}s antes da próxima chamada...`);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// Iniciar o robot
startContinuousCalls().catch(error => {
  console.error('❌ Erro fatal no robot:', error);
  process.exit(1);
});
