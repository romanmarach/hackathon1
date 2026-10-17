const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");

// Exercise the real upload listeners, rendering and request construction without
// making paid API calls. This DOM double models only the browser APIs used here.
class Element {
  constructor() {
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.dataset = {};
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.scrollHeight = 0;
    this.classList = { add() {}, remove() {} };
    this._html = "";
    this._text = "";
  }
  set textContent(value) {
    this._text = String(value);
    this._html = "";
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  set innerHTML(value) {
    this._html = value;
    this._text = "";
    this.children = [];
  }
  get innerHTML() {
    return this._html + this.children.map((child) => child.innerHTML).join("");
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }
}

function analysis(overrides = {}) {
  return {
    valid: true,
    documentType: "Award Letter",
    institution: "Student University",
    summary: "A unique student award.",
    totalCost: 30000,
    reportedTotals: { giftAid: 18000 },
    funding: [{ id: "unique", name: "Unique Grant", kind: "grant", amount: 18000, amountBasis: "document_period", source: "Page 1" }],
    sections: [{ id: "award", title: "Award letter", status: "extracted", summary: "One grant", source: "Page 1", details: [], missingDetails: [] }],
    detectedSectionCount: 1,
    healthScore: 82,
    healthScoreBasis: "financial_risk",
    healthReason: "Most costs are covered by grants.",
    documents: [{ title: "Unique Grant", rows: [{ label: "Amount", value: "$18,000" }] }],
    redFlags: [
      { type: "red", title: "Unique risk", body: "Check this condition." },
      { type: "amber", title: "Renew annually", body: "Renewal is required." },
    ],
    actions: ["Confirm the renewal date."],
    ...overrides,
  };
}

function apiResponse(value) {
  return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: value }] }] }) };
}

function createApp(fetchImpl = async () => apiResponse("A grounded answer.")) {
  const nodes = new Map();
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element();
    node.id = match[1];
    node.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || "";
    node.hidden = /\bhidden(?:\s|>)/.test(match[0]);
    const display = match[0].match(/display:\s*([^;" ]+)/)?.[1];
    if (display) node.style.display = display;
    node.textContent = html.slice(match.index + match[0].length).split("<")[0].trim();
    nodes.set(node.id, node);
  }
  const badge = nodes.get("red-flags-badge") || new Element();
  badge.textContent = html.match(/class="nav-badge"[^>]*>([^<]*)/)?.[1] || "";
  const requests = [];
  const sandbox = {
    console,
    setTimeout,
    AbortController,
    navigator: {},
    document: {
      addEventListener() {},
      getElementById: (id) => nodes.get(id) || null,
      querySelectorAll: () => [],
      querySelector: (selector) => selector.includes("nav-badge") ? badge : null,
      createElement: () => new Element(),
    },
    FileReader: class {
      readAsText(file) { this.onload({ target: { result: file.content } }); }
      readAsDataURL(file) {
        this.onload({ target: { result: "data:application/octet-stream;base64," + Buffer.from(file.content || "").toString("base64") } });
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      return fetchImpl(url, options);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "analysis.js"), "utf8"), sandbox);
  vm.runInContext(script, sandbox);
  return {
    app: sandbox,
    nodes,
    badge,
    requests,
    upload: async (name = "student-award.txt") => {
      const input = nodes.get("file-input");
      input.files = [{ name, content: "A student award letter." }];
      input.value = name;
      await input.listeners.change({ target: input });
    },
  };
}

test("fresh launch shows no sample warnings, score or reviewed-document claim", () => {
  const scanner = html.split('id="page-redflags"')[1].split("<!-- TERM DECODER -->")[0];
  assert.doesNotMatch(scanner, /3 critical|Variable interest rate|ring-number">63/);
  assert.doesNotMatch(html, /Online — NJIT documents loaded|I've reviewed your NJIT/);
  const { nodes, badge } = createApp();
  assert.equal(badge.textContent, "");
  assert.equal(badge.style.display, "none");
  assert.equal(nodes.get("redflags-results").style.display, "none");
  assert.match(nodes.get("chat-log").textContent, /upload/i);
});

test("successful upload synchronizes dashboard, scanner score, counts and source", async () => {
  const { upload, nodes, badge } = createApp(async () => apiResponse(JSON.stringify(analysis())));
  await upload();
  assert.equal(nodes.get("metric-owed").textContent, "$12,000");
  assert.equal(nodes.get("score-number").textContent, "82");
  assert.equal(nodes.get("redflags-score-number").textContent, "82");
  assert.equal(nodes.get("score-ring-circle").getAttribute("stroke-dashoffset"),
    nodes.get("redflags-score-ring").getAttribute("stroke-dashoffset"));
  assert.match(nodes.get("redflags-counts").textContent, /1 critical.*1 warning.*0 good/);
  assert.equal(badge.textContent, "1");
  assert.notEqual(badge.style.display, "none");
  assert.match(nodes.get("red-flags-dynamic").innerHTML, /Unique risk/);
  assert.equal(nodes.get("dashboard-risk-count").textContent, "2");
  assert.match(nodes.get("dashboard-risks").innerHTML, /Unique risk/);
  assert.equal(nodes.get("decoded-count").textContent, "1 funding item");
  assert.match(nodes.get("dashboard-source").textContent, /student-award.txt/);
  assert.match(nodes.get("chat-context-status").textContent, /student-award.txt/);
});

test("every chat request includes the active analysis and preserves conversation", async () => {
  const { app, upload, requests } = createApp(async (_url, options) => {
    const body = JSON.parse(options.body);
    return apiResponse(body.instructions.includes("document analyzer") ? JSON.stringify(analysis()) : "Your gap is $12,000.");
  });
  await upload();
  await app.sendMessage("What is my remaining cost?");
  await app.sendMessage("What should I do next?");
  for (const request of requests.slice(1)) {
    assert.match(request.body.instructions, /12000/);
    assert.match(request.body.instructions, /Unique Grant/);
    assert.match(request.body.instructions, /student-award.txt/);
    assert.match(request.body.instructions, /missing|unknown|not.*provided/i);
  }
  assert.equal(requests[2].body.input.length, 3);
});

test("chat before upload explicitly receives no document context", async () => {
  const { app, requests } = createApp();
  await app.sendMessage("How much will I owe?");
  assert.match(requests[0].body.instructions, /no.*document.*(?:loaded|uploaded|analyzed)/i);
  assert.doesNotMatch(requests[0].body.instructions, /You have reviewed the student's/);
});

test("sample data is explicitly labeled and uses the same score and flag counts", async () => {
  const { app, nodes, badge, requests } = createApp();
  nodes.get("load-sample-btn").listeners.click();
  assert.match(nodes.get("dashboard-source").textContent, /sample/i);
  assert.match(nodes.get("redflags-source").textContent, /sample/i);
  assert.match(nodes.get("chat-context-status").textContent, /sample/i);
  assert.equal(nodes.get("score-number").textContent, "63");
  assert.equal(nodes.get("redflags-score-number").textContent, "63");
  assert.equal(badge.textContent, "3");
  assert.equal(nodes.get("dashboard-risk-count").textContent, "6");
  assert.match(nodes.get("redflags-counts").textContent, /3 critical.*3 warnings.*2 good/);
  await app.sendMessage("What is the remaining cost?");
  assert.match(requests[0].body.instructions, /15700/);
  assert.match(requests[0].body.instructions, /sample/i);
});

test("switching documents restores upload controls and clears previous results and chat", async () => {
  const { app, nodes, badge, requests, upload } = createApp(async (_url, options) => {
    const body = JSON.parse(options.body);
    return apiResponse(body.instructions.includes("document analyzer") ? JSON.stringify(analysis()) : "Old answer.");
  });
  app.loadSampleData();
  await app.sendMessage("Old question about sample data.");
  nodes.get("new-document-btn").listeners.click();
  assert.equal(nodes.get("upload-section").style.display, "block");
  assert.equal(nodes.get("upload-zone").style.display, "block");
  assert.equal(nodes.get("demo-section").style.display, "none");
  assert.equal(nodes.get("redflags-results").style.display, "none");
  assert.equal(badge.textContent, "");
  assert.equal(nodes.get("dashboard-risk-count").textContent, "");
  assert.equal(nodes.get("dashboard-risks").innerHTML, "");
  assert.doesNotMatch(nodes.get("chat-log").textContent, /Old question|Old answer/);
  await upload("new-award.txt");
  assert.equal(nodes.get("file-input").value, "");
  await app.sendMessage("New question.");
  const latest = requests.at(-1).body;
  assert.equal(latest.input.length, 1);
  assert.match(latest.instructions, /new-award.txt/);
  assert.doesNotMatch(latest.instructions, /Sallie Mae/);
});

test("an invalid replacement leaves no previous document context", async () => {
  const { app, upload, nodes, requests, badge } = createApp(async (_url, options) => {
    const body = JSON.parse(options.body);
    return apiResponse(body.instructions.includes("document analyzer")
      ? JSON.stringify({ valid: false, reason: "This is a resume." }) : "Please upload an award.");
  });
  app.loadSampleData();
  await upload("resume.txt");
  assert.equal(nodes.get("invalid-doc").style.display, "block");
  assert.match(nodes.get("invalid-reason").textContent, /resume/);
  assert.equal(nodes.get("upload-zone").style.display, "block");
  assert.equal(badge.textContent, "");
  await app.sendMessage("What is my remaining cost?");
  assert.doesNotMatch(requests.at(-1).body.instructions, /15700|Sallie Mae/);
});

test("a document with no flags has an explicit result and no critical badge", async () => {
  const { upload, nodes, badge } = createApp(async () => apiResponse(JSON.stringify(analysis({ redFlags: [] }))));
  await upload();
  assert.match(nodes.get("redflags-counts").textContent, /0 critical.*0 warnings.*0 good/);
  assert.match(nodes.get("red-flags-dynamic").textContent, /no.*flags/i);
  assert.equal(badge.style.display, "none");
});

test("an old chat response cannot enter a new conversation or unlock its pending request", async () => {
  const pending = [];
  const { app, nodes, requests } = createApp(() => new Promise((resolve) => pending.push(resolve)));
  app.loadSampleData();
  const oldChat = app.sendMessage("Old question.");
  app.startNewDocument();
  const newChat = app.sendMessage("New question.");
  pending[0](apiResponse("Old reply that must be discarded."));
  await oldChat;
  assert.doesNotMatch(nodes.get("chat-log").textContent, /Old reply|Old question/);
  assert.equal(nodes.get("chat-send-btn").disabled, true);
  assert.equal(requests[0].signal.aborted, true);
  pending[1](apiResponse("New reply."));
  await newChat;
  assert.match(nodes.get("chat-log").textContent, /New reply/);
  assert.equal(nodes.get("chat-send-btn").disabled, false);
});

test("late upload responses cannot replace explicitly selected sample data", async () => {
  let resolveUpload;
  const { app, upload, nodes } = createApp(() => new Promise((resolve) => { resolveUpload = resolve; }));
  const pendingUpload = upload();
  // File reading resolves on the next microtask before the analysis request.
  await new Promise((resolve) => setImmediate(resolve));
  app.loadSampleData();
  resolveUpload(apiResponse(JSON.stringify(analysis())));
  await pendingUpload;
  assert.equal(nodes.get("metric-owed").textContent, "$15,700");
  assert.match(nodes.get("dashboard-source").textContent, /sample/i);
});

test("missing amounts and scores remain unknown, and malformed arrays cannot crash the flow", async () => {
  const { upload, nodes } = createApp(async () => apiResponse(JSON.stringify(analysis({
    totalCost: null,
    reportedTotals: { giftAid: 0 },
    funding: null,
    remainingCost: null,
    healthScore: null,
    documents: { title: "Unexpected response shape" },
    actions: null,
    redFlags: null,
  }))));
  await upload();
  assert.equal(nodes.get("metric-total").textContent, "Not provided");
  assert.equal(nodes.get("metric-free").textContent, "$0");
  assert.equal(nodes.get("metric-owed").textContent, "Not provided");
  assert.equal(nodes.get("score-number").textContent, "—");
  assert.equal(nodes.get("redflags-score-number").textContent, "—");
  assert.equal(nodes.get("demo-section").style.display, "block");
  assert.equal(nodes.get("invalid-doc").style.display, "none");
});

test("a failed chat request can be retried without sending errors as assistant facts", async () => {
  let calls = 0;
  const { app, requests, nodes } = createApp(async () => {
    if (++calls === 1) return { ok: false, status: 429, json: async () => ({ error: { message: "Try again shortly." } }) };
    return apiResponse("A successful reply.");
  });
  await app.sendMessage("First attempt.");
  assert.equal(nodes.get("chat-send-btn").disabled, false);
  assert.match(nodes.get("chat-log").textContent, /Try again shortly/);
  await app.sendMessage("Retry my question.");
  assert.equal(requests[1].body.input.length, 1);
  assert.equal(requests[1].body.input[0].content, "Retry my question.");
  assert.match(nodes.get("chat-log").textContent, /A successful reply/);
});

test("extracted document text is displayed as content rather than executable markup", async () => {
  const markup = '<img src=x onerror="alert(1)">';
  const { upload, nodes } = createApp(async () => apiResponse(JSON.stringify(analysis({
    healthReason: markup,
    funding: [{ id: "xss", name: markup, kind: "grant", amount: 18000, amountBasis: "document_period", conditions: [markup] }],
    actions: [markup],
    redFlags: [{ type: "red", title: markup, body: markup }],
  }))));
  await upload();
  assert.equal(nodes.get("score-desc").textContent, markup);
  for (const id of ["doc-cards", "action-items", "red-flags-dynamic"]) {
    assert.doesNotMatch(nodes.get(id).innerHTML, /<img|onclick=/);
    assert.match(nodes.get(id).innerHTML, /&lt;img/);
  }
});

test("the invalid-upload sample button also enters the shared sample mode", async () => {
  const { upload, nodes } = createApp(async () => apiResponse(JSON.stringify({ valid: false, reason: "A resume." })));
  await upload();
  nodes.get("load-sample-btn-2").listeners.click();
  assert.equal(nodes.get("invalid-doc").style.display, "none");
  assert.equal(nodes.get("demo-section").style.display, "block");
  assert.match(nodes.get("dashboard-source").textContent, /sample/i);
  assert.equal(nodes.get("redflags-score-number").textContent, "63");
});

test("dropping a file uses the same analysis flow and replaces sample context", async () => {
  const { app, nodes, requests } = createApp(async () => apiResponse(JSON.stringify(analysis())));
  app.loadSampleData();
  let prevented = false;
  await nodes.get("upload-zone").listeners.drop({
    preventDefault() { prevented = true; },
    dataTransfer: { files: [{ name: "dropped-award.txt", content: "My financial aid letter." }] },
  });
  assert.equal(prevented, true);
  assert.equal(requests.length, 1);
  assert.equal(nodes.get("metric-owed").textContent, "$12,000");
  assert.match(nodes.get("dashboard-source").textContent, /dropped-award.txt/);
  assert.doesNotMatch(nodes.get("dashboard-source").textContent, /Sample/);
  assert.match(nodes.get("chat-context-status").textContent, /dropped-award.txt/);
  assert.equal(nodes.get("dashboard-risk-count").textContent, "2");
});

test("PDF and Word uploads send native OpenAI file inputs with binary contents preserved", async () => {
  const { app, requests } = createApp(async () => apiResponse(JSON.stringify(analysis())));
  for (const [name, mime] of [
    ["award.pdf", "application/pdf"],
    ["award.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ]) {
    const file = await app.extractFileContent({ name, content: "binary content" });
    assert.equal(file.type, "file");
    const result = await app.analyzeDocumentWithOpenAI(file);
    assert.equal(result.valid, true);
    const request = requests.at(-1);
    assert.equal(request.url, "/api/openai/responses");
    assert.deepEqual(request.body.input[0].content[0], {
      type: "input_file", filename: name,
      file_data: `data:${mime};base64,${Buffer.from("binary content").toString("base64")}`,
    });
    assert.equal(request.body.input[0].content[1].type, "input_text");
    assert.equal(request.body.text.format.type, "json_schema");
    assert.equal(request.body.text.format.strict, true);
    assert.equal(request.body.model, undefined);
  }
});

test("image analysis sends OpenAI input_image data URLs", async () => {
  const { app, requests } = createApp(async () => apiResponse(JSON.stringify(analysis())));
  await app.analyzeDocumentWithOpenAI({ type: "image", name: "award.png", mime: "image/png", base64: "aW1hZ2U=" });
  assert.deepEqual(requests[0].body.input[0].content[0], { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=" });
});

test("Responses parser handles reasoning entries, multiple text parts, and refusal or truncation", () => {
  const { app } = createApp();
  assert.equal(app.getResponseText({ status: "completed", output: [
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text: "First" }, { type: "output_text", text: "Second" }] },
  ] }), "First\nSecond");
  assert.throws(() => app.getResponseText({ status: "incomplete", output: [] }), /incomplete/);
  assert.throws(() => app.getResponseText({ output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot process this file." }] }] }), /Cannot process/);
});

test("malformed structured output fails without inventing a repaired extraction", async () => {
  const { app, requests } = createApp(async () => apiResponse('{"valid":true,'));
  const result = await app.analyzeDocumentWithOpenAI({ name: "award.txt", type: "text", content: "My award." });
  assert.equal(result.valid, false);
  assert.match(result.reason, /malformed JSON/);
  assert.equal(requests.length, 1);
});

test("a fully funded package still shows the cost after gift aid and total borrowing", () => {
  const { app, nodes } = createApp();
  app.setCurrentDocument({
    ...analysis(), totalCost: 59500, freeAid: 24700, remainingCost: 0,
    reportedTotals: { giftAid: 24700, workStudy: 2800, totalBorrowing: 32000, unmetNeed: 0 },
    funding: [
      { id: "gift", name: "Grants and scholarships", kind: "grant", amount: 24700, amountBasis: "document_period" },
      { id: "work", name: "Work-study", kind: "work_study", amount: 2800, amountBasis: "document_period" },
      { id: "student", name: "Student loans", kind: "other_loan", amount: 15000, amountBasis: "document_period", loan: { borrower: "student" } },
      { id: "parent", name: "Parent PLUS", kind: "parent_plus", amount: 17000, amountBasis: "document_period", loan: { borrower: "parent" } },
    ],
  }, "upload", "Hartwell.pdf");
  assert.equal(nodes.get("metric-owed").textContent, "$34,800");
  assert.equal(nodes.get("metric-borrowed").textContent, "$32,000");
  assert.equal(nodes.get("reported-unmet-need").textContent, "$0");
});

test("Hartwell deadlines, source inventory, loan conditions and repayment caveats are rendered", () => {
  const { app, nodes } = createApp();
  app.setCurrentDocument(require("./fixtures/hartwell.expected.json"), "upload", "Hartwell.pdf");
  assert.match(nodes.get("dashboard-source").textContent, /fictional test/);
  assert.match(nodes.get("coverage-summary").textContent, /12 \/ 12/);
  assert.match(nodes.get("deadline-items").innerHTML, /May 1, 2027/);
  assert.match(nodes.get("deadline-items").innerHTML, /August 20, 2027/);
  assert.match(nodes.get("repayment-items").innerHTML, /Actual payments may be higher/);
  assert.match(nodes.get("disbursement-items").innerHTML, /January 12, 2028/);
  assert.match(nodes.get("doc-cards").innerHTML, /36 consecutive/);
  assert.match(nodes.get("doc-cards").innerHTML, /120 days/);
  assert.doesNotMatch(nodes.get("doc-cards").innerHTML, /Best Type|Free Money/);
  app.startNewDocument();
  assert.doesNotMatch(nodes.get("deadline-items").innerHTML, /May 1, 2027/);
  assert.doesNotMatch(nodes.get("coverage-sections").innerHTML, /Part 12/);
});

test("long text is sent completely and oversized text fails explicitly", async () => {
  const { app, requests } = createApp(async () => apiResponse(JSON.stringify(analysis())));
  const content="x".repeat(9000)+"DEADLINE_AT_END";
  await app.analyzeDocumentWithOpenAI({name:"long.txt",type:"text",content});
  assert.match(requests[0].body.input[0].content,/DEADLINE_AT_END/);
  const result=await app.analyzeDocumentWithOpenAI({name:"huge.txt",type:"text",content:"x".repeat(200001)});
  assert.equal(result.valid,false);
  assert.match(result.reason,/too long/);
  assert.equal(requests.length,1);
});
