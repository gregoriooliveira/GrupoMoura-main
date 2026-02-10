# Observabilidade no ACA com Splunk (Guia do Cliente)

Este documento descreve o caminho recomendado para instrumentar uma aplicacao em Azure Container Apps (ACA) e enviar:
- Traces e metricas para o **Splunk Observability (SignalFx)** via OTLP
- Logs para o **Splunk Core** via **HEC**

## Por que nao usar sidecar no ACA
O ACA tem limitacoes para sidecar com acesso a logs/FS e para manutencao de pipeline. A abordagem mais estavel e **exportar diretamente do app**, com o OpenTelemetry SDK e um logger estruturado.

## O que precisa ser feito no codigo

### 1) Instalar o SDK do OpenTelemetry
Adicionar no backend as dependencias do OTel e do logger (exemplos):
- `@opentelemetry/api`
- `@opentelemetry/sdk-logs`
- `@opentelemetry/exporter-logs-otlp-grpc` (ou http)
- `winston`
- `winston-transport`

### 2) Inicializar o OTel no startup
O OTel deve ser inicializado no inicio da aplicacao (bootstrap).  
Exemplo de uso no codigo:
```
const { trace } = require('@opentelemetry/api');
```

Isso permite que o trace/span seja propagado e incluido nos logs.

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

## O que precisa ser feito no ACA (variaveis do container)

Arquivo que define as variaveis do ACA: `.github/workflows/aca-deploy.yml` (step `Configure backend env vars`).

### Traces e metricas -> Splunk Observability (Moura)
Configuracao atual usada no ACA (fonte de verdade: `.github/workflows/aca-deploy.yml`).
```
OTEL_SERVICE_NAME=greg-aca-lab
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.us1.signalfx.com:443
OTEL_EXPORTER_OTLP_HEADERS=X-SF-Token=<token_observability_moura>
OTEL_METRICS_EXPORTER=otlp
SPLUNK_METRICS_ENABLED=true
SPLUNK_RUNTIME_METRICS_ENABLED=true
```

Notas:
- Nao definir `OTEL_EXPORTER_OTLP_*_ENDPOINT` de traces/metricas quando o protocolo for `grpc`. O endpoint base ja cobre ambos.
- Se mudar para `http/protobuf`, e obrigatorio definir endpoints HTTP compativeis para traces e metricas. Caso contrario, o export pode falhar silenciosamente.

### Logs -> Splunk Core (HEC) (Moura)
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

### Runtime metrics no codigo (obrigatorio)
O runtime metrics e habilitado no bootstrap do Splunk OTel:
Arquivo: `backend/otel-bootstrap.js`
```
const { start } = require('@splunk/otel');

const serviceName =
  process.env.OTEL_SERVICE_NAME || process.env.SPLUNK_SERVICE_NAME;

start({
  serviceName,
  metrics: {
    runtimeMetricsEnabled: true,
  },
});
```

E o processo precisa iniciar com o bootstrap antes do app:
Arquivo: `backend/Dockerfile`
```
CMD [ "node", "-r", "./otel-bootstrap.js", "server.js"]
```

## Checklist final
1. App instrumentado com OTel SDK.
2. Logger estruturado com `trace_id`/`span_id`.
3. Variaveis OTEL e HEC configuradas no container.
4. Traces visiveis no Splunk Observability.
5. Logs visiveis no Splunk Core.

## Correlacao de Logs com Traces (Log Observer Connect)
Para a aba `Logs` dentro do APM funcionar, os logs precisam ter os mesmos atributos que o APM usa para filtrar.

### Campos obrigatorios nos logs
- `service.name` (mesmo valor de `OTEL_SERVICE_NAME`).
- `trace.id` e `span.id` (ou aliases que mapeiem `trace_id` -> `trace.id` e `span_id` -> `span.id`).
- `deployment.environment` (quando o APM filtra por ambiente).

### Passos no Splunk Observability
1. `Settings` -> `Logs Connections`: crie o entity mapping de `service.name` para o seu index.
2. `Settings` -> `Log Observer field aliasing`: crie aliases `trace_id` -> `trace.id` e `span_id` -> `span.id`.
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

## Conclusao
Com essa abordagem, o app envia **telemetria completa** sem sidecar:
- Traces/metricas -> Splunk Observability
- Logs -> Splunk Core (HEC)
