// Serves the dev app over HTTPS on the local network, so phones on the same
// Wi-Fi can open it. Cameras only work on secure pages, and plain http:// on
// a LAN address is not secure. A self-signed certificate is generated with
// OpenSSL (nothing is downloaded); phones will show a warning to accept once.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "certificates");
const key = join(dir, "lan-key.pem");
const cert = join(dir, "lan-cert.pem");
const stamp = join(dir, "lan-ips.txt");
const port = process.env.PORT || "3443";

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);
if (!ips.length) {
  console.error("No local network address found. Connect to Wi-Fi or Ethernet first.");
  process.exit(1);
}

const wanted = ips.join(",");
const current = existsSync(stamp) ? readFileSync(stamp, "utf8") : "";
if (!existsSync(key) || !existsSync(cert) || current !== wanted) {
  mkdirSync(dir, { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "30",
      "-subj",
      "/CN=irl3-obj-dev",
      "-addext",
      `subjectAltName=${san}`,
    ],
    { stdio: "ignore" },
  );
  writeFileSync(stamp, wanted);
}

console.log("\nOpen on your phone (same Wi-Fi):");
for (const ip of ips) console.log(`  https://${ip}:${port}`);
console.log("Accept the certificate warning once (it is this computer's own certificate).\n");

const next = spawn(
  "npx",
  [
    "next",
    "dev",
    "-H",
    "0.0.0.0",
    "-p",
    port,
    "--experimental-https",
    "--experimental-https-key",
    key,
    "--experimental-https-cert",
    cert,
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
next.on("exit", (code) => process.exit(code ?? 0));
