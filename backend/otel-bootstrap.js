// Bootstraps Splunk OTel JS with runtime metrics enabled.
// Keep this tiny so it runs before app code.
const { start } = require('@splunk/otel');

start({
  // serviceName is picked up from OTEL_SERVICE_NAME when not set here.
  metrics: {
    runtimeMetricsEnabled: true,
  },
});

