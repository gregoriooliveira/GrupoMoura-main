const { context, trace } = require('@opentelemetry/api');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { Resource } = require('@opentelemetry/resources');
const winston = require('winston');
const Transport = require('winston-transport');

function parseResourceAttributes(raw) {
  if (!raw) return {};
  const attrs = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=');
    if (!k) continue;
    attrs[k.trim()] = (v ?? '').trim();
  }
  return attrs;
}

function buildLogsEndpoint(endpoint, protocol) {
  if (!endpoint) return undefined;
  const normalized = endpoint.replace(/\/+$/, '');
  if (protocol === 'grpc') return normalized;
  if (normalized.endsWith('/v1/logs')) return normalized;
  return `${normalized}/v1/logs`;
}

function createExporter() {
  const protocol = (process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'http/protobuf').toLowerCase();
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const logsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  if (protocol === 'grpc') {
    const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc');
    return new OTLPLogExporter({
      url: logsEndpoint || endpoint,
    });
  }
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  return new OTLPLogExporter({
    url: buildLogsEndpoint(logsEndpoint || endpoint, protocol),
  });
}

function createLoggerProvider() {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'api-cotacoes';
  const resource = Resource.default().merge(
    new Resource({
      'service.name': serviceName,
      ...parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
    })
  );

  const processor = new BatchLogRecordProcessor(createExporter());
  let provider;
  if (typeof LoggerProvider.prototype.addLogRecordProcessor === 'function') {
    provider = new LoggerProvider({ resource });
    provider.addLogRecordProcessor(processor);
    return provider;
  }
  if (typeof LoggerProvider.prototype.addProcessor === 'function') {
    provider = new LoggerProvider({ resource });
    provider.addProcessor(processor);
    return provider;
  }
  // Newer SDKs accept processors in the constructor.
  provider = new LoggerProvider({ resource, processors: [processor] });
  return provider;
}

function mapSeverity(level) {
  switch (level) {
    case 'error':
      return { text: 'ERROR', number: 17 };
    case 'warn':
      return { text: 'WARN', number: 13 };
    case 'info':
      return { text: 'INFO', number: 9 };
    case 'http':
      return { text: 'INFO', number: 9 };
    case 'verbose':
      return { text: 'DEBUG', number: 7 };
    case 'debug':
      return { text: 'DEBUG', number: 5 };
    case 'silly':
      return { text: 'TRACE', number: 1 };
    default:
      return { text: 'INFO', number: 9 };
  }
}

class OTelTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.otelLogger = opts.otelLogger;
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    const { text, number } = mapSeverity(info.level);
    const attributes = { ...info };
    delete attributes.level;
    delete attributes.message;
    delete attributes.timestamp;

    this.otelLogger.emit(
      {
        severityText: text,
        severityNumber: number,
        body: info.message,
        attributes,
      },
      context.active()
    );

    callback();
  }
}

function createWinstonLogger(otelLogger) {
  const addTraceContext = winston.format((info) => {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      info.trace_id = spanContext.traceId;
      info.span_id = spanContext.spanId;
    }
    return info;
  });

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      addTraceContext(),
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console(),
      new OTelTransport({ otelLogger }),
    ],
  });
}

let provider;
let logger;
try {
  provider = createLoggerProvider();
  const otelLogger = provider.getLogger('app-logger');
  logger = createWinstonLogger(otelLogger);
} catch (err) {
  // Fallback logger keeps app running even if OTLP setup fails
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [new winston.transports.Console()],
  });
  logger.warn('OTLP logs not initialized', {
    error: err && err.message ? err.message : err,
  });
}

function shutdown() {
  if (!provider) return;
  provider.shutdown().catch(() => {});
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { logger };
