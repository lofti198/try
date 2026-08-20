# ChipDip scraper pilot

Browser-based scraper for the supplied ChipDip categories. It recursively enters category trees, follows the site's **Next** pagination, visits product pages, deduplicates products, checkpoints after every product, and exports only website-visible product data.

## Output fields

- category and product URL
- product name and source SKU/article when shown
- on-site description (unchanged; no AI rewriting)
- dimensions or separate length/width/height when shown
- weight when shown
- image URLs present on the product page

Missing website fields are left empty. The pilot does not search Google Images, invent missing data, download images, or call an AI service.

## Run

```powershell
$env:YARN_CACHE_FOLDER = Join-Path (Get-Location) ".yarn-cache"
yarn
yarn scrape --max-pages 1 --max-products 10 --show-browser
```

Remove the two limits for a full run:

```powershell
yarn scrape
```

For a bounded, visible run with resumable output and a log:

```powershell
yarn scrape --max-products 1000 --delay-ms 1200 --show-browser --resume --output output/full-run 2>&1 | Tee-Object -FilePath "scraping.log"
```

## Proxies and cache

Put proxies in `proxy.txt`, one per line:

```text
ip:port:login:password
```

The scraper rotates proxies on each catalog/product load and logs the `ip:port` used for that load. By default it uses `http://`, which is the compatible mode for authenticated Proxy6 HTTPS proxies in Playwright. Use `--proxy-protocol socks5` only for unauthenticated SOCKS5 proxies.

Successfully loaded non-CAPTCHA pages are cached as HTML files in `cache/pages`. CAPTCHA pages and pages where product data was not gathered are not cached.

Browser profiles are separate from saved HTML. Each proxy gets its own persistent browser cache folder under `browser-cache/<proxy-ip_port>` and its own stable user agent for the whole run.

Example:

```powershell
yarn scrape --max-products 1000 --delay-ms 1200 --show-browser --resume --proxy-file proxy.txt --cache-dir cache/pages --browser-cache-dir browser-cache --output output/full-run | Tee-Object -FilePath "scraping.log"
```

Results are saved as UTF-8 `output/products.json` and Excel-friendly `output/products.csv`. Use `--delay-ms 1500` for a slower request rate, `--input another-file.txt`, or `--output another-folder` as needed. If Chrome/Edge is not found automatically, set `CHROME_PATH` for that command.

The site currently rejects generic server requests, so the scraper uses locally installed Chrome/Edge. If a CAPTCHA or access check appears, rerun with `--show-browser`; the program does not attempt to bypass access controls.
