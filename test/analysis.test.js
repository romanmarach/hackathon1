const test = require("node:test");
const assert = require("node:assert/strict");
const { prepare, schema } = require("../analysis");
const { evaluate } = require("../extraction-eval");
const expected = require("./fixtures/hartwell.expected.json");
const fixture = () => structuredClone(expected);

test("Hartwell answer key separates cost, gift aid, earned wages, and student/parent debt", () => {
  const data = prepare(fixture());
  assert.equal(data.costAfterGiftAid,34800);
  assert.equal(data.totalBorrowing,32000);
  assert.equal(data.studentLoans,15000);
  assert.equal(data.parentLoans,17000);
  assert.equal(data.workStudy,2800);
  assert.equal(data.reportedUnmetNeed,0);
  assert.equal(data.coverage.listed,12);
  assert.equal(data.coverage.partial,0);
  assert.equal(data.reviewIssues.length,4); // Three accruing loans and the repayment caveat.
  assert.deepEqual(evaluate(fixture()).failures,[]);
});

test("display badges are assigned from funding types and cannot call loans free money", () => {
  const raw=fixture();
  raw.funding.forEach(item=> { item.badgeLabel="Free Money"; });
  raw.documents=[{title:"Aid Summary",badgeLabel:"Best Type"}];
  const data=prepare(raw);
  assert.equal(data.documents.length,8);
  assert.deepEqual(data.documents.map(item=>item.badgeLabel),["Scholarship","Grant","Grant","Work-study: must earn","Student loan: repay","Student loan: repay","Parent loan: repay","Private loan: repay"]);
  assert.equal(data.documents.some(item=>/Aid Summary|Best Type|Free Money/.test(JSON.stringify(item))),false);
});

test("unmet need and stale model totals cannot override the cost calculation", () => {
  const raw=fixture();
  raw.remainingCost=0;
  raw.freeAid=59500;
  assert.equal(prepare(raw).remainingCost,34800);
  raw.totalCost=null;
  assert.equal(prepare(raw).remainingCost,null);
});

test("conflicting summary totals are withheld and explained instead of guessed", () => {
  const raw=fixture();
  raw.reportedTotals.totalBorrowing=26500;
  raw.reportedTotals.giftAid=30000;
  const data=prepare(raw);
  assert.equal(data.totalBorrowing,null);
  assert.equal(data.freeAid,null);
  assert.equal(data.remainingCost,null);
  assert.ok(data.reviewIssues.some(issue=>/32,000/.test(issue.body)&&/26,500/.test(issue.body)));
});

test("unknown amounts stay null while an explicitly reported zero stays zero", () => {
  const data=prepare({valid:true,reportedTotals:{unmetNeed:0}});
  for(const key of ["totalCost","freeAid","workStudy","studentLoans","parentLoans","totalBorrowing","remainingCost"])assert.equal(data[key],null,key);
  assert.equal(data.reportedUnmetNeed,0);
  assert.ok(data.reviewIssues.some(issue=>/coverage is unverified/.test(issue.title)));
});

test("repeated mentions count once and a conflicting duplicate is flagged", () => {
  const raw=fixture();
  raw.funding.push(structuredClone(raw.funding[0]));
  assert.equal(prepare(raw).freeAid,24700);
  raw.funding.at(-1).amount=15001;
  const data=prepare(raw);
  assert.ok(data.reviewIssues.some(issue=>/Conflicting funding/.test(issue.title)));
  assert.ok(data.reviewIssues.some(issue=>/itemization is incomplete/.test(issue.title)));
});

test("term amounts, aggregate history and fees do not inflate new borrowing", () => {
  const raw=fixture();
  raw.funding.push({id:"prior",name:"Prior borrowing",kind:"other_loan",amount:12000,amountBasis:"aggregate"});
  raw.funding.push({id:"term",name:"One-term payment",kind:"other_loan",amount:15600.98,amountBasis:"per_term"});
  const data=prepare(raw);
  assert.equal(data.totalBorrowing,32000);
  assert.equal(data.reviewIssues.filter(issue=>/Funding period/.test(issue.title)).length,2);
});

test("missing numbered parts, partial sections and omitted deadline tables are visible", () => {
  const raw=fixture();
  raw.sections.pop();
  raw.sections[0].status="partial";
  raw.sections[0].missingDetails=["Unreadable enrollment condition"];
  raw.deadlines=[];
  const data=prepare(raw);
  assert.equal(data.coverage.partial,1);
  for(const pattern of [/Source sections are missing/,/another look/,/Deadline table was not extracted/])assert.ok(data.reviewIssues.some(issue=>pattern.test(issue.title)));
});

test("per-loan disbursement sums are reconciled against annual net amounts", () => {
  const raw=fixture();
  raw.disbursements[0].netAmount=2700;
  const data=prepare(raw);
  assert.ok(data.reviewIssues.some(issue=>/Disbursement schedule/.test(issue.title)));
  assert.equal(data.totalBorrowing,32000);
});

test("interest, cosigner and repayment caveats survive normalization", () => {
  const data=prepare(fixture());
  const unsub=data.documents.find(item=>item.title.includes("Unsubsidized"));
  const privateLoan=data.documents.find(item=>item.title.includes("Summit Ridge"));
  assert.ok(unsub.rows.some(row=>row.value==="$0.35"));
  assert.ok(unsub.rows.some(row=>/capitalizes/.test(row.value)));
  assert.ok(privateLoan.rows.some(row=>/36 consecutive/.test(row.value)));
  assert.ok(privateLoan.rows.some(row=>/120 days/.test(row.value)));
  assert.ok(data.reviewIssues.some(issue=>/exclude in-school interest/.test(issue.title)));
});

test("table-wide repayment exclusions carry to every estimate and conflicting rows are flagged", () => {
  const raw=fixture();
  raw.repaymentPlans[1].excludesInSchoolInterest=false;
  raw.repaymentPlans[2].excludesInSchoolInterest=null;
  const data=prepare(raw);
  assert.ok(data.repaymentPlans.every(plan=>plan.excludesInSchoolInterest===true));
  assert.ok(data.reviewIssues.some(issue=>/Repayment assumptions conflict/.test(issue.title)));
});

test("empty source-section shells cannot count as extracted content", () => {
  const raw=fixture();
  raw.sections[0].summary=null;
  const data=prepare(raw);
  assert.equal(data.sections[0].status,"partial");
  assert.equal(data.coverage.partial,1);
});

test("extraction confidence cannot masquerade as financial health", () => {
  const raw=fixture();
  raw.healthScore=98;
  raw.healthScoreBasis="extraction_confidence";
  raw.healthReason="All twelve parts extracted.";
  const data=prepare(raw);
  assert.equal(data.healthScore,null);
  assert.match(data.healthReason,/does not establish affordability/);
});

test("schema requires all declared fields and forbids unrestricted display properties", () => {
  function visit(rule){
    if(rule.type==="object"){
      assert.equal(rule.additionalProperties,false);
      assert.deepEqual(rule.required,Object.keys(rule.properties));
      Object.values(rule.properties).forEach(visit);
    }
    if(rule.items)visit(rule.items);
    if(rule.anyOf)rule.anyOf.forEach(visit);
  }
  visit(schema);
  assert.equal(schema.properties.documents,undefined);
  assert.equal(schema.properties.remainingCost,undefined);
});

test("evaluator detects incorrect labels, missing tables, and lost interest caveats", () => {
  const raw=fixture();
  raw.funding[3].kind="grant";
  raw.deadlines=[];
  raw.repaymentAssumptions.excludesInSchoolInterest=null;
  raw.repaymentPlans.forEach(plan=>plan.excludesInSchoolInterest=null);
  const report=evaluate(raw);
  assert.ok(report.failures.some(f=>/classification/.test(f)));
  assert.ok(report.failures.some(f=>/six dated deadlines/.test(f)));
  assert.ok(report.failures.some(f=>/excludes in-school/.test(f)));
});
