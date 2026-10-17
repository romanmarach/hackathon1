const express = require("express");
const path = require("path");

function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(express.static(path.join(__dirname)));

  app.post("/api/openai/responses", async (req, res) => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: { message: "Missing OPENAI_API_KEY in .env" },
      });
    }

    const { input, instructions, max_output_tokens = 2000, text } = req.body || {};
    if ((!Array.isArray(input) && typeof input !== "string") || !input.length) {
      return res.status(400).json({ error: { message: "A nonempty input is required." } });
    }
    if (!Number.isInteger(max_output_tokens) || max_output_tokens < 1 || max_output_tokens > 16000) {
      return res.status(400).json({
        error: { message: "max_output_tokens must be an integer between 1 and 16000." },
      });
    }

    try {
      const upstream = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.4-mini",
          store: false,
          instructions,
          input,
          max_output_tokens,
          ...(text ? { text } : {}),
        }),
      });

      let payload;
      try {
        payload = JSON.parse(await upstream.text());
      } catch {
        return res.status(502).json({ error: { message: "Invalid response from OpenAI." } });
      }
      return res.status(upstream.status).json(payload);
    } catch (err) {
      return res.status(502).json({
        error: { message: err?.name === "TimeoutError"
          ? "OpenAI took too long to respond. Please try again."
          : "Failed to reach OpenAI. Please try again." },
      });
    }
  });

  return app;
}

if (require.main === module) {
  require("dotenv").config();
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Debt Decoder server running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
