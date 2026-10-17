const fs = require("node:fs");
const path = require("node:path");
const { instructions, format } = require("../analysis");
const { evaluate } = require("../extraction-eval");
const root = path.join(__dirname, "..");

async function main() {
  const args = process.argv.slice(2);
  let raw;
  if (args[0] === "--response" && args[1]) {
    raw = JSON.parse(fs.readFileSync(path.resolve(args[1]), "utf8"));
  } else if (args.length === 1 && args[0] === "--live") {
    require("dotenv").config({ path:path.join(root,".env") });
    if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in .env first.");
    const pdf = path.join(root,"testDocs","Hartwell University Student Loan Package (Test Document).pdf");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
      signal:AbortSignal.timeout(120000),
      body:JSON.stringify({ model:process.env.OPENAI_MODEL || "gpt-5.4-mini", store:false, instructions, max_output_tokens:16000, text:{format},
        input:[{role:"user",content:[{type:"input_file",filename:path.basename(pdf),file_data:`data:application/pdf;base64,${fs.readFileSync(pdf).toString("base64")}`},{type:"input_text",text:"Extract the entire package, all twelve parts, including all tables and conditions."}]}] }),
    });
    const result = await response.json();
    // Never print an upstream authentication error, which may echo part of a key.
    if (!response.ok) throw new Error(`OpenAI request failed (HTTP ${response.status}; code ${result.error?.code || "unknown"}).`);
    if (result.status !== "completed") throw new Error(`OpenAI response was ${result.status}; no extraction was scored.`);
    const output = (result.output || []).flatMap(item => item.type === "message" ? item.content || [] : []);
    if (output.some(item => item.type === "refusal")) throw new Error("OpenAI declined to analyze this document.");
    raw = JSON.parse(output.filter(item => item.type === "output_text").map(item => item.text).join("\n"));
    const outputPath = path.join(root,".preview","hartwell-extraction.json");
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,JSON.stringify(raw,null,2)+"\n");
    console.log("Saved actual model extraction to .preview/hartwell-extraction.json");
  } else {
    console.log("Usage: npm run eval:hartwell -- --live\n       npm run eval:hartwell -- --response path/to/extraction.json\n--live sends the test PDF to OpenAI and incurs API usage. No model upgrade is required.");
    return;
  }
  const report = evaluate(raw);
  console.log(`${report.passed}/${report.checks} focused checks passed. Natural-language accuracy still requires source review.`);
  for (const failure of report.failures) console.log(`FAIL: ${failure}`);
  if (report.failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.cause?.code || error.message); process.exitCode = 1; });
