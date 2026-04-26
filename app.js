// NAVIGATION

const API_PROXY_ENDPOINT = "/api/anthropic/messages";

function goTo(pageId) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById("page-" + pageId).classList.add("active");
  const btn = document.querySelector('[data-page="' + pageId + '"]');
  if (btn) btn.classList.add("active");
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => goTo(btn.dataset.page));
});

// ── FILE READING ──────────────────────────────────────────────────
// Reads uploaded files and returns { name, content, base64, type }

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractFileContent(file) {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop();

  // PDFs — send as base64 to Claude's vision API
  if (ext === "pdf") {
    const base64 = await readFileAsBase64(file);
    return { name: file.name, type: "pdf", base64 };
  }

  // Images — send as base64 vision
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
    const base64 = await readFileAsBase64(file);
    return { name: file.name, type: "image", base64, mime: file.type };
  }

  // Plain text, markdown, csv
  if (["txt", "md", "csv", "rtf"].includes(ext)) {
    const text = await readFileAsText(file);
    return { name: file.name, type: "text", content: text };
  }

  // DOCX — read as text (browser can't parse binary docx well, but Claude can try)
  if (["docx", "doc"].includes(ext)) {
    try {
      const text = await readFileAsText(file);
      return { name: file.name, type: "text", content: text };
    } catch {
      return { name: file.name, type: "unsupported", content: "" };
    }
  }

  // Anything else — flag as unsupported
  return { name: file.name, type: "unsupported", content: "" };
}

// ── DOCUMENT ANALYSIS PROMPT ──────────────────────────────────────

const ANALYSIS_SYSTEM = `You are Debt Decoder AI, a financial aid document analyzer built specifically for NJIT students.

Your job is to:
1. Determine if the uploaded document is a valid financial aid document (award letter, scholarship letter, tuition bill, loan document, NJ state aid letter, FAFSA output, etc.)
2. If it IS a valid financial aid document: extract all key financial data and return it as JSON.
3. If it is NOT a valid financial aid document (e.g. a resume, essay, recipe, random document): return an error JSON.

You MUST respond with ONLY valid JSON, no other text, no markdown code fences.

If VALID financial document, respond with this exact structure:
{
  "valid": true,
  "documentType": "e.g. Award Letter / Scholarship Letter / Tuition Bill / Loan Offer",
  "institution": "name of school or lender",
  "summary": "1-2 sentence plain English summary of what this document is",
  "totalCost": 0,
  "freeAid": 0,
  "remainingCost": 0,
  "healthScore": 0,
  "healthReason": "short explanation of health score",
  "documents": [
    {
      "title": "document/award name",
      "subtitle": "issuer or type",
      "badgeType": "green|amber|red|blue",
      "badgeLabel": "Free Money|Conditional|Watch Out|Best Type",
      "rows": [
        { "label": "field name", "value": "field value", "color": "green|amber|red|" }
      ]
    }
  ],
  "redFlags": [
    { "type": "red|amber|green", "title": "flag title", "body": "explanation with dollar amounts" }
  ],
  "actions": [
    "action item text"
  ]
}

If NOT a valid financial aid document, respond with:
{
  "valid": false,
  "reason": "Clear explanation of what the document IS and why it's not a financial aid document. Be friendly but direct. E.g. 'This appears to be a resume, not a financial aid document. Please upload an award letter, scholarship letter, tuition bill, or loan offer.'"
}

IMPORTANT RULES:
- healthScore should be 0-100. High free aid + low interest = higher score. Variable rates, no grace period, high debt = lower score.
- Always quantify red flags in real dollars where possible.
- If you cannot extract specific numbers, use 0 and note it in the summary.
- Document types you should recognize: award letters, scholarship letters, tuition bills, loan promissory notes, FAFSA output, financial aid offer letters, NJ TAG/EOF letters, work-study offers.
- Document types that are NOT valid: resumes, essays, transcripts, syllabi, recipes, code files, images of people, general PDFs unrelated to financial aid.`;

// ── CALL CLAUDE WITH FILE ─────────────────────────────────────────

async function repairMalformedJson(rawText) {
  try {
    const res = await fetch(API_PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2200,
        system:
          "You repair malformed JSON. Return only valid JSON with no markdown code fences.",
        messages: [
          {
            role: "user",
            content: `Fix this malformed JSON so it parses. Preserve meaning and keys.\n\n${rawText}`,
          },
        ],
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const fixed = data?.content?.find?.((c) => c.type === "text")?.text;
    if (!fixed) return null;
    const clean = fixed.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

async function analyzeDocumentWithClaude(fileData) {
  let messages;

  if (fileData.type === "pdf") {
    messages = [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: fileData.base64,
            },
          },
          {
            type: "text",
            text: `Please analyze this document: "${fileData.name}". Determine if it is a valid financial aid document and extract all relevant data. Respond only with JSON.`,
          },
        ],
      },
    ];
  } else if (fileData.type === "image") {
    messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: fileData.mime || "image/jpeg",
              data: fileData.base64,
            },
          },
          {
            type: "text",
            text: `Please analyze this document image: "${fileData.name}". Determine if it is a valid financial aid document and extract all relevant data. Respond only with JSON.`,
          },
        ],
      },
    ];
  } else if (fileData.type === "text" && fileData.content) {
    messages = [
      {
        role: "user",
        content: `Please analyze this document: "${fileData.name}"\n\nContent:\n${fileData.content.slice(0, 8000)}\n\nDetermine if it is a valid financial aid document and extract all relevant data. Respond only with JSON.`,
      },
    ];
  } else {
    // Unsupported file type
    return {
      valid: false,
      reason: `The file "${fileData.name}" is in a format that cannot be read directly in the browser (${fileData.name.split(".").pop().toUpperCase()} files). Please upload a PDF, image (JPG/PNG), or text file instead.`,
    };
  }

  try {
    const res = await fetch(API_PROXY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        system: ANALYSIS_SYSTEM,
        messages,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Anthropic API error (${res.status})`;
      return { valid: false, reason: msg };
    }

    const raw = data?.content?.find?.((c) => c.type === "text")?.text;
    if (!raw) {
      return { valid: false, reason: "Anthropic returned no text content." };
    }

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(clean);
    } catch {
      const repaired = await repairMalformedJson(clean);
      if (repaired) return repaired;
      return {
        valid: false,
        reason:
          "AI returned malformed JSON while reading this file. Please retry upload.",
      };
    }
  } catch (err) {
    return {
      valid: false,
      reason: err?.message || "Could not reach Anthropic API.",
    };
  }
}

// ── UPLOAD HANDLER ────────────────────────────────────────────────

document
  .getElementById("file-input")
  .addEventListener("change", async function (e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // Show analyzing state
    setAnalyzingState(files[0].name);

    try {
      const fileData = await extractFileContent(files[0]);
      const result = await analyzeDocumentWithClaude(fileData);

      if (result.valid) {
        populateDashboard(result);
        populateRedFlags(result.redFlags || []);
        showDemoSection();
      } else {
        showInvalidDocument(result.reason);
      }
    } catch (err) {
      console.error(err);
      showError(
        "Something went wrong while analyzing your document. Please try again.",
      );
    }
  });

// Also handle the "Load Sample" button
document
  .getElementById("load-sample-btn")
  .addEventListener("click", loadSampleData);

// ── UI STATE FUNCTIONS ────────────────────────────────────────────

function setAnalyzingState(filename) {
  document.getElementById("upload-zone").style.display = "none";
  document.getElementById("analyzing").style.display = "block";
  document.getElementById("analyzing-filename").textContent = filename;
  document.getElementById("invalid-doc").style.display = "none";
  document.getElementById("demo-section").style.display = "none";

  // Re-trigger the progress bar animation
  const fill = document.getElementById("progress-fill");
  fill.style.animation = "none";
  fill.offsetHeight; // reflow
  fill.style.animation = "progress 3s ease forwards";
}

function showDemoSection() {
  document.getElementById("analyzing").style.display = "none";
  document.getElementById("upload-section").style.display = "none";
  document.getElementById("invalid-doc").style.display = "none";
  document.getElementById("demo-section").style.display = "block";
}

function showInvalidDocument(reason) {
  document.getElementById("analyzing").style.display = "none";
  document.getElementById("upload-zone").style.display = "block";
  const invalidEl = document.getElementById("invalid-doc");
  document.getElementById("invalid-reason").textContent = reason;
  invalidEl.style.display = "block";
}

function showError(msg) {
  showInvalidDocument(msg);
}

// ── DASHBOARD POPULATION ──────────────────────────────────────────

function populateDashboard(data) {
  // Metrics
  document.getElementById("metric-total").textContent =
    formatMoney(data.totalCost) || "$—";
  document.getElementById("metric-free").textContent =
    formatMoney(data.freeAid) || "$—";
  document.getElementById("metric-owed").textContent =
    formatMoney(data.remainingCost) || "$—";

  // Score ring
  const score = data.healthScore || 0;
  document.getElementById("score-number").textContent = score;
  document.getElementById("score-val").textContent =
    `${score} / 100 — ${scoreLabel(score)}`;
  document.getElementById("score-desc").innerHTML =
    (data.healthReason || "") +
    ` <span style="color:var(--red); cursor:pointer" onclick="goTo('redflags')">View red flags →</span>`;

  // Update SVG ring stroke
  const circumference = 226.19;
  const offset = circumference - (score / 100) * circumference;
  const ring = document.getElementById("score-ring-circle");
  if (ring) {
    ring.setAttribute("stroke-dashoffset", offset.toFixed(1));
    ring.setAttribute("stroke", scoreColor(score));
  }
  document.getElementById("score-number").style.color = scoreColor(score);
  document.getElementById("score-val").style.color = scoreColor(score);

  // Document cards
  const container = document.getElementById("doc-cards");
  container.innerHTML = "";

  (data.documents || []).forEach((doc) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-header-row">
        <div>
          <div class="card-title">${doc.title}</div>
          ${doc.subtitle ? `<div style="font-size:12px; color:var(--g500)">${doc.subtitle}</div>` : ""}
        </div>
        <span class="badge ${doc.badgeType || "blue"}">${doc.badgeLabel || ""}</span>
      </div>
      ${(doc.rows || [])
        .map(
          (r) => `
        <div class="data-row">
          <span class="data-row-label">${r.label}</span>
          <span class="data-row-value ${r.color || ""}">${r.value}</span>
        </div>
      `,
        )
        .join("")}
    `;
    container.appendChild(card);
  });

  // Action items
  const actionsEl = document.getElementById("action-items");
  actionsEl.innerHTML = "";
  (data.actions || []).forEach((text, i) => {
    actionsEl.innerHTML += `
      <div class="action-item">
        <div class="action-num">${i + 1}</div>
        <div class="action-text">${text}</div>
      </div>`;
  });
}

function populateRedFlags(flags) {
  const container = document.getElementById("red-flags-dynamic");
  if (!container) return;
  container.innerHTML = "";

  const critical = flags.filter((f) => f.type === "red");
  const warnings = flags.filter((f) => f.type === "amber");
  const good = flags.filter((f) => f.type === "green");

  if (critical.length) {
    container.innerHTML += `<span class="section-label">Critical — address immediately</span>`;
    critical.forEach((f) => (container.innerHTML += flagHTML(f)));
  }
  if (warnings.length) {
    container.innerHTML += `<span class="section-label">Warnings — monitor closely</span>`;
    warnings.forEach((f) => (container.innerHTML += flagHTML(f)));
  }
  if (good.length) {
    container.innerHTML += `<span class="section-label">You're in good shape here</span>`;
    good.forEach((f) => (container.innerHTML += flagHTML(f)));
  }

  // Update badge count
  const badge = document.querySelector('[data-page="redflags"] .nav-badge');
  if (badge) badge.textContent = critical.length;
}

function flagHTML(f) {
  return `
    <div class="flag ${f.type}">
      <div class="flag-dot"></div>
      <div>
        <div class="flag-title">${f.title}</div>
        <div class="flag-body">${f.body}</div>
      </div>
    </div>`;
}

function formatMoney(n) {
  if (!n && n !== 0) return null;
  return "$" + Number(n).toLocaleString();
}

function scoreLabel(s) {
  if (s >= 80) return "Strong";
  if (s >= 60) return "Caution";
  if (s >= 40) return "At Risk";
  return "Critical";
}

function scoreColor(s) {
  if (s >= 80) return "#059669";
  if (s >= 60) return "#D97706";
  if (s >= 40) return "#D97706";
  return "#CC0000";
}

// ── SAMPLE DATA ───────────────────────────────────────────────────

function loadSampleData() {
  const sample = {
    valid: true,
    documentType: "Award Letter",
    institution: "NJIT",
    summary: "Sample NJIT financial aid package for Fall 2025.",
    totalCost: 34200,
    freeAid: 18500,
    remainingCost: 15700,
    healthScore: 63,
    healthReason:
      "Your free aid is strong but your private loan carries serious risks — variable rate, no grace period, and interest capitalizing daily.",
    documents: [
      {
        title: "Highlander Merit Scholarship — $12,000/yr",
        subtitle: "NJIT Presidential Award",
        badgeType: "amber",
        badgeLabel: "Conditional",
        rows: [
          { label: "Annual amount", value: "$12,000", color: "green" },
          { label: "Renewable?", value: "Yes — up to 4 years", color: "" },
          {
            label: "Minimum GPA required",
            value: "3.5 each semester",
            color: "red",
          },
          {
            label: "Minimum credits required",
            value: "15 credits/semester",
            color: "red",
          },
          {
            label: "Major restriction",
            value: "STEM majors only",
            color: "amber",
          },
          {
            label: "Stacks with federal aid?",
            value: "Yes — no penalty",
            color: "green",
          },
        ],
      },
      {
        title: "NJ TAG Grant — $3,500/yr",
        subtitle: "Tuition Aid Grant · New Jersey State",
        badgeType: "green",
        badgeLabel: "Free Money",
        rows: [
          { label: "Type", value: "Grant — never repay", color: "green" },
          { label: "NJ residency required", value: "Yes", color: "" },
          {
            label: "Renewal",
            value: "Must reapply via FAFSA annually",
            color: "amber",
          },
        ],
      },
      {
        title: "Federal Subsidized Loan — $3,500",
        subtitle: "Direct Subsidized Stafford Loan",
        badgeType: "blue",
        badgeLabel: "Best Type",
        rows: [
          { label: "Interest rate", value: "5.50% fixed", color: "green" },
          {
            label: "Interest during school",
            value: "No — government pays it",
            color: "green",
          },
          {
            label: "Grace period",
            value: "6 months after graduation",
            color: "",
          },
          { label: "Monthly payment (10-yr)", value: "~$38/month", color: "" },
        ],
      },
      {
        title: "Private Loan — $8,000",
        subtitle: "Sallie Mae Smart Option Loan",
        badgeType: "red",
        badgeLabel: "⚠ Watch Out",
        rows: [
          {
            label: "Interest rate",
            value: "6.99–14.5% variable",
            color: "red",
          },
          {
            label: "Interest during school",
            value: "Accruing right now, daily",
            color: "red",
          },
          {
            label: "Grace period",
            value: "None — payments start at graduation",
            color: "red",
          },
          {
            label: "Capitalization at graduation",
            value: "~$2,800 added to balance",
            color: "red",
          },
          {
            label: "Monthly payment range",
            value: "$93–$150/month",
            color: "red",
          },
        ],
      },
    ],
    redFlags: [
      {
        type: "red",
        title: "Variable interest rate — private loan",
        body: "Your rate ranges 6.99–14.5%. At the ceiling, monthly payments jump from $93 to $150 — an extra $684/year. Always model the worst case, not the starting rate.",
      },
      {
        type: "red",
        title: "No grace period — payments start at graduation",
        body: "Federal loans give 6 months. Your Sallie Mae loan does not. You need income before your last semester ends or you're immediately at default risk.",
      },
      {
        type: "red",
        title: "Interest capitalizing right now — ~$2,800 at graduation",
        body: "Your private loan accrues ~$1.53/day. In 4 years ~$2,800 gets added to your $8,000 principal. You'll pay interest on $10,800 instead of $8,000 for 10 years — roughly $800 extra total.",
      },
      {
        type: "amber",
        title: "Scholarship GPA floor — 3.5 minimum",
        body: "Dropping to 3.4 at any semester end means losing $12,000 for that year. NJIT CS and engineering courses commonly cause freshman GPA dips.",
      },
      {
        type: "amber",
        title: "15 credits/semester required — above standard load",
        body: "If you drop a class for any reason you risk losing the scholarship. Ask financial aid if a hardship waiver exists before this happens.",
      },
      {
        type: "green",
        title: "Federal subsidized loan — best type available",
        body: "Fixed rate, government pays interest while in school, access to income-driven repayment and forgiveness programs after graduation.",
      },
      {
        type: "green",
        title: "Scholarship stacks with federal aid — no clawback",
        body: "Your Highlander Scholarship doesn't reduce your federal aid eligibility. You receive both without any penalty.",
      },
    ],
    actions: [
      "Set a GPA reminder every semester end. Dropping below 3.5 costs you $12,000 instantly.",
      "Minimize the private loan. Every dollar accrues interest daily. Borrow only what you truly need.",
      "Check EOF eligibility. First-gen NJ students may qualify for $2,000–$5,000 more per year. Email eof@njit.edu.",
      "Enroll in auto-debit on your federal loan to lock in the 0.25% rate discount before first payment.",
    ],
  };

  populateDashboard(sample);
  populateRedFlags(sample.redFlags);
  showDemoSection();
}

// ── TERM DECODER ─────────────────────────────────────────────────

const TERMS = [
  {
    name: "Capitalization",
    preview: "When unpaid interest becomes principal",
    definition:
      "When you don't pay interest while in school, it accumulates silently. At graduation, all unpaid interest gets added to your original loan balance — and you now pay interest on that larger number. On your $8k private loan over 4 years, this adds ~$2,800 that then compounds against you for 10 years of repayment.",
  },
  {
    name: "Forbearance",
    preview: "Pausing payments — interest still runs",
    definition:
      "A temporary pause on loan payments for financial hardship. Sounds helpful — but interest keeps accruing the entire time. When forbearance ends, all accumulated interest capitalizes onto your principal. Use it only as an absolute last resort.",
  },
  {
    name: "Variable rate",
    preview: "Interest rate tied to market conditions",
    definition:
      "An interest rate that rises and falls with a market index. Your Sallie Mae loan at '6.99–14.5% variable' could more than double if rates spike. Always calculate your worst-case payment at the ceiling, not the advertised starting rate.",
  },
  {
    name: "Fixed rate",
    preview: "Locked in forever — no surprises",
    definition:
      "An interest rate set at origination that never changes. Your federal loans are fixed at 5.50%. Almost always better for student borrowers — you can plan exactly what you'll owe every month for the full life of the loan.",
  },
  {
    name: "Grace period",
    preview: "Time before your first payment is due",
    definition:
      "The window between leaving school and your first required payment. Federal loans give 6 months. Your Sallie Mae loan has zero — payments begin immediately after graduating or dropping below half-time.",
  },
  {
    name: "Origination fee",
    preview: "A fee taken before you see the money",
    definition:
      "A fee deducted from your loan before it hits your account. A $10,000 loan with a 1.057% fee deposits $9,894 — but you owe $10,000 plus interest from day one.",
  },
  {
    name: "SAP",
    preview: "Satisfactory Academic Progress rule",
    definition:
      "Federal law requires you to maintain a minimum GPA AND complete a minimum percentage of attempted credits to keep receiving aid. At NJIT, failing or withdrawing from too many courses can suspend your entire financial aid package.",
  },
  {
    name: "Disbursement",
    preview: "When your aid money is released",
    definition:
      "The date NJIT releases financial aid to your account. If aid exceeds tuition you receive a refund — but loan portions of that refund must be repaid with interest. Don't spend it without knowing where it came from.",
  },
  {
    name: "Subsidized loan",
    preview: "Govt pays your interest while in school",
    definition:
      "A federal loan where the government covers interest while you're enrolled at least half-time. Your $3,500 federal loan is subsidized — no interest builds until 6 months after leaving school.",
  },
  {
    name: "EOF Grant",
    preview: "NJ grant for first-gen students — often missed",
    definition:
      "Educational Opportunity Fund — NJ's grant for first-generation, low-income students. Worth $2,000–$5,000/year on top of TAG at NJIT. Many eligible students never apply. Email eof@njit.edu to check.",
  },
  {
    name: "TAG Grant",
    preview: "New Jersey's main state grant",
    definition:
      "The Tuition Aid Grant is NJ's primary state grant for residents attending NJ colleges. Never needs to be repaid. Must renew annually via FAFSA. You're currently receiving $3,500.",
  },
  {
    name: "Auto-debit discount",
    preview: "0.25% rate cut that can vanish permanently",
    definition:
      "Many lenders offer a 0.25% rate reduction for auto-pay enrollment. If a single payment bounces, many lenders remove the discount permanently. Use a dedicated account with always-sufficient funds.",
  },
];

function buildTerms() {
  const grid = document.getElementById("terms-grid");
  let openIndex = null;

  TERMS.forEach((term, i) => {
    const card = document.createElement("div");
    card.className = "term-card";
    card.innerHTML = `
      <div class="term-header">
        <div>
          <div class="term-name">${term.name}</div>
          <div class="term-preview">${term.preview}</div>
        </div>
        <div class="term-arrow">▼</div>
      </div>
      <div class="term-definition">${term.definition}</div>
    `;
    card.addEventListener("click", () => {
      if (openIndex === i) {
        card.classList.remove("open");
        openIndex = null;
      } else {
        document
          .querySelectorAll(".term-card")
          .forEach((c) => c.classList.remove("open"));
        card.classList.add("open");
        openIndex = i;
      }
    });
    grid.appendChild(card);
  });
}

buildTerms();

// ── CHAT ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Debt Decoder AI, a financial aid advisor built specifically for NJIT (New Jersey Institute of Technology) students. You have reviewed the student's financial aid documents. Be direct, specific, and use plain language. Quantify in real dollars whenever possible. Be an advocate for the student. Keep responses to 3-5 sentences. Know about: NJIT programs (Highlander Grant, EOF, food pantry, emergency fund), NJ state aid (TAG, EOF), NJIT co-op program impacts, visa transitions and tuition classification appeals, SAP rules. Contacts: financialaid@njit.edu, eof@njit.edu, registrar@njit.edu, 973-596-3466 (Dean of Students).`;

const SUGGESTED_QUESTIONS = [
  "What if my GPA drops below 3.5?",
  "What does capitalization mean for me?",
  "What if I do a co-op semester?",
  "Am I missing any NJ state aid?",
  "Can I appeal if I lose my scholarship?",
  "Should I pay interest on my private loan now?",
  "What happens if I withdraw from a class?",
  "What is SAP and how does it affect me?",
];

let chatHistory = [];
let chatBusy = false;

function buildSuggestions() {
  const container = document.getElementById("chat-suggestions");
  SUGGESTED_QUESTIONS.forEach((q) => {
    const chip = document.createElement("span");
    chip.className = "suggestion-chip";
    chip.textContent = q;
    chip.addEventListener("click", () => sendMessage(q));
    container.appendChild(chip);
  });
}

buildSuggestions();

async function sendChat() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || chatBusy) return;
  input.value = "";
  await sendMessage(text);
}

async function sendMessage(text) {
  if (chatBusy) return;
  chatBusy = true;
  document.getElementById("chat-send-btn").disabled = true;

  appendMessage(text, "user");
  chatHistory.push({ role: "user", content: text });

  const log = document.getElementById("chat-log");
  const typingEl = document.createElement("div");
  typingEl.className = "message bot";
  typingEl.innerHTML = `<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  log.appendChild(typingEl);
  log.scrollTop = log.scrollHeight;

  try {
    const res = await fetch(API_PROXY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: chatHistory,
      }),
    });

    const data = await res.json().catch(() => ({}));
    const reply = res.ok
      ? data?.content?.find?.((c) => c.type === "text")?.text ||
        "Sorry, I had trouble responding. Please try again."
      : data?.error?.message || `Anthropic API error (${res.status}).`;
    typingEl.remove();
    appendMessage(reply, "bot");
    chatHistory.push({ role: "assistant", content: reply });
  } catch (err) {
    typingEl.remove();
    appendMessage("Connection issue — please try again in a moment.", "bot");
  }

  chatBusy = false;
  document.getElementById("chat-send-btn").disabled = false;
}

function appendMessage(text, type) {
  const log = document.getElementById("chat-log");
  const el = document.createElement("div");
  el.className = "message " + type;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

// ── APPEAL LETTER ─────────────────────────────────────────────────

const DEFAULT_LETTER = `Dear Stevens Institute of Technology Office of Financial Aid,

I am writing to respectfully request a reconsideration of my financial aid award for the upcoming academic year. I have been accepted to Stevens and am genuinely excited about the program and the opportunities it offers.

After carefully reviewing my financial aid options, I have received a significantly more competitive offer from another institution that I must consider seriously.

New Jersey Institute of Technology has offered me the following:
  · Highlander Merit Scholarship: $12,000/year (renewable for 4 years — $48,000 total)
  · NJ TAG Grant: $3,500/year
  · Federal Subsidized Loan: $3,500
  · True annual net cost: $15,700

My current Stevens award, while generous in year one, includes a one-time scholarship that does not renew — resulting in a net cost difference of approximately $12,700 per year beginning in year two, and a projected 4-year debt difference of over $57,000.

I believe strongly in the value of a Stevens education and would sincerely prefer to attend if the financial gap can be narrowed. I would be grateful for any additional merit aid, renewable grants, or institutional funding you are able to offer.

I am happy to provide a copy of my competing offer letter or any additional documentation. I look forward to your response and appreciate your time.

Sincerely,
[Your Full Name]
[NJIT Applicant ID] | [Stevens Application ID]
[Email Address] | [Phone Number]
[Date]`;

document.getElementById("appeal-letter").value = DEFAULT_LETTER;

function copyLetter() {
  navigator.clipboard
    .writeText(document.getElementById("appeal-letter").value)
    .then(() => {
      const btn = document.getElementById("copy-btn");
      btn.textContent = "✓ Copied!";
      setTimeout(() => (btn.textContent = "Copy Letter"), 2000);
    });
}

function resetLetter() {
  document.getElementById("appeal-letter").value = DEFAULT_LETTER;
}

// ── CAPITALIZATION CALCULATOR ─────────────────────────────────────

function updateCap() {
  const loan = parseInt(document.getElementById("slider-loan").value);
  const rate = parseFloat(document.getElementById("slider-rate").value);
  const years = parseInt(document.getElementById("slider-years").value);

  const accrued = Math.round(loan * (rate / 100) * years);
  const capBal = loan + accrued;
  const monthly = Math.round((loan * (rate / 100)) / 12);
  const extraCost = Math.round(accrued * (rate / 100) * 5);

  document.getElementById("out-loan").textContent = "$" + loan.toLocaleString();
  document.getElementById("out-rate").textContent = rate.toFixed(1) + "%";
  document.getElementById("out-years").textContent =
    years + (years === 1 ? " year" : " years");

  document.getElementById("cr-original").textContent =
    "$" + loan.toLocaleString();
  document.getElementById("cr-accrued").textContent =
    "+$" + accrued.toLocaleString();
  document.getElementById("cr-monthly").textContent = "~$" + monthly + "/mo";
  document.getElementById("cr-total").textContent =
    "$" + capBal.toLocaleString();

  document.getElementById("cap-insight").innerHTML =
    `That extra <strong>$${accrued.toLocaleString()}</strong> doesn't sit still — you now pay ${rate.toFixed(1)}% on ` +
    `<strong>$${capBal.toLocaleString()}</strong> instead of $${loan.toLocaleString()}. ` +
    `Over a 10-year repayment, this costs roughly <strong>$${extraCost.toLocaleString()}</strong> ` +
    `more than if you'd paid the interest during school (~$${monthly}/month).`;

  document.getElementById("cap-green-title").textContent =
    `How to fight it: pay ~$${monthly}/month now`;

  document.getElementById("cap-green-body").textContent =
    `Paying just the monthly interest during school prevents $${accrued.toLocaleString()} from capitalizing. ` +
    `Your federal subsidized loan avoids this entirely — the government pays that interest. ` +
    `Focus these payments on your private loan.`;
}
