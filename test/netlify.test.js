const test = require("node:test");
const assert = require("node:assert/strict");

test("Netlify exposes the browser API route and forwards analysis through the shared handler", async () => {
  const { config, createHandler } = await import("../netlify/functions/openai.mjs");
  assert.equal(config.path, "/api/openai/responses");
  const handler = createHandler({
    env: { OPENAI_API_KEY: "test-only" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(JSON.parse(options.body).input, "Analyze this document");
      return Response.json({ status: "completed" });
    },
  });
  const response = await handler(new Request("https://example.com/api/openai/responses", {
    method: "POST", body: JSON.stringify({ input: "Analyze this document" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "completed" });
});

test("Netlify reports missing credentials and rejects malformed requests", async () => {
  const { createHandler } = await import("../netlify/functions/openai.mjs");
  const handler = createHandler({ env: {} });
  const request = (body) => new Request("https://example.com/api/openai/responses", { method: "POST", body });
  assert.equal((await handler(request('{"input":"test"}'))).status, 500);
  assert.equal((await handler(request("invalid"))).status, 400);
  assert.equal((await handler(new Request("https://example.com/api/openai/responses"))).status, 405);
});
