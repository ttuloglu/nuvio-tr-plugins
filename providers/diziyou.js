/**
 * Nuvio Provider: DiziYou
 * Author: ttuloglu
 * Supports: Foreign Series (1080p Direct HLS + Turkish VTT Subtitles)
 */

const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const BASE_URL = "https://www.diziyou.one";
const STORAGE_URL = "https://storage.diziyou.one";
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

async function extractDiziYouStream(epUrl) {
  try {
    const res = await fetchWithTimeout(epUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const playerMatch = html.match(/id=["\x27]diziyouPlayer["\x27][^>]+src=["\x27]([^"\x27]+)["\x27]/i) ||
                        html.match(/src=["\x27]([^"\x27]+)["\x27][^>]+id=["\x27]diziyouPlayer["\x27]/i);
    if (!playerMatch) return [];

    const itemId = playerMatch[1].split("/").pop().replace(".html", "").split("?")[0];
    if (!itemId) return [];

    const streamUrl = `${STORAGE_URL}/episodes/${itemId}/play.m3u8`;
    const subUrl = `${STORAGE_URL}/subtitles/${itemId}/tr.vtt`;

    const headers = {
      "Referer": BASE_URL + "/",
      "User-Agent": UA
    };

    return [{
      name: "DiziYou",
      title: "DiziYou - 1080p [Türkçe Altyazılı HLS]",
      url: streamUrl,
      quality: "1080p",
      format: "hls",
      isHls: true,
      contentLanguage: ["tr", "en"],
      headers: headers,
      behaviorHints: {
        headers: headers
      },
      subtitles: [
        { label: "Türkçe", url: subUrl, lang: "tr" }
      ]
    }];
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
      const possibleEpUrls = [
        `${BASE_URL}/${slug}-${sNum}-sezon-${eNum}-bolum/`,
        `${BASE_URL}/${slug}-dizi-${sNum}-sezon-${eNum}-bolum/`
      ];

      for (const epUrl of possibleEpUrls) {
        const streams = await extractDiziYouStream(epUrl);
        if (streams.length > 0) return streams;
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
