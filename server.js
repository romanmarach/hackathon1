const { createResponsesHandler } = require("./openai-proxy");
const express = require("express");
const path = require("path");
const { PUBLIC_FILES, SECURITY_HEADERS, API_HEADERS } = require("./security-headers");

function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => { res.set(SECURITY_HEADERS); next(); });
  for (const file of PUBLIC_FILES) app.get(file === "index.html" ? ["/", "/index.html"] : `/${file}`, (_req, res) => res.sendFile(path.join(__dirname, file)));

  app.use("/api/openai/responses", (_req, res, next) => { res.set(API_HEADERS); next(); });
  app.post("/api/openai/responses", express.json({ limit: "6mb" }), createResponsesHandler({ env, fetchImpl }));
  app.all("/api/openai/responses", (_req, res) => res.set("Allow", "POST").status(405).json({ error: { message: "Method not allowed." } }));
  app.use((error, _req, res, _next) => res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: { message: error.type === "entity.too.large" ? "Document request is too large." : "Invalid JSON request." } }));
  return app;
}

if (require.main === module) {
  require("dotenv").config();
  const port = process.env.PORT || 3000;
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Debt Decoder server running at http://localhost:${port}`);
  });
}

module.exports = { createApp, createResponsesHandler };
