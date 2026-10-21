/**
 * Nuvio Provider: SineVix
 * Author: ttuloglu
 * Supports: Movies & Series (1080p HLS Streams + Turkish Dub/Sub)
 */

const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const BASE_URL = "https://www.filmmodu.one";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchWithTimeout(url, opts, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function cleanTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveTmdbInfo(id, mediaType) {
  try {
    let cleanId = String(id || "").trim();
    if (cleanId.includes(":")) cleanId = cleanId.split(":")[0];
    let title = "";
    let origTitle = "";
    let year = "";

    if (cleanId.startsWith("tt")) {
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`,
        { headers: { "User-Agent": UA } }
      );
      if (res.ok) {
        const data = await res.json();
        const isTv = mediaType === "tv" || mediaType === "series";
        const item = (isTv ? data.tv_results?.[0] : data.movie_results?.[0]) || data.movie_results?.[0] || data.tv_results?.[0];
        if (item) {
          title = item.name || item.title || "";
          origTitle = item.original_name || item.original_title || "";
          const dateStr = item.first_air_date || item.release_date || "";
          if (dateStr) year = dateStr.split("-")[0];
        }
      }
    } else if (/^\d+$/.test(cleanId)) {
      const type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/${type}/${cleanId}?api_key=${TMDB_API_KEY}&language=tr-TR`,
        { headers: { "User-Agent": UA } }
      );
      if (res.ok) {
        const data = await res.json();
        title = data.name || data.title || "";
        origTitle = data.original_name || data.original_title || "";
        const dateStr = data.first_air_date || data.release_date || "";
        if (dateStr) year = dateStr.split("-")[0];
      }
    } else {
      title = cleanId;
    }
    return { title, origTitle, year };
  } catch (e) {
    return { title: String(id || ""), origTitle: "", year: "" };
  }
}

async function searchFilmModu(query) {
  try {
    const searchUrl = `${BASE_URL}/film-ara?q=` + encodeURIComponent(query);
    const res = await fetchWithTimeout(searchUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const movieRegex = /<div class="col-md-2 col-xs-6 movie">[\s\S]*?<a href="([^"]+)">([^<]+)<\/a>/gi;
    let match;
    while ((match = movieRegex.exec(html)) !== null) {
      results.push({ url: match[1], title: match[2].trim() });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function extractFilmModuStream(pageUrl) {
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Check alternate pages (Dublaj / Altyazı)
    const altPages = [];
    const altRegex = /<a href="([^"]+)" type="button" class="btn [^"]*">([^<]+)<\/a>/gi;
    let aMatch;
    while ((aMatch = altRegex.exec(html)) !== null) {
      const aUrl = aMatch[1];
      const aName = aMatch[2].trim();
      if (!aName.includes("Fragman")) {
        altPages.push({ url: aUrl, name: aName });
      }
    }

    if (altPages.length === 0) {
      altPages.push({ url: pageUrl, name: "Türkçe" });
    }

    const streams = [];

    for (const alt of altPages) {
      const aRes = await fetchWithTimeout(alt.url, {
        headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
      });
      if (!aRes.ok) continue;
      const aHtml = await aRes.text();

      const idMatch = aHtml.match(/var videoId = '(\d+)';/);
      const typeMatch = aHtml.match(/var videoType = '([^']*)';/);
      if (!idMatch) continue;

      const videoId = idMatch[1];
      const videoType = typeMatch ? typeMatch[1] : "";

      const sRes = await fetchWithTimeout(`${BASE_URL}/get-source?movie_id=${videoId}&type=${videoType}`, {
        headers: {
          "User-Agent": UA,
          "Referer": alt.url,
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      if (!sRes.ok) continue;
      const data = await sRes.json();
      if (!data || !data.sources || !Array.isArray(data.sources)) continue;

      for (const srcItem of data.sources) {
        if (!srcItem.src) continue;
        let sUrl = srcItem.src;
        if (!sUrl.includes(".m3u8")) sUrl += ".m3u8";

        const label = srcItem.label || (srcItem.res ? srcItem.res + "p" : "1080p");
        const headers = { "Referer": BASE_URL + "/", "User-Agent": UA };

        streams.push({
          name: "SineVix",
          title: `SineVix - ${label} [${alt.name}]`,
          url: sUrl,
          quality: label,
          format: "hls",
          isHls: true,
          contentLanguage: ["tr"],
          headers: headers,
          behaviorHints: { headers: headers }
        });
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
    let mType = mediaType || "movie";

    if (typeof tmdbIdOrArgs === "object" && tmdbIdOrArgs !== null) {
      rawId = tmdbIdOrArgs.id || tmdbIdOrArgs.url || "";
      mType = tmdbIdOrArgs.type || tmdbIdOrArgs.mediaType || mType;
    }

    rawId = String(rawId || "").trim();
    if (rawId.includes(":")) rawId = rawId.split(":")[0];

    const tmdb = await resolveTmdbInfo(rawId, mType);
    const candidates = [tmdb.title, tmdb.origTitle].filter(Boolean);
    if (candidates.length === 0 && rawId) candidates.push(rawId);

    let matchedMovie = null;
    for (const q of candidates) {
      const results = await searchFilmModu(q);
      if (results && results.length > 0) {
        matchedMovie = results[0];
        break;
      }
    }

    if (!matchedMovie) return [];

    return await extractFilmModuStream(matchedMovie.url);
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
