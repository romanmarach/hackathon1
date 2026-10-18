import proxy from "../../openai-proxy.js";
import security from "../../security-headers.js";

export const config = {
  path: "/api/openai/responses",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export function createHandler(options) {
  const respond = proxy.createResponsesHandler(options);
  return async (request) => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { ...security.API_HEADERS, Allow: "POST" } });
    }
    const fail = (status, message) => Response.json({ error: { message } }, { status, headers: security.API_HEADERS });
    if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return fail(415, "Send the request as application/json.");
    }
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return fail(403, "Cross-site requests are not allowed.");
    }
    if (Number(request.headers.get("content-length")) > 6 * 1024 * 1024) {
      return fail(413, "Document request is too large.");
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return fail(400, "Invalid JSON request.");
    }
    let status = 200;
    return respond({ body }, {
      status(code) { status = code; return this; },
      json(payload) { return Response.json(payload, { status, headers: security.API_HEADERS }); },
    });
  };
}

export default createHandler();
