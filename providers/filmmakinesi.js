/**
 * Nuvio Provider: Film Makinesi
 * Author: ttuloglu
 * Supports: Movies & Series (1080p / 720p HLS + Subtitles)
 */

const TMDB_API_KEY = "500330721680edb6d5f7f12ba7cd9023";
const BASE_TO = "https://filmmakinesi.to";
const BASE_CO = "https://filmmakinesi.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
      }
    } else {
      title = cleanId;
    }
    return { title, origTitle };
  } catch (e) {
    return { title: String(id || ""), origTitle: "" };
  }
}

function unpackRapidPlayer(html) {
  try {
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    let targetScript = null;
    for (const s of scripts) {
      if (s.includes("eval(function(p,a,c,k,e,d)") && s.includes("sources: [{file:")) {
        targetScript = s.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
        break;
      }
    }
    if (!targetScript) return null;

    let capturedUrl = null;
    let capturedTracks = [];

    const mockEnv = `
      var atob = typeof atob !== 'undefined' ? atob : function(s) { return Buffer.from(s, 'base64').toString('binary'); };
      var btoa = typeof btoa !== 'undefined' ? btoa : function(s) { return Buffer.from(s, 'binary').toString('base64'); };
      var localStorage = {};
      var elem = { addEventListener: function(){}, querySelector: function(){ return null; }, removeClass: function(){ return elem; }, attr: function(){ return elem; }, append: function(){ return elem; }, on: function(){ return elem; } };
      var document = { addEventListener: function(){}, querySelector: function(){ return elem; }, getElementById: function(){ return elem; } };
      var window = { atob: atob, btoa: btoa, localStorage: localStorage, addEventListener: function(){} };
      var $ = function(){ return elem; };
      var player = {
        setup: function(cfg) {
          if (cfg && cfg.sources && cfg.sources[0] && cfg.sources[0].file) {
            capturedUrl = cfg.sources[0].file;
          }
          if (cfg && cfg.tracks) {
            capturedTracks = cfg.tracks;
          }
          return player;
        },
        on: function(){},
        once: function(){},
        getDuration: function(){ return 0; },
        seek: function(){}
      };
      var jwplayer = function(){ return player; };
    `;

    eval(mockEnv + "\n" + targetScript);

    return { streamUrl: capturedUrl, tracks: capturedTracks };
  } catch (err) {
    return null;
  }
}

async function extractStreamsFromPage(pageUrl) {
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": UA, "Referer": BASE_TO + "/" }
    });
    if (!res.ok) return [];
    const html = await res.text();

    const videoUrls = [];
    const dataMatches = html.match(/data-video_url=["\x27]([^"\x27]+)["\x27]/gi) || [];
    for (const m of dataMatches) {
      const u = m.replace(/data-video_url=["\x27]/i, "").replace(/["\x27]$/, "");
      if (u.includes("rapid") || u.includes("embed")) videoUrls.push(u);
    }

    const iframeMatches = html.match(/<iframe[^>]+src=["\x27]([^"\x27]+)["\x27]/gi) || [];
    for (const m of iframeMatches) {
      const u = m.replace(/<iframe[^>]+src=["\x27]/i, "").replace(/["\x27]$/, "");
      if (u.includes("rapid") || u.includes("embed")) videoUrls.push(u);
    }

    const streams = [];

    for (const vUrl of Array.from(new Set(videoUrls))) {
      const fullUrl = vUrl.startsWith("//") ? "https:" + vUrl : vUrl;
      if (!fullUrl.includes("rapid")) continue;

      const eRes = await fetchWithTimeout(fullUrl, {
        headers: { "User-Agent": UA, "Referer": BASE_TO + "/" }
      });
      if (!eRes.ok) continue;
      const eHtml = await eRes.text();

      const unpacked = unpackRapidPlayer(eHtml);
      if (unpacked && unpacked.streamUrl) {
        const streamUrl = unpacked.streamUrl;
        const subtitles = [];
        if (Array.isArray(unpacked.tracks)) {
          for (const tr of unpacked.tracks) {
            if (tr.file && (tr.kind === "captions" || tr.kind === "subtitles")) {
              const subUrl = tr.file.startsWith("http") ? tr.file : "https://rapid.filmmakinesi.to" + tr.file;
              subtitles.push({
                label: tr.label || tr.language || "Türkçe",
                url: subUrl,
                lang: tr.language || "tr"
              });
            }
          }
        }

        const isDual = eHtml.includes("Türkçe Dublaj") || eHtml.includes("Turkish2") || eHtml.includes("tr-TR");
        const titleBadge = isDual ? "[Dual: TR Dublaj + Altyazı]" : "[Türkçe Dublaj / Orijinal]";

        streams.push({
          name: "Film Makinesi",
          title: `Film Makinesi - 1080p ${titleBadge}`,
          url: streamUrl,
          quality: "1080p",
          format: "hls",
          isHls: true,
          contentLanguage: ["tr"],
          headers: {
            "Referer": "https://rapid.filmmakinesi.to/",
            "User-Agent": UA
          },
          behaviorHints: {
            headers: {
              "Referer": "https://rapid.filmmakinesi.to/",
              "User-Agent": UA
            }
          },
          subtitles: subtitles
        });
      }
    }

    return streams;
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

    const candidates = [tmdb.title, tmdb.origTitle].filter(Boolean);
    if (candidates.length === 0 && rawId) candidates.push(rawId);

    for (const q of candidates) {
      try {
        const searchUrl = `${BASE_TO}/arama/?s=` + encodeURIComponent(q);
        const res = await fetchWithTimeout(searchUrl, {
          headers: { "User-Agent": UA, "Referer": BASE_TO + "/" },
          cache: "no-store"
        }, 5000);
        if (res.ok) {
          const html = await res.text();
          const targetPrefix = isTv ? "/dizi/" : "/film/";
          const regex = new RegExp(`href=["\x27](${targetPrefix}[^"\x27]+)["\x27]`, "gi");
          let m;
          while ((m = regex.exec(html)) !== null) {
            let targetPage = m[1].startsWith("http") ? m[1] : BASE_TO + m[1];
            if (isTv) {
              targetPage = targetPage.replace(/\/+$/, "") + `/sezon-${sNum}/bolum-${eNum}/`;
            }
            const streams = await extractStreamsFromPage(targetPage);
            if (streams.length > 0) return streams;
          }
        }
      } catch (e) {}
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
