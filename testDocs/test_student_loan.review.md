# Decoder test: Cedar Harbor private loan

Tested October 17, 2026 against `test_student_loan.pdf` (five pages).
The PDF is explicitly fictional. These findings compare the decoder with the
source, not with real loan rules or current law.

One live run used the app's existing prompt, schema, output budget, and configured
model (`gpt-5.4-mini-2026-03-17`). No document-specific hints or production code
changes were applied. The API response took 24 seconds. The raw extraction,
normalized analysis, and run metadata are saved under ignored `.preview/cedar-*`.
The actual saved extraction also rendered at widths 320, 390, 768, 1440, and
1920 pixels without horizontal page overflow or JavaScript exceptions. This
browser check confirmed the incorrect attendance-cost display and the two
repayment cards; successful rendering does not mean the content was correct.

## Correctly recovered

| Fact | Source and extraction |
| --- | --- |
| Gross loan principal | $25,000 |
| Origination fee | 2%; $500 withheld |
| Net school disbursement | $24,500 |
| Fixed rate / estimated APR | 8.50% / 8.727%, kept separate |
| Principal entering repayment | $28,187.50 |
| In-school / grace interest | $2,125 / $1,062.50, retained in section details |
| Capitalized interest | $3,187.50 on March 1, 2028 |
| Payment schedule | 119 payments of $349.48; final $350.36 |
| First / final due dates | April 1, 2028 / March 1, 2038 |
| Total payments | $41,938.48 |
| Lifetime interest / finance charge | $16,938.48 / $17,438.48, kept separate |
| Disbursement | One payment on September 1, 2026 |
| Cosigner release | 24 qualifying payments plus degree, income, credit review; not guaranteed |
| Default threshold | 90 days, rather than the previous document's 120 days |

The decoder identified one private loan and all five main document sections.
It preserved the 30/360 convention, simple-interest deferment, late/returned
payment fees, full cosigner liability, and absence of guaranteed death/disability
discharge. Missing gift aid and work-study stayed unknown. The health score
appropriately remained unavailable for the fictional packet.

## Failures confirmed

1. **Loan principal incorrectly became cost of attendance.** Page 1 states a
   $25,000 gross loan, not an attendance budget. The model set `totalCost=25000`
   and put gross principal, the withheld fee, and net proceeds in `costItems`.
   Those entries sum to $50,000 because they describe overlapping money flows.
   The program flagged that arithmetic mismatch but still displayed $25,000 as
   cost of attendance. Expected: attendance cost unknown; $25,000 borrowing.

2. **False exclusion of in-school interest.** Page 3 explicitly builds $3,187.50
   of school/grace interest into the $28,187.50 repayment balance and the payment
   schedule. Nevertheless, both `repaymentAssumptions.excludesInSchoolInterest`
   and the repayment-row flag were true. The interface therefore warned that
   the estimates exclude this interest. Expected: false; these estimates already
   include the initial school/grace interest. Future hardship interest and
   optional charges are separate exclusions.

3. **Optional discount rendered as an extra repayment plan.** The 8.25% rate is
   conditional and not elected. The model preserved that caveat but also added
   a second repayment row with unknown payment totals and start date. The
   interface renders it like another schedule. Expected: one actual schedule;
   keep the optional discount and eligibility rules as conditional terms.

4. **Historical acceptance date classified as a deadline.** August 24, 2026 is
   the assumed acceptance event. The actual acceptance deadline is August 25.
   Both appeared in the required-actions table. The cancellation deadline was
   correctly retained, including its time and time zone.

## Remaining omissions

- Hardship pauses preserve the original maturity date by recalculating remaining
  payments, which can increase them (page 4).
- Deferment months and partial payments do not count toward the 24 qualifying
  cosigner-release payments (page 5).
- When the automatic-payment discount ends, the base rate returns and future
  payments are recalculated over the remaining term (page 2).

The five-section coverage count is an inventory, not proof that every clause was
preserved. This run supports the core numeric extraction but does not pass the
semantic review. It should become a second regression fixture before further
prompt/schema changes; the Hartwell document must continue to pass as well.
