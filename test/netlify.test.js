const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("Netlify function loads without Express or other local-server dependencies", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const Module = require("node:module");
    const original = Module._load;
    Module._load = function (name, ...args) {
      if (["express", "dotenv"].includes(name)) throw new Error("Unavailable in function: " + name);
      return original.call(this, name, ...args);
    };
    import("./netlify/functions/openai.mjs").catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  `], { cwd: require("node:path").join(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

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
