import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pickRequestedSpecs, clean } from "./extract.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
];

function isCaptchaUrl(url) {
  return /\/forms\/captcha/i.test(url);
}

function cacheFileName(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/+/, "") || "index";
  const page = parsed.searchParams.get("page");
  const suffix = page ? `_page-${page}` : "";
  return `${path}${suffix}`
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 160) + ".html";
}

async function cacheLoadedPage(page, cacheDir, kind) {
  if (!cacheDir || isCaptchaUrl(page.url())) return;
  await mkdir(cacheDir, { recursive: true });
  const fileName = `${kind}_${cacheFileName(page.url())}`;
  await writeFile(join(cacheDir, fileName), await page.content(), "utf8");
}

function proxyLabel(proxy) {
  return proxy ? proxy.server.replace(/^[a-z0-9+.-]+:\/\//i, "") : "direct";
}

function profileName(proxy) {
  return proxyLabel(proxy).replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
}

function userAgentForProxy(proxy, index) {
  return proxy?.userAgent || USER_AGENTS[index % USER_AGENTS.length];
}

function nextProxy(proxies, index) {
  if (!proxies.length) return { proxy: null, nextIndex: index };
  return { proxy: proxies[index % proxies.length], nextIndex: index + 1 };
}

function chromeCandidates() {
  const env = process.env;
  return [
    env.CHROME_PATH,
    `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
}

async function findBrowserExecutable() {
  const { access } = await import("node:fs/promises");
  for (const path of chromeCandidates()) {
    try { await access(path); return path; } catch { /* try next */ }
  }
  throw new Error("Chrome/Edge not found. Set CHROME_PATH to a Chromium executable.");
}

async function catalogPageData(page) {
  return page.evaluate(() => {
    const absolute = (href) => { try { return new URL(href, location.href).href.split("#")[0]; } catch { return ""; } };
    const links = [...document.querySelectorAll('a[href*="/product/"]')]
      .map((a) => absolute(a.getAttribute("href")))
      .filter(Boolean);
    const next = document.querySelector("a.pager__next:not(.pager__next-pool)[href]") || [...document.querySelectorAll("a[href]")].find((a) => {
      const rel = (a.getAttribute("rel") || "").toLowerCase();
      const text = (a.textContent || "").trim().toLowerCase();
      const aria = (a.getAttribute("aria-label") || "").toLowerCase();
      return rel.includes("next") || /^(следующая|далее|next|›|»)$/.test(text) || /(следующ|next)/.test(aria);
    });
    const isTreePage = location.pathname.startsWith("/catalog/");
    const categoryUrls = isTreePage ? [...document.querySelectorAll('main a[href*="/catalog/"] , main a[href*="/catalog-show/"]')]
      .filter((a) => !a.closest(".bc, .breadcrumbs, header, footer, nav") && !a.matches('[class*="bc__"], .pager__next, .pager__page, .icon_catalog-table, .button'))
      .map((a) => absolute(a.getAttribute("href")))
      .filter((url) => url && new URL(url).hostname === location.hostname && !new URL(url).search)
      : [];
    return {
      productUrls: [...new Set(links)],
      categoryUrls: [...new Set(categoryUrls)],
      nextUrl: next ? absolute(next.getAttribute("href")) : "",
    };
  });
}

async function productData(page, categoryUrl) {
  const raw = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const meta = (name, attr = "name") => document.querySelector(`meta[${attr}="${name}"]`)?.content || "";
    const pairs = [];
    for (const row of document.querySelectorAll("table tr, dl, .product__params li, .product-params li, .characteristics li")) {
      const cells = [...row.querySelectorAll("th,td,dt,dd")].map(text).filter(Boolean);
      if (cells.length >= 2) pairs.push([cells[0], cells.slice(1).join(" ")]);
      else {
        const parts = text(row).split(/\s*[:—]\s*/, 2);
        if (parts.length === 2) pairs.push(parts);
      }
    }
    const galleryImages = [...document.querySelectorAll('[itemprop="image"], .product__gallery img, .product-gallery img, .product__images img, .product-images img, [class*="product-gallery"] img, [class*="product-images"] img')]
      .map((img) => img.currentSrc || img.src || img.content)
      .filter((src) => src && !/logo|icon|sprite|counter|pixel|bnr/i.test(src));
    const skuText = text(document.querySelector('[itemprop="sku"], .product__code, .product-code, [class*="product-code"]'));
    return {
      name: text(document.querySelector("h1")) || meta("og:title", "property"),
      sourceSku: skuText.replace(/^(код товара|артикул)\s*[:№]?\s*/i, ""),
      description: meta("description") || text(document.querySelector('[itemprop="description"], .product__description, .product-description')),
      images: [...new Set([meta("og:image", "property"), ...galleryImages].filter(Boolean))],
      pairs,
    };
  });
  return { category_url: categoryUrl, product_url: page.url(), name: clean(raw.name), source_sku: clean(raw.sourceSku), description: clean(raw.description), ...pickRequestedSpecs(raw.pairs), image_urls: raw.images };
}

async function contextForProxy(contexts, executablePath, proxy, proxyIndex, browserCacheDir, headless) {
  const key = profileName(proxy);
  if (contexts.has(key)) return contexts.get(key);
  const userDataDir = resolve(browserCacheDir, key);
  await mkdir(userDataDir, { recursive: true });
  const options = {
    executablePath,
    headless,
    locale: "ru-RU",
    userAgent: userAgentForProxy(proxy, proxyIndex),
  };
  if (proxy) options.proxy = proxy;
  const context = await chromium.launchPersistentContext(userDataDir, options);
  contexts.set(key, context);
  return context;
}

async function withPage(contexts, executablePath, proxy, proxyIndex, browserCacheDir, headless, task) {
  const context = await contextForProxy(contexts, executablePath, proxy, proxyIndex, browserCacheDir, headless);
  const page = await context.newPage();
  try {
    return await task(page);
  } finally {
    await page.close();
  }
}

const CAPTCHA_BACKOFF_MS = 60000;

function isCatalogDataEmpty(data) {
  return data.productUrls.length === 0 && data.categoryUrls.length === 0 && !data.nextUrl;
}

async function loadCatalog(contexts, executablePath, url, proxy, proxyIndex, cacheDir, browserCacheDir, headless, onProgress) {
  return withPage(contexts, executablePath, proxy, proxyIndex, browserCacheDir, headless, async (page) => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "unknown"}`);
    let captcha = isCaptchaUrl(page.url());
    let data = captcha ? null : await catalogPageData(page);
    if (!captcha && isCatalogDataEmpty(data)) captcha = true;
    if (captcha && !proxy) {
      onProgress(`CAPTCHA encountered (no proxy), sleeping ${CAPTCHA_BACKOFF_MS / 1000}s: ${url}`);
      await delay(CAPTCHA_BACKOFF_MS);
      const retryResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!retryResponse?.ok()) throw new Error(`HTTP ${retryResponse?.status() ?? "unknown"}`);
      if (isCaptchaUrl(page.url())) throw new Error(`CAPTCHA ${page.url()}`);
      data = await catalogPageData(page);
    } else if (captcha) {
      throw new Error(`CAPTCHA ${page.url()}`);
    }
    await cacheLoadedPage(page, cacheDir, "catalog");
    return data;
  });
}

async function loadProduct(contexts, executablePath, url, root, proxy, proxyIndex, cacheDir, browserCacheDir, headless, onProgress) {
  return withPage(contexts, executablePath, proxy, proxyIndex, browserCacheDir, headless, async (page) => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? "unknown"}`);
    let captcha = isCaptchaUrl(page.url());
    let row = captcha ? null : await productData(page, root);
    if (!captcha && (!row.name || !row.source_sku)) captcha = true;
    if (captcha && !proxy) {
      onProgress(`CAPTCHA encountered (no proxy), sleeping ${CAPTCHA_BACKOFF_MS / 1000}s: ${url}`);
      await delay(CAPTCHA_BACKOFF_MS);
      const retryResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!retryResponse?.ok()) throw new Error(`HTTP ${retryResponse?.status() ?? "unknown"}`);
      if (isCaptchaUrl(page.url())) throw new Error(`CAPTCHA ${page.url()}`);
      row = await productData(page, root);
      if (!row.name || !row.source_sku) throw new Error("product data was not gathered");
    } else if (captcha) {
      throw new Error("product data was not gathered");
    }
    await cacheLoadedPage(page, cacheDir, "product");
    return row;
  });
}

export async function scrape({ categoryUrls, maxPages = Infinity, maxProducts = Infinity, delayMs = 900, headless = true, initialRows = [], proxies = [], cacheDir = "cache/pages", browserCacheDir = "browser-cache", onProgress = () => {}, onCheckpoint = async () => {} }) {
  const executablePath = await findBrowserExecutable();
  const contexts = new Map();
  const rows = [...initialRows];
  const seenProducts = new Set(rows.map((row) => row.product_url));
  const queue = [...new Set(categoryUrls)].map((url) => ({ url, root: url }));
  const queuedCategories = new Set(queue.map(({ url }) => url));
  const visitedCategories = new Set();
  let proxyIndex = 0;
  try {
    while (queue.length && rows.length < maxProducts) {
      const { url: categoryUrl, root } = queue.shift();
      if (visitedCategories.has(categoryUrl)) continue;
      visitedCategories.add(categoryUrl);
      let nextUrl = categoryUrl;
      const seenPages = new Set();
      const productUrls = new Set();
      while (nextUrl && !seenPages.has(nextUrl) && seenPages.size < maxPages) {
        seenPages.add(nextUrl);
        const picked = nextProxy(proxies, proxyIndex);
        proxyIndex = picked.nextIndex;
        onProgress(`Catalog ${visitedCategories.size} page ${seenPages.size}: ${nextUrl} [proxy ${proxyLabel(picked.proxy)}]`);
        let data;
        try {
          data = await loadCatalog(contexts, executablePath, nextUrl, picked.proxy, proxyIndex - 1, cacheDir, browserCacheDir, headless, onProgress);
        } catch (error) {
          onProgress(`WARN catalog skipped: ${nextUrl} (${error.message})`);
          break;
        }
        data.productUrls.forEach((url) => productUrls.add(url));
        for (const childUrl of data.categoryUrls) {
          if (!queuedCategories.has(childUrl)) {
            queuedCategories.add(childUrl);
            queue.push({ url: childUrl, root });
          }
        }
        nextUrl = data.nextUrl;
        await delay(delayMs);
      }
      for (const productUrl of productUrls) {
        if (seenProducts.has(productUrl)) continue;
        seenProducts.add(productUrl);
        const picked = nextProxy(proxies, proxyIndex);
        proxyIndex = picked.nextIndex;
        onProgress(`Product ${rows.length + 1}: ${productUrl} [proxy ${proxyLabel(picked.proxy)}]`);
        try {
          rows.push(await loadProduct(contexts, executablePath, productUrl, root, picked.proxy, proxyIndex - 1, cacheDir, browserCacheDir, headless, onProgress));
          await onCheckpoint(rows);
        } catch (error) {
          onProgress(`WARN product skipped: ${productUrl} (${error.message})`);
        }
        await delay(delayMs);
        if (rows.length >= maxProducts) return rows;
      }
    }
    return rows;
  } finally {
    await Promise.all([...contexts.values()].map((context) => context.close()));
  }
}
