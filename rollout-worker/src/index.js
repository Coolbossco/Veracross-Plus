/**
 * Read-only staged rollout API for Veracross Plus.
 *
 * GET /v1/rollout?version=0.7.0&user=parnellks
 * → { enabled, version, published, reason }
 *
 * Config is edited only in the Cloudflare dashboard (KV). No write API.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Edge / browser cache window (seconds). */
const CACHE_SECONDS = 120;

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLocalPart(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const at = trimmed.indexOf("@");
  return at === -1 ? trimmed : trimmed.slice(0, at);
}

/**
 * @param {Record<string, string>} body
 * @param {number} status
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      ...CORS_HEADERS,
    },
  });
}

/**
 * @param {Request} request
 * @param {{ ROLLOUT_KV: KVNamespace }} env
 */
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          enabled: false,
          version: "",
          published: false,
          reason: "method_not_allowed",
        },
        405,
      );
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v1/rollout") {
      return jsonResponse(
        {
          enabled: false,
          version: "",
          published: false,
          reason: "not_found",
        },
        404,
      );
    }

    const version = (url.searchParams.get("version") || "").trim();
    const user = normalizeLocalPart(url.searchParams.get("user") || "");

    if (!version) {
      return jsonResponse({
        enabled: false,
        version: "",
        published: false,
        reason: "missing_version",
      });
    }

    /** @type {{ published?: boolean, allowlist?: unknown } | null} */
    let config = null;
    try {
      config = await env.ROLLOUT_KV.get(`rollout:${version}`, "json");
    } catch {
      return jsonResponse({
        enabled: false,
        version,
        published: false,
        reason: "kv_error",
      });
    }

    if (!config || typeof config !== "object") {
      return jsonResponse({
        enabled: false,
        version,
        published: false,
        reason: "missing_config",
      });
    }

    const published = config.published === true;
    const allowlist = Array.isArray(config.allowlist)
      ? config.allowlist
          .map((entry) => normalizeLocalPart(String(entry)))
          .filter(Boolean)
      : [];

    if (published) {
      return jsonResponse({
        enabled: true,
        version,
        published: true,
        reason: "published",
      });
    }

    if (user && allowlist.includes(user)) {
      return jsonResponse({
        enabled: true,
        version,
        published: false,
        reason: "allowlisted",
      });
    }

    return jsonResponse({
      enabled: false,
      version,
      published: false,
      reason: user ? "not_allowlisted" : "unpublished",
    });
  },
};
