/**
 * One span per pipeline stage (ingest, detect, api request), with duration, record
 * count, and failure reason attributes. Export is a no-op unless SIGNOZ_OTLP_ENDPOINT
 * is set, per CONTRACT: sponsor calls are optional at runtime.
 *
 * Spans are created either way so the instrumentation path is real and testable
 * without a SigNoz key.
 */
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'trendwatch-backend' });
  const provider = new NodeTracerProvider({ resource, spanProcessors: buildProcessors() });
  provider.register();
}

function buildProcessors() {
  const endpoint = process.env.SIGNOZ_OTLP_ENDPOINT;
  const key = process.env.SIGNOZ_INGESTION_KEY;
  if (endpoint) {
    const exporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: key ? { 'signoz-ingestion-key': key } : undefined,
    });
    return [new BatchSpanProcessor(exporter)];
  }
  // No sponsor key: still create real spans, just don't ship them anywhere.
  return [];
}

/**
 * Wrap a pipeline stage in a span. Records duration automatically, and the caller
 * reports record count / failure reason via the returned helpers.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: { setRecordCount: (n: number) => void; setAttr: (k: string, v: string | number | boolean) => void }) => Promise<T> | T,
): Promise<T> {
  init();
  const tracer = trace.getTracer('trendwatch-backend');
  return tracer.startActiveSpan(name, async (span: Span) => {
    const start = Date.now();
    const helpers = {
      setRecordCount: (n: number) => span.setAttribute('record_count', n),
      setAttr: (k: string, v: string | number | boolean) => span.setAttribute(k, v),
    };
    try {
      const result = await fn(helpers);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      span.setAttribute('failure_reason', reason);
      span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
      throw err;
    } finally {
      span.setAttribute('duration_ms', Date.now() - start);
      span.end();
    }
  });
}
