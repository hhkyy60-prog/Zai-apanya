import express from "express";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = Number(process.env.MAX_DOWNLOAD_BYTES || 200 * 1024 * 1024);
const SOCIAL_API_URL = process.env.AXEZEN_SOCIAL_API_URL || "";
const SOCIAL_API_TOKEN = process.env.AXEZEN_SOCIAL_API_TOKEN || "";

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224;
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") ||
    x.startsWith("fd") || /^fe[89ab]/.test(x) || x.startsWith("::ffff:127.") ||
    x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("URL tidak valid."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Hanya URL HTTP/HTTPS yang diizinkan.");
  if (u.username || u.password) throw new Error("URL dengan username/password tidak diizinkan.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
    throw new Error("Host lokal tidak diizinkan.");
  if (net.isIP(host) === 4 && isPrivateIPv4(host)) throw new Error("Alamat IP privat tidak diizinkan.");
  if (net.isIP(host) === 6 && isPrivateIPv6(host)) throw new Error("Alamat IP privat tidak diizinkan.");
  if (!net.isIP(host)) {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some(r => net.isIP(r.address) === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)))
      throw new Error("Host tidak publik atau mengarah ke jaringan privat.");
  }
  return u;
}
function safeFilename(name) {
  return path.basename(String(name || "ax ezen-download"))
    .replace(/[\\/\0-\x1f<>:"|?*]/g, "_").slice(0, 150) || "ax ezen-download";
}
function platformFromUrl(u) {
  const h = u.hostname.toLowerCase();
  if (h.includes("tiktok.com")) return "tiktok";
  if (h.includes("instagram.com")) return "instagram";
  if (h.includes("youtube.com") || h === "youtu.be") return "youtube";
  if (h.includes("facebook.com") || h === "fb.watch") return "facebook";
  if (h === "x.com" || h.endsWith(".x.com") || h === "twitter.com" || h.endsWith(".twitter.com")) return "x";
  if (h === "drive.google.com" || h === "docs.google.com") return "drive";
  return "direct";
}
function driveUrl(u) {
  const host = u.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return u.href;
  const match = u.pathname.match(/\/file\/d\/([^/]+)/) || u.pathname.match(/\/document\/d\/([^/]+)/);
  const id = (match && match[1]) || u.searchParams.get("id");
  if (!id) throw new Error("ID Google Drive tidak ditemukan. Gunakan link berbagi file.");
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "AXEZEN Downloader API" }));

app.post("/api/download", async (req, res) => {
  try {
    const { url, platform = "auto" } = req.body || {};
    if (!url) return res.status(400).json({ error: "URL wajib diisi." });
    let parsed = await validatePublicUrl(url);
    const detected = platform === "auto" ? platformFromUrl(parsed) : platform;
    if (["tiktok", "instagram", "youtube", "facebook", "x"].includes(detected)) {
      if (!SOCIAL_API_URL) {
        return res.status(501).json({
          error: `API resmi/penyedia untuk ${detected} belum dikonfigurasi. Tambahkan AXEZEN_SOCIAL_API_URL dan token di server.`
        });
      }
      const provider = await validatePublicUrl(SOCIAL_API_URL);
      const apiRes = await fetch(provider.href, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(SOCIAL_API_TOKEN ? { authorization: `Bearer ${SOCIAL_API_TOKEN}` } : {})
        },
        body: JSON.stringify({ url: parsed.href, platform: detected })
      });
      const data = await apiRes.json().catch(() => ({}));
      if (!apiRes.ok) return res.status(502).json({ error: data.error || `Provider API error ${apiRes.status}` });
      if (!data.downloadUrl) return res.status(502).json({ error: "Provider API tidak mengembalikan downloadUrl." });
      const finalUrl = await validatePublicUrl(data.downloadUrl);
      return res.json({
        downloadUrl: `/api/file?url=${encodeURIComponent(finalUrl.href)}`,
        filename: safeFilename(data.filename || `${detected}-media`),
        platform: detected
      });
    }

    const finalUrl = await validatePublicUrl(driveUrl(parsed));
    return res.json({
      downloadUrl: `/api/file?url=${encodeURIComponent(finalUrl.href)}`,
      filename: "ax ezen-download",
      platform: detected
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Tidak dapat memproses URL." });
  }
});

app.get("/api/file", async (req, res) => {
  try {
    let target = await validatePublicUrl(req.query.url);
    let upstream;
    for (let redirects = 0; redirects <= 5; redirects++) {
      upstream = await fetch(target.href, { redirect: "manual" });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get("location");
        if (!location) throw new Error("Redirect tanpa lokasi tujuan.");
        target = await validatePublicUrl(new URL(location, target).href);
        continue;
      }
      break;
    }
    if (!upstream || !upstream.ok) throw new Error(`Sumber mengembalikan HTTP ${upstream?.status || "error"}.`);
    const len = Number(upstream.headers.get("content-length") || 0);
    if (len > MAX_BYTES) throw new Error("File melebihi batas ukuran server.");
    const type = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("content-type", type);
    res.setHeader("content-disposition", `attachment; filename="${safeFilename(req.query.filename || "ax ezen-download")}"`);
    res.setHeader("x-content-type-options", "nosniff");
    if (len) res.setHeader("content-length", String(len));
    let bytes = 0;
    const reader = upstream.body.getReader();
    const { Readable } = await import("node:stream");
    const stream = new Readable({
      async read() {
        try {
          const part = await reader.read();
          if (part.done) return this.push(null);
          bytes += part.value.byteLength;
          if (bytes > MAX_BYTES) {
            res.destroy(new Error("File melebihi batas ukuran server."));
            return reader.cancel();
          }
          this.push(Buffer.from(part.value));
        } catch (err) { this.destroy(err); }
      }
    });
    await pipeline(stream, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message || "Download gagal." });
    else res.destroy();
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`AXEZEN API running on port ${PORT}`));
