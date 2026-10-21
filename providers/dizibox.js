/**
 * Nuvio Provider: DiziBox
 * Author: ttuloglu
 * Supports: Foreign Series (1080p HLS Master + Subtitles)
 */

const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const BASE_URL = "https://www.dizibox.live";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function fetchWithTimeout(url, opts, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function resolveTmdbInfo(id, mediaType) {
  try {
    let cleanId = String(id || "").trim();
    if (cleanId.includes(":")) cleanId = cleanId.split(":")[0];
    let title = "";
    let origTitle = "";

    if (cleanId.startsWith("tt")) {
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
        { headers: { "User-Agent": UA } }
      );
      if (res.ok) {
        const data = await res.json();
        const item = data.tv_results?.[0] || data.movie_results?.[0];
        if (item) {
          title = item.name || item.title || "";
          origTitle = item.original_name || item.original_title || "";
        }
      }
    } else if (/^\d+$/.test(cleanId)) {
      const type = (mediaType === "movie") ? "movie" : "tv";
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/${type}/${cleanId}?api_key=${TMDB_API_KEY}&language=tr-TR`,
        { headers: { "User-Agent": UA } }
      );
      if (res.ok) {
        const data = await res.json();
        title = data.name || data.title || "";
        origTitle = data.original_name || data.original_title || "";
      }
    } else {
      title = cleanId;
    }
    return { title, origTitle };
  } catch (e) {
    return { title: String(id || ""), origTitle: "" };
  }
}

async function extractStreamsFromEpisode(epUrl) {
  try {
    const res = await fetchWithTimeout(epUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const iframes = Array.from(html.matchAll(/<iframe[^>]+src=["\x27]([^"\x27]+)["\x27]/gi)).map(m => m[1]);
    const streams = [];

    for (const ifr of iframes) {
      const fullIfr = ifr.startsWith("//") ? "https:" + ifr : (ifr.startsWith("http") ? ifr : BASE_URL + ifr);

      // King player
      if (fullIfr.includes("king.php") || fullIfr.includes("player")) {
        try {
          const kRes = await fetchWithTimeout(fullIfr, {
            headers: { "User-Agent": UA, "Referer": epUrl }
          });
          if (kRes.ok) {
            const kHtml = await kRes.text();
            const innerMatch = kHtml.match(/src=["\x27](https?:\/\/[^"\x27]*molystream[^"\x27]*)["\x27]/i);
            if (innerMatch) {
              const molyUrl = innerMatch[1];
              const idMatch = molyUrl.match(/\/embed\/([a-zA-Z0-9_-]+)/);
              if (idMatch) {
                const molyId = idMatch[1];
                const masterStream = `https://dbx.molystream.org/embed/sheila/${molyId}`;
                const mHeaders = {
                  "Referer": `https://dbx.molystream.org/embed/${molyId}`,
                  "User-Agent": UA
                };
                streams.push({
                  name: "DiziBox",
                  title: "DiziBox - 1080p [Türkçe Altyazılı / Molystream]",
                  url: masterStream,
                  quality: "1080p",
                  format: "hls",
                  isHls: true,
                  contentLanguage: ["tr", "en"],
                  headers: mHeaders,
                  behaviorHints: {
                    headers: mHeaders
                  }
                });
              }
            }

            const vidmolyMatch = kHtml.match(/src=["\x27](https?:\/\/[^"\x27]*vidmoly[^"\x27]*)["\x27]/i);
            if (vidmolyMatch) {
              let vmUrl = vidmolyMatch[1];
              vmUrl = vmUrl.replace("vidmoly.to", "vidmoly.biz").replace("vidmoly.net", "vidmoly.biz");
              const vmRes = await fetchWithTimeout(vmUrl, { headers: { "User-Agent": UA } });
              if (vmRes.ok) {
                const vmHtml = await vmRes.text();
                const m = vmHtml.match(/file\s*:\s*["\x27](https?:\/\/[^"\x27\s<>]+\.m3u8[^"\x27\s<>]*)["\x27]/i);
                if (m) {
                  const sHeaders = { "User-Agent": UA, "Referer": "https://vidmoly.biz/" };
                  streams.push({
                    name: "DiziBox",
                    title: "DiziBox - 1080p [VidMoly HLS]",
                    url: m[1],
                    quality: "1080p",
                    format: "hls",
                    isHls: true,
                    contentLanguage: ["tr", "en"],
                    headers: sHeaders,
                    behaviorHints: { headers: sHeaders }
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    return streams;
  } catch (e) {
    return [];
  }
}

async function getStreams(tmdbIdOrArgs, mediaType, seasonNum, episodeNum) {
  try {
    let rawId = tmdbIdOrArgs;
    let sNum = seasonNum || 1;
    let eNum = episodeNum || 1;
    let mType = mediaType || "tv";

    if (typeof tmdbIdOrArgs === "object" && tmdbIdOrArgs !== null) {
      rawId = tmdbIdOrArgs.id || tmdbIdOrArgs.url || "";
      mType = tmdbIdOrArgs.type || tmdbIdOrArgs.mediaType || mType;
      sNum = tmdbIdOrArgs.season || tmdbIdOrArgs.seasonNum || sNum;
      eNum = tmdbIdOrArgs.episode || tmdbIdOrArgs.episodeNum || eNum;
    }

    rawId = String(rawId || "").trim();
    if (rawId.includes(":")) {
      const parts = rawId.split(":");
      rawId = parts[0];
      if (parts[1] && /^\d+$/.test(parts[1])) sNum = parseInt(parts[1], 10);
      if (parts[2] && /^\d+$/.test(parts[2])) eNum = parseInt(parts[2], 10);
    }

    const tmdb = await resolveTmdbInfo(rawId, mType);
    const candidates = [tmdb.title, tmdb.origTitle].filter(Boolean);
    if (candidates.length === 0 && rawId) candidates.push(rawId);

    for (const name of candidates) {
      const slug = slugify(name);
      const possibleUrls = [
        `${BASE_URL}/diziler/${slug}/`,
        `${BASE_URL}/diziler/${slug}-izle/`,
        `${BASE_URL}/diziler/${slug}-hd/`,
        `${BASE_URL}/${slug}/`
      ];

      for (const pUrl of possibleUrls) {
        try {
          const sRes = await fetchWithTimeout(pUrl, { headers: { "User-Agent": UA } }, 5000);
          if (sRes.ok) {
            const sHtml = await sRes.text();
            const epRegex = new RegExp(`href=["\x27](https://www\\.dizibox\\.live/[^"\x27]+)["\x27][^>]*>\\s*${sNum}\\.\\s*Sezon\\s*${eNum}\\.\\s*B[oö]l[uü]m`, "i");
            const epMatch = sHtml.match(epRegex);
            if (epMatch) {
              const streams = await extractStreamsFromEpisode(epMatch[1]);
              if (streams.length > 0) return streams;
            }
          }
        } catch (e) {}
      }
    }

    return [];
  } catch (err) {
    return [];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
