# API de Cotações

Aplicação Node.js com 4 endpoints que salvam resultados no PostgreSQL.

## Endpoints

- `GET /sleep` - Sleep dinâmico entre 500ms e 5s
- `GET /cotacao/dolar` - Busca cotação do dólar
- `GET /cotacao/euro` - Busca cotação do euro
- `GET /week/day?date=YYYY-MM-DD` - Retorna a semana do ano para uma data específica
- `GET /audit?limit=100&offset=0` - Lista todos os registros da tabela audit (com paginação)
- `DELETE /clean` - Apaga todos os registros da tabela audit (uso manual apenas)
- `GET /health` - Health check da aplicação e banco de dados

## Como executar

### Usando Docker Compose

```bash
docker-compose up --build
```

A aplicação estará disponível em `http://localhost:3000`

### Variáveis de Ambiente

As variáveis de ambiente podem ser configuradas no arquivo `.env` ou no `docker-compose.yml`.

## Estrutura do Banco de Dados

A tabela `audit` é criada automaticamente na inicialização:

```sql
CREATE TABLE audit (
  id SERIAL PRIMARY KEY,
  endpoint VARCHAR(255) NOT NULL,
  request_data JSONB,
  response_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Exemplos de Uso

```bash
# Sleep dinâmico
curl http://localhost:3000/sleep

# Cotação do dólar
curl http://localhost:3000/cotacao/dolar

# Cotação do euro
curl http://localhost:3000/cotacao/euro

# Semana do ano
curl http://localhost:3000/week/day?date=2022-10-18

# Listar registros de audit
curl http://localhost:3000/audit

# Listar audit com paginação
curl http://localhost:3000/audit?limit=10&offset=0

# Apagar todos os registros (uso manual)
curl -X DELETE http://localhost:3000/clean

# Health check
curl http://localhost:3000/health
```
