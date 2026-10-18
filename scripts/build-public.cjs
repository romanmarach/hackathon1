const fs = require("node:fs");
const path = require("node:path");
const { PUBLIC_FILES, SECURITY_HEADERS } = require("../security-headers");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
// Remove only generated output in this workspace; never follow a symlink.
if (path.dirname(output) !== root || (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())) {
  throw new Error("Refusing to replace an unsafe build directory.");
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
for (const file of PUBLIC_FILES) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.writeFileSync(path.join(output, "_headers"), "/*\n" + Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join("\n") + "\n");
console.log(`Built ${PUBLIC_FILES.length} browser assets. Server files, credentials, and test documents are excluded.`);
