import proxy from "../../openai-proxy.js";

export const config = { path: "/api/openai/responses" };

export function createHandler(options) {
  const respond = proxy.createResponsesHandler(options);
  return async (request) => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: { message: "Invalid JSON request." } }, { status: 400 });
    }
    let status = 200;
    return respond({ body }, {
      status(code) { status = code; return this; },
      json(payload) { return Response.json(payload, { status }); },
    });
  };
}

export default createHandler();
