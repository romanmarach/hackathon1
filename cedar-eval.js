// Focused checks against the user-confirmed Cedar Harbor answer key.
// Free-text completeness still requires source review; no paid API calls here.
const expected = require("./test/fixtures/cedar.expected.json");
const { prepare } = require("./analysis");

function evaluate(raw) {
  const actual = prepare(raw);
  const failures = [];
  let checks = 0;
  const check = (name, pass) => { checks++; if (!pass) failures.push(name); };
  const amount = (name, value, target) => check(name,
    typeof value === "number" && Math.abs(value - target) < 0.011);
  check("Valid fictional financial-aid document", actual.valid && actual.isExample);
  for (const key of ["totalCost", "freeAid", "workStudy", "parentLoans", "remainingCost", "reportedUnmetNeed", "healthScore"]) {
    check(`${key} must remain unknown`, actual[key] === null);
  }
  check("Loan cash flows are not attendance cost items", actual.costItems.length === 0);
  for (const key of ["studentLoans", "totalBorrowing"]) amount(key, actual[key], 25000);
  for (const key of ["loanFees", "netDisbursed"]) amount(key, actual.reportedTotals[key], expected.reportedTotals[key]);
  check("Exactly one private student loan", actual.funding.length === 1 && actual.funding[0].kind === "private_loan" && actual.funding[0].loan?.borrower === "student");
  amount("Gross loan principal", actual.funding[0]?.amount, 25000);
  const loan = actual.funding[0]?.loan;
  for (const key of ["ratePercent", "feePercent", "feeAmount", "netAmount"]) amount(key, loan?.[key], expected.funding[0].loan[key]);
  check("Fixed rate; interest accrues during school", loan?.rateType === "fixed" && loan?.interestAccruesInSchool === true);
  check("Exactly one scheduled disbursement", actual.disbursements.length === 1);
  const disbursement = actual.disbursements[0];
  for (const key of ["grossAmount", "feeAmount", "netAmount"]) amount(`Disbursement ${key}`, disbursement?.[key], expected.disbursements[0][key]);
  check("September 1, 2026 disbursement", Date.parse(disbursement?.date) === Date.parse("September 1, 2026"));
  check("Only one elected repayment schedule; optional discount is not another plan", actual.repaymentPlans.length === 1);
  const plan = actual.repaymentPlans[0];
  for (const key of ["principal", "ratePercent", "monthlyPayment", "totalPayments", "totalInterest", "termMonths"]) amount(`Repayment ${key}`, plan?.[key], expected.repaymentPlans[0][key]);
  check("First payment April 1, 2028", Date.parse(plan?.startDate) === Date.parse("April 1, 2028"));
  check("Initial school/grace interest included in overall and row assumptions", actual.repaymentAssumptions.excludesInSchoolInterest === false && plan?.excludesInSchoolInterest === false);
  check("No false warning that repayment excludes school interest", !actual.reviewIssues.some(issue => /Repayment estimates exclude in-school interest/.test(issue.title)));
  check("Only acceptance and cancellation are dated deadlines", actual.deadlines.length === 2
    && actual.deadlines.some(item => Date.parse(item.date) === Date.parse("August 25, 2026"))
    && actual.deadlines.some(item => /August 28, 2026/.test(item.date || "") && /11:59/.test(item.date) && /Eastern/.test(item.date)));
  check("Five main source sections retained", actual.detectedSectionCount === 5 && actual.sections.length === 5 && actual.sections.every(section => section.status === "extracted"));
  return { checks, passed: checks - failures.length, failures };
}

module.exports = { evaluate };

if (require.main === module) {
  const fs = require("node:fs");
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--response") {
    console.error("Usage: node cedar-eval.js --response path/to/extraction.json");
    process.exitCode = 1;
  } else {
    const report = evaluate(JSON.parse(fs.readFileSync(args[1], "utf8")));
    console.log(`${report.passed}/${report.checks} focused Cedar checks passed. Free-text completeness still requires source review.`);
    for (const failure of report.failures) console.log(`FAIL: ${failure}`);
    if (report.failures.length) process.exitCode = 1;
  }
}
