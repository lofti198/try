const clean = (value) => value?.replace(/\s+/g, " ").trim() || "";

export function pickRequestedSpecs(entries) {
  const result = { dimensions: "", length: "", width: "", height: "", weight: "" };
  for (const [rawKey, rawValue] of entries) {
    const key = clean(rawKey).toLowerCase().replace(/ё/g, "е");
    const value = clean(rawValue);
    if (!value) continue;
    if (/^(габарит|габаритные размеры|размеры)/.test(key)) result.dimensions ||= value;
    else if (/^(длина|length|l)$/.test(key)) result.length ||= value;
    else if (/^(ширина|width|w)$/.test(key)) result.width ||= value;
    else if (/^(высота|height|h)$/.test(key)) result.height ||= value;
    else if (/^(вес|масса|weight)/.test(key)) result.weight ||= value;
  }
  return result;
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const columns = ["category_url", "product_url", "name", "source_sku", "description", "dimensions", "length", "width", "height", "weight", "image_urls"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((key) => quote(Array.isArray(row[key]) ? row[key].join(" | ") : row[key])).join(","))].join("\n");
}

export { clean };
