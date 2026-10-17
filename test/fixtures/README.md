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
