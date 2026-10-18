const test = require("node:test");
const assert = require("node:assert/strict");
const { prepare, schema } = require("../analysis");
const { evaluate } = require("../cedar-eval");
const expected = require("./fixtures/cedar.expected.json");
const fixture = () => structuredClone(expected);

test("user-confirmed Cedar answer key fits the extraction schema without lost fields", () => {
  function visit(value, rule, path = "root") {
    if (rule.anyOf) return visit(value, rule.anyOf.find(candidate => candidate.type === (value === null ? "null" : "object")), path);
    assert.ok(rule, path);
    if (value === null) { assert.ok([rule.type].flat().includes("null"), path); return; }
    if (rule.type === "object") {
      assert.deepEqual(Object.keys(value).sort(), rule.required.slice().sort(), path);
      for (const [key, child] of Object.entries(rule.properties)) visit(value[key], child, `${path}.${key}`);
    } else if (rule.type === "array") {
      assert.ok(Array.isArray(value), path);
      value.forEach((item, index) => visit(item, rule.items, `${path}[${index}]`));
    } else {
      const types = [rule.type].flat();
      assert.ok(types.includes(typeof value) || types.includes("integer") && Number.isInteger(value), path);
      if (rule.enum) assert.ok(rule.enum.includes(value), path);
      if (rule.minimum != null) assert.ok(value >= rule.minimum, path);
      if (rule.maximum != null) assert.ok(value <= rule.maximum, path);
    }
  }
  visit(expected, schema);
  assert.deepEqual(evaluate(fixture()).failures, []);
});

test("Cedar normalization preserves unknown attendance costs and included initial interest", () => {
  const data = prepare(fixture());
  assert.equal(data.totalCost, null);
  assert.equal(data.remainingCost, null);
  assert.equal(data.totalBorrowing, 25000);
  assert.equal(data.freeAid, null);
  assert.equal(data.repaymentPlans[0].excludesInSchoolInterest, false);
  assert.equal(data.repaymentPlans.length, 1);
  assert.equal(data.coverage.partial, 0);
});

test("Cedar evaluator rejects each of the four observed extraction failures", () => {
  const cases = [
    [raw => { raw.totalCost = 25000; raw.costItems = [{ name: "Gross loan", amount: 25000, source: "Page 1" }]; }, /totalCost must remain unknown/],
    [raw => { raw.repaymentAssumptions.excludesInSchoolInterest = true; raw.repaymentPlans[0].excludesInSchoolInterest = true; }, /Initial school\/grace interest included/],
    [raw => { raw.repaymentPlans.push({ ...raw.repaymentPlans[0], ratePercent: 8.25 }); }, /Only one elected repayment schedule/],
    [raw => { raw.deadlines.push({ action: "Assumed acceptance", who: "Borrower", date: "August 24, 2026", source: "Page 2" }); }, /Only acceptance and cancellation/]
  ];
  for (const [mutate, failure] of cases) {
    const raw = fixture();
    mutate(raw);
    assert.ok(evaluate(raw).failures.some(message => failure.test(message)), String(failure));
  }
});
