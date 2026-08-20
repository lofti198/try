import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrape } from "./scraper.js";
import { toCsv } from "./extract.js";

const value = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const has = (name) => process.argv.includes(name);
const input = resolve(value("--input", "categories.txt"));
const outputDir = resolve(value("--output", "output"));
const proxyFile = resolve(value("--proxy-file", "proxy.txt"));
const proxyProtocol = value("--proxy-protocol", "http");
const urls = (await readFile(input, "utf8")).split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
let proxies = [];
if (!has("--no-proxy")) {
  try {
    proxies = (await readFile(proxyFile, "utf8"))
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("#"))
      .map((line) => {
        const [host, port, username, password] = line.split(":");
        if (!host || !port || !username || !password) throw new Error(`Invalid proxy line: ${line}`);
        return { server: `${proxyProtocol}://${host}:${port}`, username, password };
      });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(outputDir, { recursive: true });
const jsonPath = resolve(outputDir, "products.json");
const csvPath = resolve(outputDir, "products.csv");
let initialRows = [];
if (has("--resume")) {
  try { initialRows = JSON.parse(await readFile(jsonPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const save = async (rows) => {
  await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  await writeFile(csvPath, `\uFEFF${toCsv(rows)}`, "utf8");
};
const rows = await scrape({
  categoryUrls: urls,
  maxPages: Number(value("--max-pages", "Infinity")),
  maxProducts: Number(value("--max-products", "Infinity")),
  delayMs: Number(value("--delay-ms", "900")),
  headless: !has("--show-browser"),
  initialRows,
  proxies,
  cacheDir: resolve(value("--cache-dir", "cache/pages")),
  browserCacheDir: resolve(value("--browser-cache-dir", "browser-cache")),
  onProgress: console.log,
  onCheckpoint: save,
});
await save(rows);
console.log(`Saved ${rows.length} products to ${outputDir}`);
