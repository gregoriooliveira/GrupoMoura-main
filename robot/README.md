# Robot API Caller

Robot que simula ações reais chamando as APIs do backend **continuamente** de forma automática, com intervalo aleatório entre 1 e 5 segundos entre cada chamada.

## Funcionamento

O robot é um processo que:
- **Inicia automaticamente** quando o container é iniciado
- **Não possui APIs HTTP** - é apenas um simulador de ações
- Chama as APIs do backend de forma aleatória (`/sleep`, `/cotacao/dolar`, `/cotacao/euro`, `/week/day`)
- Aguarda um intervalo aleatório entre **1 e 5 segundos** antes da próxima chamada
- Registra todas as chamadas no console
- Continua executando indefinidamente

## Variáveis de Ambiente

- `BACKEND_URL` - URL do backend (padrão: http://api:3000)

## Logs

O robot exibe logs no console mostrando:
- Timestamp de cada chamada
- Endpoint chamado
- Status da chamada (sucesso ou erro)
- Intervalo de espera antes da próxima chamada

## Observação

Este robot **não expõe nenhuma API HTTP**. Ele apenas simula ações reais chamando o backend continuamente. Para verificar os logs, use:

```bash
docker logs cotacoes-robot -f
```
