# Observabilidade no ACA com Splunk (Guia do Cliente)

Este documento descreve o caminho recomendado para instrumentar uma aplicação em Azure Container Apps (ACA) e enviar:
- Traces e métricas para o **Splunk Observability (SignalFx)** via OTLP
- Logs para o **Splunk Core** via **HEC**

## Por que não usar sidecar no ACA
O ACA tem limitações para sidecar com acesso a logs/FS e para manutenção de pipeline. A abordagem mais estável é **exportar diretamente do app**, com o OpenTelemetry SDK e um logger estruturado.

## O que precisa ser feito no código

### 1) Instalar o SDK do OpenTelemetry
Adicionar no backend as dependências do OTel e do logger (exemplos):
- `@opentelemetry/api`
- `@opentelemetry/sdk-logs`
- `@opentelemetry/exporter-logs-otlp-grpc` (ou http)
- `winston`
- `winston-transport`

### 2) Inicializar o OTel no startup
O OTel deve ser inicializado no início da aplicação (bootstrap).  
Exemplo de uso no código:
```
const { trace } = require('@opentelemetry/api');
```

Isso permite que o trace/span seja propagado e incluído nos logs.

### 3) Logger estruturado com envio para HEC
Criar um arquivo de bootstrap (ex.: `otel-logs.js`) para:
- Configurar Winston
- Injetar `trace_id` e `span_id` nos logs
- Enviar logs para Splunk Core via HEC

Uso no app:
```
const { logger } = require('./otel-logs');
```

Substituir `console.*` por `logger.*`.

## O que precisa ser feito no ACA (variáveis do container)

### Traces e métricas → Splunk Observability (Moura)
```
OTEL_SERVICE_NAME=greg-aca-lab
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.us1.signalfx.com:443
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://ingest.us1.signalfx.com:443
OTEL_EXPORTER_OTLP_HEADERS=X-SF-Token=<token_observability_moura>
```

### Logs → Splunk Core (HEC) (Moura)
```
SPLUNK_HEC_URL=https://http-inputs-acumuladoresmoura.splunkcloud.com/services/collector
SPLUNK_HEC_TOKEN=<token_hec_moura>
SPLUNK_HEC_SOURCE=backend
SPLUNK_HEC_SOURCETYPE=_json
SPLUNK_HEC_HOST=greg-aca-lab
```

### Evitar duplicidade de logs via OTel
```
OTEL_LOGS_EXPORTER=none
```

## Checklist final
1. App instrumentado com OTel SDK.
2. Logger estruturado com `trace_id`/`span_id`.
3. Variáveis OTEL e HEC configuradas no container.
4. Traces visíveis no Splunk Observability.
5. Logs visíveis no Splunk Core.


## Correlacao de Logs com Traces (Log Observer Connect)
Para a aba `Logs` dentro do APM funcionar, os logs precisam ter os mesmos atributos que o APM usa para filtrar.

### Campos obrigatorios nos logs
- `service.name` (mesmo valor de `OTEL_SERVICE_NAME`).
- `trace.id` e `span.id` (ou aliases que mapeiem `trace_id` -> `trace.id` e `span_id` -> `span.id`).
- `deployment.environment` (quando o APM filtra por ambiente).

### Passos no Splunk Observability
1. `Settings` -> `Logs Connections`: crie o entity mapping de `service.name` para o seu index.
2. `Settings` -> `Log Observer field aliasing`: crie aliases:
   - `trace_id` -> `trace.id`
   - `span_id` -> `span.id`
3. No APM, selecione o `Environment` correto (por exemplo `hml`) na aba do servico.

### Variaveis recomendadas no container
```
OTEL_SERVICE_NAME=greg-aca-lab
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=hml
DEPLOYMENT_ENVIRONMENT=hml
```

## Por que alguns spans nao tem logs
Mesmo com correlacao correta, nem todo span vai ter log associado. Os logs so aparecem quando o app realmente chama `logger.*`. Spans de auto-instrumentacao (ex.: `pg`, `dns`, `http`) nao geram logs automaticamente. Outros motivos comuns:
- Log level alto demais (ex.: `info` e o log foi `debug`).
- Erros tratados sem log.
- Log gerado fora do contexto ativo (perda de contexto).

## Conclusão
Com essa abordagem, o app envia **telemetria completa** sem sidecar:
- Traces/métricas → Splunk Observability
- Logs → Splunk Core (HEC)
