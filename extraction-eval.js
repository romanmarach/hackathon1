// Focused regression checks for the manually verified Hartwell test package.
// Passing these checks does not prove that all natural-language claims are correct.
const expected = require("./test/fixtures/hartwell.expected.json");
const { prepare } = require("./analysis");

function evaluate(raw) {
  const actual = prepare(raw);
  const failures = [];
  let checks = 0;
  function check(name, pass) { checks++; if (!pass) failures.push(name); }
  function amount(name, value, target) {
    check(`${name}: expected ${target}, received ${value ?? "unknown"}`, typeof value === "number" && Math.abs(value - target) < 0.011);
  }
  const fullText = (value) => JSON.stringify(value || "");
  check("Document must be valid financial aid", actual.valid);
  check("Fictional example must be identified", actual.isExample);
  for (const [key, target] of Object.entries({ totalCost:59500, freeAid:24700, workStudy:2800, studentLoans:15000, parentLoans:17000, totalBorrowing:32000, costAfterGiftAid:34800, reportedUnmetNeed:0 })) amount(key, actual[key], target);
  for (const key of ["loanFees", "netDisbursed"]) amount(key, actual.reportedTotals[key], expected.reportedTotals[key]);
  for (const [key, target] of Object.entries(expected.borrowingHistory)) if (typeof target === "number") amount(key, actual.borrowingHistory[key], target);
  check("All six cost-of-attendance lines", actual.costItems.length === expected.costItems.length && expected.costItems.every(entry => actual.costItems.some(item => item.amount === entry.amount)));
  check("Exactly eight unique funding items", actual.funding.length === 8);
  check("Loan fee and disbursement reconciliation", !actual.reviewIssues.some(issue => /reconciliation|Disbursement schedule|disbursement totals/.test(issue.title)));
  for (const award of expected.funding) {
    const items = actual.funding.filter((item) => item.kind === award.kind && item.amount === award.amount);
    check(`${award.name}: unique correct classification and amount`, items.length === 1);
    const item = items[0];
    check(`${award.name}: source reference`, !!item?.source);
    if (!award.loan) continue;
    check(`${award.name}: borrower`, item?.loan?.borrower === award.loan.borrower);
    for (const key of ["ratePercent", "feePercent", "feeAmount", "netAmount", "dailyInterest"]) {
      if (award.loan[key] != null) amount(`${award.name} ${key}`, item?.loan?.[key], award.loan[key]);
    }
    check(`${award.name}: in-school interest`, item?.loan?.interestAccruesInSchool === award.loan.interestAccruesInSchool);
  }
  const unsub = actual.funding.find((item) => item.kind === "federal_unsubsidized");
  const privateLoan = actual.funding.find((item) => item.kind === "private_loan");
  check("Unsubsidized capitalization", /capitali/i.test(fullText(unsub?.loan)));
  check("Private cosigner release after 36 payments", /36/.test(privateLoan?.loan?.cosignerRelease || ""));
  check("Private default after 120 days", /120/.test(privateLoan?.loan?.defaultTerms || ""));
  check("Private deferment and capitalization", !!privateLoan?.loan?.inSchoolDeferment && /capitali/i.test(fullText(privateLoan?.loan)));
  check("Private late fee and prepayment conditions", /late fee/i.test(fullText(privateLoan)) && /prepay/i.test(fullText(privateLoan)));
  const dates = (items) => items.map((item) => Date.parse(item.date));
  const actualDates = dates(actual.deadlines).sort();
  const expectedDates = dates(expected.deadlines).sort();
  check("All six dated deadlines, including two June 1 actions", actualDates.length === expectedDates.length && expectedDates.every((date, index) => actualDates[index] === date));
  check("Every deadline has action, responsible party, and source", actual.deadlines.length > 0 && actual.deadlines.every((item) => item.action && item.who && item.source));
  check("All eight per-loan disbursement rows", actual.disbursements.length === 8);
  for (const entry of expected.disbursements) check(`${entry.loanName}: ${entry.date} net ${entry.netAmount}`, actual.disbursements.some((item) => Date.parse(item.date) === Date.parse(entry.date) && item.netAmount === entry.netAmount));
  for (const plan of expected.repaymentPlans) {
    const item = actual.repaymentPlans.find((item) => item.principal === plan.principal && item.borrower === plan.borrower && item.ratePercent === plan.ratePercent);
    for (const key of ["monthlyPayment", "totalPayments", "termMonths"]) amount(`${plan.loanName} ${key}`, item?.[key], plan[key]);
    check(`${plan.loanName}: excludes in-school interest`, item?.excludesInSchoolInterest === true);
  }
  check("Student repayment starts November 2029", actual.repaymentPlans.some((item) => item.borrower === "student" && /(?:november|nov|11)[\s\S]*2029|2029-11/i.test(item.startDate || "")));
  check("Twelve source sections inventoried", actual.sections.length === 12 && actual.detectedSectionCount === 12);
  check("At least nine terms / conditions", actual.terms.length >= 9);
  check("All five rights and five responsibilities", actual.rightsAndResponsibilities.filter((item) => item.kind === "right").length >= 5 && actual.rightsAndResponsibilities.filter((item) => item.kind === "responsibility").length >= 5);
  return { checks, passed: checks - failures.length, failures };
}

module.exports = { evaluate };
