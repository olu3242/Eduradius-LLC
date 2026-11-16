import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import { requestIdFor, runWithRequestId } from "../lib/server/request-context";
import { logEvent } from "../lib/server/http";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    // Correlation ID on every response and log line; failures are logged without request data.
    const requestId = requestIdFor(request);
    return runWithRequestId(requestId, async () => {
      const path = new URL(request.url).pathname;
      let response: Response;
      try {
        response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
      } catch (error) {
        logEvent('http.exception', { method: request.method, path, message: String(error) });
        return Response.json({ error: 'Something went wrong. Please try again.', requestId }, { status: 500, headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } });
      }
      if (response.status >= 500) logEvent('http.error', { method: request.method, path, status: response.status });
      const tagged = new Response(response.body, response);
      tagged.headers.set('x-request-id', requestId);
      return tagged;
    });
  },
};

export default worker;
