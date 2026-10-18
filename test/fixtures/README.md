Cedar Harbor is the primary, user-confirmed answer key. The user reviewed and
confirmed the complete source-based answers on October 18, 2026 before they were
encoded in `cedar.expected.json`, using the production extraction schema.
Source: `testDocs/test_student_loan.pdf` (five main sections, sixteen clauses).
This is a curated expected result, not a saved AI response.

Key regressions: attendance cost stays unknown; gross borrowing is $25,000,
fee $500, net $24,500; school/grace interest is already included in the single
repayment schedule; the unelected 8.25% discount is conditional, not another
plan; August 24 is an assumed event, not an action deadline. Detailed terms,
including hardship maturity, release eligibility and discount loss, are retained
in the fixture's loan details, terms and sections.

`npm test` verifies schema compatibility, normalization and rejection of the
four observed extraction failures. Score saved model output without API usage:
`node cedar-eval.js --response .preview/cedar-extraction.json`.
Focused numeric/structural checks are automated; complete free-text clause
accuracy still requires comparison with the answer key and PDF. Production
prompt/schema fixes and a fresh live extraction remain separate work.

Hartwell remains a secondary regression fixture. The user reported mistakes in
its answer key; it is not fully user-verified and needs a separate source audit.
Retain its existing checks for compatibility, but prioritize Cedar's confirmed
answers for its document; do not copy document-specific terms between packets.

The Hartwell expected extraction was manually transcribed from
`testDocs/Hartwell University Student Loan Package (Test Document).pdf`.
It is an answer key, not a saved AI response. All rates, limits, institutions,
and policies in that PDF are fictional test data.

The financial regression is $59,500 cost minus $24,700 gift aid = $34,800
before loans and work-study. Borrowing is $32,000 ($15,000 student and $17,000
parent), work-study is $2,800 earned wages, and reported unmet need is $0.
There are eight funding items, twelve source parts, six deadline rows,
eight dated disbursement rows, three repayment estimates, and ten borrower
rights/responsibilities. Gross borrowing minus $798.04 fees yields $31,201.96 net.

`npm test` checks calculations, categorization, rendering, missing/conflicting
values, and coverage warnings against this answer key using local fixtures.
These tests do not measure the model's actual extraction accuracy.

Run `npm run eval:hartwell -- --live` to analyze the actual PDF with the configured
OpenAI model. This sends the fictional PDF to OpenAI and uses API credits.
The raw model result is saved under ignored `.preview/hartwell-extraction.json`.
Run `npm run eval:hartwell -- --response .preview/hartwell-extraction.json`
to score it again without a paid call. The evaluator checks focused amounts,
classification, dates, conditions, and coverage; natural-language truth and
completeness still require reviewing the original PDF.

On October 17, 2026, the second live extraction passed all 92 focused checks.
It inventoried all twelve parts and retained the interest and repayment caveats.
Its section inventory also flagged blank signature dates; that is a limitation
in distinguishing absent source values from incomplete extraction. The numeric
assessment guard separately prevents extraction confidence from being displayed
as a financial assessment. This single-document result is not a general accuracy
guarantee, and the saved live output stays under ignored `.preview/`.
