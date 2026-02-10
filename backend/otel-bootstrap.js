// Bootstraps Splunk OTel JS with runtime metrics enabled.
// Keep this tiny so it runs before app code.
const { start } = require('@splunk/otel');

const serviceName =
  process.env.OTEL_SERVICE_NAME || process.env.SPLUNK_SERVICE_NAME;

start({
  serviceName,
  metrics: {
    runtimeMetricsEnabled: true,
  },
});
