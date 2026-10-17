const { createResponsesHandler } = require("./openai-proxy");
const express = require("express");
const path = require("path");

function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(express.static(path.join(__dirname)));

  app.post("/api/openai/responses", createResponsesHandler({ env, fetchImpl }));
  return app;
}

if (require.main === module) {
  require("dotenv").config();
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`Debt Decoder server running at http://localhost:${port}`);
  });
}

module.exports = { createApp, createResponsesHandler };
