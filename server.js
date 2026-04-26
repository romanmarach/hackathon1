const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname)));

app.post("/api/anthropic/messages", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: "Missing ANTHROPIC_API_KEY in .env" },
    });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text || "Invalid upstream response" } };
    }

    return res.status(upstream.status).json(payload);
  } catch (err) {
    return res.status(502).json({
      error: { message: err?.message || "Failed to reach Anthropic API" },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Debt Decoder server running at http://localhost:${PORT}`);
});
