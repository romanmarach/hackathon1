const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server");

async function startServer(t, options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (body) => fetch(`http://127.0.0.1:${server.address().port}/api/openai/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("proxy uses OpenAI bearer auth, a server-selected mini model, and native Responses fields", async (t) => {
  const calls = [];
  const output = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "An explanation." }] }] };
  const post = await startServer(t, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(output), { status: 200 });
    },
  });
  const input = [{ role: "user", content: [{ type: "input_text", text: "Analyze my award." }] }];
  const response = await post({ input, instructions: "Return JSON.", max_output_tokens: 4000,
    text: { format: { type: "json_object" } }, model: "unapproved-client-model", store: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), output);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].headers.Authorization, "Bearer test-only-key");
  assert.equal(calls[0].headers["x-api-key"], undefined);
  assert.equal(calls[0].body.model, "gpt-5.4-mini");
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.max_output_tokens, 4000);
  assert.deepEqual(calls[0].body.input, input);
  assert.deepEqual(calls[0].body.text, { format: { type: "json_object" } });
});

test("model can be configured through OPENAI_MODEL", async (t) => {
  let selectedModel;
  const post = await startServer(t, {
    env: { OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "configured-model" },
    fetchImpl: async (_url, options) => {
      selectedModel = JSON.parse(options.body).model;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal((await post({ input: "Hello" })).status, 200);
  assert.equal(selectedModel, "configured-model");
});

test("full-document analysis forwards its strict schema and larger extraction budget", async (t) => {
  const { format } = require("../analysis");
  let sent;
  const post=await startServer(t,{
    env:{OPENAI_API_KEY:"test-only-key"},
    fetchImpl:async (_url,options)=>{sent=JSON.parse(options.body);return new Response("{}",{status:200});},
  });
  assert.equal((await post({input:"Analyze all parts.",max_output_tokens:16000,text:{format}})).status,200);
  assert.equal(sent.max_output_tokens,16000);
  assert.deepEqual(sent.text.format,format);
  assert.equal(sent.store,false);
});

test("missing credentials and invalid inputs fail locally without an upstream call", async (t) => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Should not be called."); };
  const missing = await startServer(t, { env: {}, fetchImpl });
  const response = await missing({ input: "Hello" });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error.message, /OPENAI_API_KEY/);
  const configured = await startServer(t, { env: { OPENAI_API_KEY: "test-only-key" }, fetchImpl });
  assert.equal((await configured({ input: [] })).status, 400);
  assert.equal((await configured({ input: "Hello", max_output_tokens: 999999 })).status, 400);
  assert.equal(calls, 0);
});

test("OpenAI errors retain their status and message", async (t) => {
  const post = await startServer(t, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Rate limit reached.", code: "rate_limit_exceeded" } }), { status: 429 }),
  });
  const response = await post({ input: "Hello" });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, "rate_limit_exceeded");
});

test("upstream network failures and non-JSON responses produce clear gateway errors", async (t) => {
  const failed = await startServer(t, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => { throw new Error("Connection failed."); },
  });
  const failure = await failed({ input: "Hello" });
  assert.equal(failure.status, 502);
  assert.match((await failure.json()).error.message, /reach OpenAI/);
  const invalid = await startServer(t, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
  });
  const response = await invalid({ input: "Hello" });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error.message, /Invalid response/);
});
