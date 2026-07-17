const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

export function cleanImageQuery(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildCommonsImageUrl(query, limit = 8) {
  const cleaned = cleanImageQuery(query);
  if (cleaned.length < 2) throw new Error("Image query is too short.");
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: cleaned,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(Math.max(Number(limit) || 8, 1), 12)),
    prop: "imageinfo",
    iiprop: "url|mime|user|extmetadata",
    iiurlwidth: "900",
    origin: "*",
  }).toString();
  return url.toString();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripCommonsHtml(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function metadataValue(metadata, key) {
  return stripCommonsHtml(metadata?.[key]?.value);
}

export function parseCommonsImages(payload) {
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  return pages.flatMap((page) => {
    const info = page?.imageinfo?.[0];
    const imageUrl = info?.thumburl || info?.url;
    if (!info || !String(info.mime || "").startsWith("image/") || !imageUrl?.startsWith("https://upload.wikimedia.org/")) {
      return [];
    }
    const metadata = info.extmetadata || {};
    const descriptionUrl = info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`;
    return [{
      url: imageUrl,
      originalUrl: info.url || imageUrl,
      title: metadataValue(metadata, "ObjectName") || stripCommonsHtml(String(page.title || "").replace(/^File:/i, "")),
      author: metadataValue(metadata, "Artist") || metadataValue(metadata, "Credit") || stripCommonsHtml(info.user) || "Wikimedia contributor",
      license: metadataValue(metadata, "LicenseShortName") || metadataValue(metadata, "UsageTerms") || "Lizenz prüfen",
      licenseUrl: metadataValue(metadata, "LicenseUrl") || descriptionUrl,
      sourceUrl: descriptionUrl,
    }];
  });
}
