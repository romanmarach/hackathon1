# Debt Decoder

An AI-powered financial aid companion built for NJIT students.

Debt Decoder helps students understand financial aid offers, scholarships, and loans by turning complicated documents into a clear breakdown of costs, conditions, risks, and next steps.

## Features

- **Document analysis:** Upload a financial aid document and extract its key information using OpenAI.
- **Financial overview:** See total attendance costs, grants and scholarships, and remaining expenses.
- **Risk scanner:** Identify potential concerns such as variable interest rates, scholarship renewal conditions, and repayment requirements.
- **Document-aware chat:** Ask questions using information extracted from your current document.
- **Term decoder:** Read plain-English explanations of common financial aid terminology.
- **Interest calculator:** Explore how unpaid interest can affect a loan balance.
- **School comparison and appeal-letter examples:** Explore sample offers and edit a sample appeal letter.
- **NJIT resources:** Find information about tuition classification and student support.
- **Sample mode:** Explore an example aid package without uploading personal documents.
- **Responsive layout:** Use the app on desktop, tablet, or mobile.

## Tech Stack

- HTML, CSS, and vanilla JavaScript
- Node.js and Express
- OpenAI Responses API
- dotenv for local configuration
- Node.js built-in test runner

The default AI model is `gpt-5.4-mini`. It can be changed through the `OPENAI_MODEL` environment variable.

## Getting Started

### Requirements

- Node.js 18 or newer
- npm
- An OpenAI API key for document analysis and chat

### Installation

Clone this repository, open its folder, and install dependencies:

```bash
npm install
```

Copy `.env.example` to a new file named `.env`, then configure it:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4-mini
PORT=3000
```

Use the full secret API key as the value of `OPENAI_API_KEY`.

Start the server:

```bash
npm start
```

Open **http://localhost:3000** in your browser.

After changing `.env`, restart the server.

## Netlify deployment

The repository includes a Netlify function at `/api/openai/responses` that shares the local server's API handler. Netlify does not run `npm start` to serve this endpoint.

In the Netlify site's environment variables, set `OPENAI_API_KEY` for Functions, and optionally `OPENAI_MODEL`. The local `.env` file is not deployed. Commit and push the Netlify function and `netlify.toml`, then deploy again after configuring the variables.

Netlify runs `npm run build` and publishes `dist/`. The build copies only the
four browser assets and generates security headers. Server source, test PDFs,
local analysis output, credentials, and dependencies are excluded. Do not change
the publish directory back to the project root.

The function declares a limit of 20 requests per 60 seconds per IP and domain.
After deployment, check Netlify's post-processing log to confirm the rule was
accepted; invalid rate-limit rules do not necessarily fail a deploy. The endpoint
also rejects cross-site browser requests, remote file URLs, and account file IDs,
and returns controlled errors with `Cache-Control: no-store`.

This is a public, unauthenticated AI endpoint. Rate limiting reduces abuse but
is not authentication or a global spending cap. Monitor provider usage; broader
public access may warrant login or bot verification. Local `npm start` is for
development and does not enforce Netlify's edge rate limit.

`OPENAI_MODEL` and `PORT` are the only variables excluded from Netlify secret
scanning. Never add `OPENAI_API_KEY` to that exclusion list.

## Using the App

1. Upload a document using the upload button or drag-and-drop area.
2. Review the extracted costs, awards, conditions, and suggested actions.
3. Open **Documents & risks** for the full risk analysis.
4. Use **Ask Debt Decoder** to ask questions about the extracted information.
5. Select **Upload another document** to begin a new analysis.

PDFs, images, Word documents, and text files are supported.

To explore the interface first, select **Explore a sample**. Loading the sample does not require an API key; AI analysis and chat do.

## Tests

Run the automated tests:

```bash
npm test
```

Tests cover document state, synchronized results, chat context, file request formats, document switching, and the OpenAI server integration. API responses are simulated, so the tests do not use API credits.

## Project Structure

```text
index.html       Application screens and layout
styles.css       Styling and responsive layouts
app.js           Uploads, shared state, rendering, and chat
server.js        Express server and OpenAI API proxy
.env.example     Configuration template
test/            Automated regression tests
```

## Data and Privacy

Uploaded documents are sent to OpenAI for analysis. The API key stays on the server.

The app has no database or account system. The current analysis and conversation are held in browser memory and cleared when the page is refreshed. Switching documents also resets the conversation.

`.env` is excluded from Git. Keep real credentials out of committed files.
The server does not write uploaded documents or conversations to disk. The
explicit evaluation scripts save test results under ignored `.preview/`.
The content security policy allows existing inline event handlers; extracted
document and chat content is escaped or rendered as text rather than HTML.

## Current Status

Debt Decoder is a prototype. Document analysis and chat use OpenAI, while the school comparison and appeal-letter screens currently contain example content.

AI-generated explanations and health scores may be incomplete or inaccurate. Confirm important amounts, requirements, and deadlines with the original documents and the relevant financial aid office.
