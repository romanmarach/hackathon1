const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const { createApp } = require("../server");
const root = path.join(__dirname, "..");

async function localServer(t, options = {}) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("static hosting exposes browser assets and blocks repository/server/private files", async t => {
  const base = await localServer(t);
  for (const url of ["/", "/app.js", "/styles.css", "/analysis.js"]) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-powered-by"), null);
    await res.arrayBuffer();
  }
  for (const url of ["/.env", "/.env.example", "/.git/config", "/server.js", "/openai-proxy.js", "/security-headers.js", "/package.json", "/netlify/functions/openai.mjs", "/testDocs/test_student_loan.pdf", "/node_modules/express/package.json", "/.preview/cedar-extraction.json"]) {
    const res = await fetch(base + url);
    assert.equal(res.status, 404, url);
    await res.arrayBuffer();
  }
});

test("Netlify build publishes only the allowlisted assets, removing stale output", () => {
  const run = () => spawnSync(process.execPath, ["scripts/build-public.cjs"], { cwd: root, encoding: "utf8" });
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(root, "dist", "accidental-secret.txt"), "test-only-not-a-secret");
  assert.equal(run().status, 0);
  assert.deepEqual(fs.readdirSync(path.join(root,"dist")).sort(), ["_headers", "analysis.js", "app.js", "index.html", "styles.css"]);
  assert.match(fs.readFileSync(path.join(root,"netlify.toml"),"utf8"), /publish = "dist"/);
});

test("upstream authentication errors never expose credentials or account details", async t => {
  const secret = "test-only-credential-value";
  const base = await localServer(t, { env:{OPENAI_API_KEY:secret}, fetchImpl:async()=>Response.json({error:{message:`Incorrect key ${secret}; account test-account`,code:secret,param:secret}}, {status:401}) });
  const response = await fetch(base + "/api/openai/responses", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({input:"Explain this award."}) });
  assert.equal(response.status,401);
  const body = await response.text();
  assert.doesNotMatch(body,/test-only-credential-value|test-account/);
  assert.match(body,/credentials need attention/);
  assert.equal(response.headers.get("cache-control"),"no-store");
});

test("malformed JSON gets a controlled response without parser internals", async t => {
  const base=await localServer(t);
  const response=await fetch(base+"/api/openai/responses",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"private-document-text":'});
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:{message:"Invalid JSON request."}});
});

test("Netlify rejects cross-site and form requests before calling the AI", async () => {
  const {createHandler,config}=await import("../netlify/functions/openai.mjs");
  let calls=0;
  const handler=createHandler({env:{OPENAI_API_KEY:"test-only"},fetchImpl:async()=>{calls++;return Response.json({status:"completed"});}});
  const request=(headers)=>new Request("https://example.com/api/openai/responses",{method:"POST",headers,body:JSON.stringify({input:"Explain a loan."})});
  assert.equal((await handler(request({"Content-Type":"text/plain"}))).status,415);
  assert.equal((await handler(request({"Content-Type":"application/json",Origin:"https://other.example"}))).status,403);
  assert.equal((await handler(request({"Content-Type":"application/json","Sec-Fetch-Site":"cross-site"}))).status,403);
  assert.equal(calls,0);
  const response=await handler(request({"Content-Type":"application/json",Origin:"https://example.com"}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(calls,1);
  assert.deepEqual(config.rateLimit,{windowLimit:20,windowSize:60,aggregateBy:["ip","domain"]});
});

test("proxy rejects remote URLs, account file IDs, and tool-result input", async t => {
  let calls=0;
  const base=await localServer(t,{env:{OPENAI_API_KEY:"test-only"},fetchImpl:async()=>{calls++;return Response.json({});}});
  for (const input of [
    [{role:"user",content:[{type:"input_file",file_id:"file-other-account-data"}]}],
    [{role:"user",content:[{type:"input_file",file_url:"https://other.example/private.pdf"}]}],
    [{role:"user",content:[{type:"input_image",image_url:"https://other.example/image.png"}]}],
    [{role:"user",content:[{type:"input_image",image_url:"data:image/png;base64,aW1hZ2U=",file_id:"file-other-account-data"}]}],
    [{type:"function_call_output",call_id:"other",output:"data"}],
  ]) {
    const response=await fetch(base+"/api/openai/responses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input})});
    assert.equal(response.status,400);
    await response.arrayBuffer();
  }
  assert.equal(calls,0);
});

test("oversized requests are rejected without calling the AI", async t => {
  let calls=0;
  const base=await localServer(t,{env:{OPENAI_API_KEY:"test-only"},fetchImpl:async()=>{calls++;return Response.json({});}});
  const response=await fetch(base+"/api/openai/responses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:"x".repeat(6*1024*1024+1)})});
  assert.equal(response.status,413);
  assert.deepEqual(await response.json(),{error:{message:"Document request is too large."}});
  assert.equal(calls,0);
});
