const { context, trace } = require('@opentelemetry/api');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { Resource } = require('@opentelemetry/resources');
const winston = require('winston');
const Transport = require('winston-transport');
const axios = require('axios');

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

class SplunkHecTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.hecUrl = opts.hecUrl;
    this.hecToken = opts.hecToken;
    this.source = opts.source || 'otel';
    this.sourcetype = opts.sourcetype || 'otel';
    this.host = opts.host || undefined;
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    const payload = {
      time: Date.now() / 1000,
      host: this.host,
      source: this.source,
      sourcetype: this.sourcetype,
      event: {
        message: info.message,
        level: info.level,
        timestamp: info.timestamp,
        trace_id: info.trace_id,
        span_id: info.span_id,
      },
      fields: {
        service: process.env.OTEL_SERVICE_NAME || 'api-cotacoes',
      },
    };

    axios
      .post(this.hecUrl, payload, {
        headers: {
          Authorization: `Splunk ${this.hecToken}`,
        },
        timeout: 5000,
      })
      .catch((err) => {
        this.emit('error', err);
      })
      .finally(() => callback());
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

  const transports = [new winston.transports.Console()];
  if (otelLogger) {
    transports.push(new OTelTransport({ otelLogger }));
  }
  if (process.env.SPLUNK_HEC_URL && process.env.SPLUNK_HEC_TOKEN) {
    transports.push(
      new SplunkHecTransport({
        hecUrl: process.env.SPLUNK_HEC_URL,
        hecToken: process.env.SPLUNK_HEC_TOKEN,
        source: process.env.SPLUNK_HEC_SOURCE,
        sourcetype: process.env.SPLUNK_HEC_SOURCETYPE,
        host: process.env.SPLUNK_HEC_HOST,
      })
    );
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      addTraceContext(),
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports,
  });
}

let provider;
let logger;
try {
  let otelLogger;
  if ((process.env.OTEL_LOGS_EXPORTER || 'otlp').toLowerCase() !== 'none') {
    provider = createLoggerProvider();
    otelLogger = provider.getLogger('app-logger');
  }
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
