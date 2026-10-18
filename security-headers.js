const PUBLIC_FILES = ["index.html", "styles.css", "analysis.js", "app.js"];
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Existing HTML uses inline event handlers. Keep them working while limiting
  // outgoing connections, frames, plugins, and executable resource origins.
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const API_HEADERS = { ...SECURITY_HEADERS, "Cache-Control": "no-store" };
module.exports = { PUBLIC_FILES, SECURITY_HEADERS, API_HEADERS };
