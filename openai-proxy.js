function allowedInput(input) {
  if (typeof input === "string") return input.trim().length > 0;
  if (!Array.isArray(input) || !input.length) return false;
  return input.every((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) return false;
    if (typeof message.content === "string") return message.content.trim().length > 0;
    return Array.isArray(message.content) && message.content.length > 0 && message.content.every((part) => {
      if (!part || typeof part !== "object") return false;
      if (part.file_id || part.file_url) return false;
      if (part.type === "input_text") return typeof part.text === "string";
      if (part.type === "input_image") return typeof part.image_url === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(part.image_url);
      if (part.type === "input_file") return !part.file_id && !part.file_url && typeof part.file_data === "string"
        && /^data:application\/(pdf|msword|rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,/.test(part.file_data);
      return false;
    });
  });
}

function createResponsesHandler({ env = process.env, fetchImpl = fetch } = {}) {
  return async (req, res) => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: { message: "The AI service is not configured. The site owner must set OPENAI_API_KEY." },
      });
    }

    const { input, instructions, max_output_tokens = 2000, text } = req.body || {};
    if (!allowedInput(input)) {
      return res.status(400).json({ error: { message: "Provide text or an inline document/image upload. Remote URLs and account file references are not supported." } });
    }
    if (!Number.isInteger(max_output_tokens) || max_output_tokens < 1 || max_output_tokens > 16000) {
      return res.status(400).json({
        error: { message: "max_output_tokens must be an integer between 1 and 16000." },
      });
    }

    if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > 6 * 1024 * 1024) {
      return res.status(413).json({ error: { message: "Document request is too large." } });
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
      // Provider errors can echo credentials or account details. Only return
      // messages and error codes controlled by this app.
      if (!upstream.ok || payload?.error) {
        const status = upstream.ok ? 502 : upstream.status;
        const rateLimited = status === 429;
        return res.status(status).json({ error: {
          message: rateLimited ? "The AI service is busy or has reached its usage limit. Please try again later."
            : status === 401 || status === 403 ? "The AI service credentials need attention. Please contact the site owner."
            : "The AI service could not process this request. Please try again or contact the site owner.",
          code: rateLimited ? (payload?.error?.code === "insufficient_quota" ? "insufficient_quota" : "rate_limit_exceeded") : "upstream_error",
        } });
      }
      return res.status(upstream.status).json(payload);
    } catch (err) {
      return res.status(502).json({
        error: { message: err?.name === "TimeoutError"
          ? "OpenAI took too long to respond. Please try again."
          : "Failed to reach OpenAI. Please try again." },
      });
    }
  };
}

module.exports = { createResponsesHandler };
