---
title: "LLM Observability with Service Now Cloud Observability and OpenLLMetry"
sidebarTitle: "Service Now Cloud Observability"
---

<Frame>
  <img src="/img/integrations/service-now.png" />
</Frame>

Since Service Now Cloud Observability natively supports OpenTelemetry, you just need to route the traces to Service Now Cloud Observability's endpoint and set the
access token:

```bash
TRACELOOP_BASE_URL=https://ingest.lightstep.com
TRACELOOP_HEADERS="lightstep-access-token=<YOUR_ACCESS_TOKEN>"
```
