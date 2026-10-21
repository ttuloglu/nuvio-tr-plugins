/**
 * Nuvio Provider: HDFilmCehennemi
 * Author: ttuloglu
 * Supports: Movies & Series (1080p Dual Audio [TR Dublaj & Orijinal] + Subtitles)
 */

const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const BASE_URL = "https://www.hdfilmcehennemi.land";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function fetchWithTimeout(url, opts, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function atobShim(str) {
  if (typeof atob !== "undefined") return atob(str);
  if (typeof Buffer !== "undefined") return Buffer.from(str, "base64").toString("binary");
  return "";
}

function decryptXor(cipherB64, keyB64) {
  try {
    const r = atobShim(cipherB64);
    const k = atobShim(keyB64);
    let out = "";
    for (let i = 0; i < r.length; i++) {
      out += String.fromCharCode(r.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    return out.split("|")[0];
  } catch (e) {
    return null;
  }
}

async function resolveTmdbInfo(id, mediaType) {
  try {
    let cleanId = String(id || "").trim();
    if (cleanId.includes(":")) cleanId = cleanId.split(":")[0];
    let title = "";
    let origTitle = "";
    let imdbId = "";

    if (cleanId.startsWith("tt")) {
      imdbId = cleanId;
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
        if (data.imdb_id) imdbId = data.imdb_id;
      }
    } else {
      title = cleanId;
    }
    return { title, origTitle, imdbId };
  } catch (e) {
    return { title: String(id || ""), origTitle: "", imdbId: "" };
  }
}

async function searchHDF(query, isTv) {
  try {
    const res = await fetchWithTimeout(BASE_URL + "/?s=" + encodeURIComponent(query), {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const itemRegex = /<div class="result-item"[\s\S]*?<a href="([^"]+)"[\s\S]*?<img src="[^"]*" alt="([^"]*)"/gi;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      results.push({ url: match[1], title: match[2] });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function extractFastPlayStream(movieOrEpisodeUrl) {
  try {
    const res = await fetchWithTimeout(movieOrEpisodeUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const nonceMatch = html.match(/nonce:\s*["\x27]([a-f0-9]+)["\x27]/i);
    const postMatch = html.match(/data-post-id=["\x27](\d+)["\x27]/i);
    if (!nonceMatch || !postMatch) return [];

    const nonce = nonceMatch[1];
    const postId = postMatch[1];

    const ajaxRes = await fetchWithTimeout(BASE_URL + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Referer": movieOrEpisodeUrl,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: "action=get_video_url&nonce=" + nonce + "&post_id=" + postId + "&player_name=SetPlay&part_key="
    });
    if (!ajaxRes.ok) return [];
    const ajaxJson = await ajaxRes.json();
    if (!ajaxJson || !ajaxJson.data || !ajaxJson.data.url) return [];

    const setplayUrl = ajaxJson.data.url;
    const spRes = await fetchWithTimeout(setplayUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
    });
    if (!spRes.ok) return [];
    const spHtml = await spRes.text();

    const cerceveMatch = spHtml.match(/SPG\.cerceve\s*\(\s*["\x27][^"\x27]+["\x27]\s*,\s*["\x27]([^"\x27]+)["\x27]\s*,\s*["\x27]([^"\x27]+)["\x27]\s*\)/);
    if (!cerceveMatch) return [];

    const fastplayUrl = decryptXor(cerceveMatch[1], cerceveMatch[2]);
    if (!fastplayUrl) return [];

    const fpRes = await fetchWithTimeout(fastplayUrl, {
      headers: { "User-Agent": UA, "Referer": "https://setplay.shop/" }
    });
    if (!fpRes.ok) return [];
    const fpHtml = await fpRes.text();

    const spgMatch = fpHtml.match(/window\.SPG_A\s*=\s*(\{.*?\});/);
    const streamMatch = fpHtml.match(/stream:\s*"([^"]+)"/);
    if (!spgMatch || !streamMatch) return [];

    const spg = JSON.parse(spgMatch[1]);
    const streamPath = streamMatch[1];

    const o = spg.sp;
    const n = Math.floor(Date.now() / 1000);
    const r = Math.floor(2176782336 * Math.random()).toString(36);
    let t = 2166136261;
    const str = o + "|" + n + "|" + r;
    for (let idx = 0; idx < str.length; idx++) {
      t ^= str.charCodeAt(idx);
      t = Math.imul(t, 16777619) >>> 0;
    }
    const xsp = n + "." + r + "." + t.toString(16);

    const subtitles = [];
    const tracksMatch = fpHtml.match(/tracks:\s*(\[[^\]]+\])/i);
    if (tracksMatch) {
      try {
        const rawTracks = JSON.parse(tracksMatch[1]);
        for (const tr of rawTracks) {
          if (tr.file && (tr.kind === "captions" || tr.kind === "subtitles")) {
            subtitles.push({
              label: tr.label || "Türkçe",
              url: tr.file,
              lang: tr.lang || "tr"
            });
          }
        }
      } catch (e) {}
    }

    const fullManifest = "https://fastplay.mom" + streamPath;
    const playUrl = fullManifest.includes("#") ? fullManifest : (fullManifest + "#.m3u8");

    const headers = {
      "Referer": "https://fastplay.mom/",
      "User-Agent": UA,
      "X-Sp": xsp
    };

    return [{
      name: "HDFilmCehennemi",
      title: "HDFilmCehennemi - 1080p Dual [TR Dublaj & Orijinal]",
      url: playUrl,
      quality: "1080p",
      format: "hls",
      isHls: true,
      contentLanguage: ["tr", "en"],
      headers: headers,
      behaviorHints: {
        headers: headers
      },
      subtitles: subtitles
    }];
  } catch (err) {
    return [];
  }
}

async function getStreams(tmdbIdOrArgs, mediaType, seasonNum, episodeNum) {
  try {
    let rawId = tmdbIdOrArgs;
    let sNum = seasonNum || 1;
    let eNum = episodeNum || 1;
    let mType = mediaType || "movie";

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

    const isTv = mType === "tv" || mType === "series";
    const tmdb = await resolveTmdbInfo(rawId, mType);

    const candidates = [tmdb.imdbId, tmdb.title, tmdb.origTitle].filter(Boolean);
    if (candidates.length === 0 && rawId) candidates.push(rawId);

    let matchedItem = null;
    for (const q of candidates) {
      const results = await searchHDF(q, isTv);
      if (results && results.length > 0) {
        matchedItem = results[0];
        break;
      }
    }

    if (!matchedItem) return [];

    let targetPage = matchedItem.url;
    if (isTv) {
      // Find episode on series page
      const sRes = await fetchWithTimeout(matchedItem.url, { headers: { "User-Agent": UA } });
      if (sRes.ok) {
        const sHtml = await sRes.text();
        const epMatch = sHtml.match(new RegExp(`href=["\x27]([^"\x27]+)["\x27][^>]*>\\s*${sNum}\\.\\s*Sezon\\s*${eNum}\\.\\s*B[oö]l[uü]m`, "i"));
        if (epMatch) targetPage = epMatch[1];
      }
    }

    return await extractFastPlayStream(targetPage);
  } catch (e) {
    return [];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
