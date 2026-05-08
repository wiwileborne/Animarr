const axios = require('axios');
const Bottleneck = require('bottleneck');
const config = require('../config');
const db = require('../database/db');
const regexCleaner = require('./cleaner');

// Rate Limiters to prevent IP bans
const jikanLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 1050 }); // Jikan allows 3/sec, 60/min. 1050ms ensures < 60/min.
const tmdbLimiter = new Bottleneck({ maxConcurrent: 3, minTime: 333 }); // TMDB allows 50/sec
const anilistLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 2100 }); // AniList degraded to 30/min (1 every 2s)
const omdbLimiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });

// Allowed TMDB alternative title languages (iso_3166_1 codes)
const ALLOWED_LANGS = new Set(['US', 'GB', 'FR', 'JP']);

async function searchAniList(query) {
    const conf = config.getConfig();
    if (conf.ENABLE_ANILIST !== 'true') return [];

    const anilistQuery = `
        query ($search: String) {
            Page (perPage: 3) {
                media (search: $search, type: ANIME) {
                    id
                    idMal
                    title {
                        romaji
                        english
                        native
                    }
                    synonyms
                }
            }
        }
    `;

    try {
        const response = await anilistLimiter.schedule(() => axios.post('https://graphql.anilist.co', {
            query: anilistQuery,
            variables: { search: query }
        }, { timeout: 8000 }));

        const mediaList = response.data?.data?.Page?.media || [];
        const allResults = [];

        mediaList.forEach((media, resultIndex) => {
            const addT = (t, p) => { if (t) allResults.push({ title: t, source: 'AniList', ids: { anilistId: media.id, malId: media.idMal }, resultIndex, langPriority: p }); };
            if (media.title.english) addT(media.title.english, 1);
            if (media.title.romaji) addT(media.title.romaji, 4);
            if (media.title.native) addT(media.title.native, 3);
            if (media.synonyms) media.synonyms.forEach(s => addT(s, 4));
        });
        return allResults;
    } catch (e) {
        // console.error('AniList API error:', e.message);
    }
    return [];
}

async function searchMAL(query) {
    const conf = config.getConfig();
    if (conf.ENABLE_MAL !== 'true') return [];
    try {
        const response = await jikanLimiter.schedule(() => axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=3`, { timeout: 8000 }));
        const animeList = response.data?.data || [];
        const allResults = [];

        animeList.forEach((anime, resultIndex) => {
            const addT = (t, p) => { if (t) allResults.push({ title: t, source: 'MyAnimeList', ids: { malId: anime.mal_id }, resultIndex, langPriority: p }); };
            if (anime.title_english) addT(anime.title_english, 1);
            if (anime.title_japanese) addT(anime.title_japanese, 3);
            if (anime.title) addT(anime.title, 4);
        });
        return allResults;
    } catch (e) {
        // console.error('MAL (Jikan) API error:', e.message);
    }
    return [];
}

async function searchTMDB(query) {
    const conf = config.getConfig();
    if (conf.ENABLE_TMDB !== 'true' || !conf.TMDB_API_KEY) return [];
    try {
        const response = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${conf.TMDB_API_KEY}&query=${encodeURIComponent(query)}`, { timeout: 8000 }));
        const results = response.data?.results || [];
        const allResults = [];

        const topResults = results.slice(0, 10);
        for (let i = 0; i < topResults.length; i++) {
            const item = topResults[i];
            const resultIndex = i;
            const titlesMap = new Map();
            const addT = (t, p) => {
                if (!t) return;
                const key = t.trim();
                if (!titlesMap.has(key) || titlesMap.get(key) > p) {
                    titlesMap.set(key, p);
                }
            };
            
            if (item.name) addT(item.name, 4);
            if (item.title) addT(item.title, 4);
            if (item.original_name) addT(item.original_name, 4);
            if (item.original_title) addT(item.original_title, 4);
            
            const mediaType = item.media_type === 'movie' ? 'movie' : (item.media_type === 'tv' ? 'tv' : null);
            const sourcePrefix = item.media_type === 'movie' ? 'TMDB Movie' : (item.media_type === 'tv' ? 'TMDB TV' : 'TMDB');
            const ids = { tmdbId: item.id };

            // Fetch alternative titles and external IDs for top results to improve matching
            if (mediaType && item.id) {
                try {
                    const detailsRes = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/${mediaType}/${item.id}?api_key=${conf.TMDB_API_KEY}&append_to_response=alternative_titles,external_ids`, { timeout: 5000 }));
                    
                    const altList = detailsRes.data?.alternative_titles?.results || detailsRes.data?.alternative_titles?.titles || [];
                    altList.forEach(alt => {
                        if (alt.title && ALLOWED_LANGS.has(alt.iso_3166_1)) {
                            let p = 4;
                            if (alt.iso_3166_1 === 'US' || alt.iso_3166_1 === 'GB') p = 1;
                            else if (alt.iso_3166_1 === 'FR') p = 2;
                            else if (alt.iso_3166_1 === 'JP') p = 3;
                            addT(alt.title, p);
                        }
                    });

                    const ext = detailsRes.data?.external_ids || {};
                    if (ext.imdb_id) ids.imdbId = ext.imdb_id;
                    if (ext.tvdb_id) ids.tvdbId = ext.tvdb_id;
                } catch (e) { }
            }

            titlesMap.forEach((p, t) => {
                allResults.push({ title: t, source: sourcePrefix, ids, resultIndex, langPriority: p });
            });
        }
        return allResults;
    } catch (e) {
        console.error('TMDB API error:', e.message);
    }
    return [];
}

async function searchIMDB(query) {
    const conf = config.getConfig();
    if (conf.ENABLE_IMDB !== 'true' || !conf.IMDB_API_KEY) return [];
    try {
        const response = await omdbLimiter.schedule(() => axios.get(`http://www.omdbapi.com/?apikey=${conf.IMDB_API_KEY}&s=${encodeURIComponent(query)}`, { timeout: 8000 }));
        const results = response.data?.Search || [];
        const allResults = [];

        results.slice(0, 10).forEach((item, resultIndex) => {
            if (item.Title) {
                const ids = { imdbId: item.imdbID };
                allResults.push({ title: item.Title, source: 'IMDB', ids, resultIndex, langPriority: 4 });
            }
        });
        return allResults;
    } catch (e) {
        console.error('IMDB/OMDB API error:', e.message);
    }
    return [];
}

async function getAlternateTitles(query, bypassCache = false, target = 'both') {
    const cleaned = regexCleaner.cleanQuery(query, target);
    const cacheKey = `titles_v8_${cleaned.toLowerCase()}`;

    if (!bypassCache) {
        try {
            const cached = db.prepare('SELECT value FROM PersistentCache WHERE key = ? AND expires_at > CURRENT_TIMESTAMP').get(cacheKey);
            if (cached) return JSON.parse(cached.value);
        } catch (e) { }
    }

    // Run APIs in parallel with cleaned query
    const results = await Promise.all([
        searchAniList(cleaned),
        searchMAL(cleaned),
        searchTMDB(cleaned),
        searchIMDB(cleaned)
    ]);

    // Fallback: search with original query if different (to maximize correspondence)
    let extraResults = [];
    if (query && query !== cleaned) {
        const extra = await Promise.all([
            searchAniList(query),
            searchMAL(query),
            searchTMDB(query),
            searchIMDB(query)
        ]);
        extraResults = extra.flat();
    }

    const allItems = [...results.flat(), ...extraResults];
    const titleMap = new Map(); // titleKey -> { title, sources, ids, isTopResult, langPriority }

    allItems.forEach(item => {
        if (!item || !item.title) return;
        const key = item.title.toLowerCase().trim();
        const lp = item.langPriority || 4;
        if (!titleMap.has(key)) {
            titleMap.set(key, {
                title: item.title,
                sources: new Set([item.source]),
                ids: { ...item.ids },
                isTopResult: item.resultIndex === 0,
                langPriority: lp
            });
        } else {
            const entry = titleMap.get(key);
            entry.sources.add(item.source);
            entry.ids = { ...entry.ids, ...item.ids };
            if (item.resultIndex === 0) entry.isTopResult = true;
            if (lp < entry.langPriority) entry.langPriority = lp;
        }
    });

    const titleEntries = Array.from(titleMap.values());
    const entities = [];
    const visited = new Set();

    // Grouping by IDs
    for (let i = 0; i < titleEntries.length; i++) {
        if (visited.has(i)) continue;
        const group = [titleEntries[i]];
        visited.add(i);
        let added = true;
        while (added) {
            added = false;
            for (let j = 0; j < titleEntries.length; j++) {
                if (visited.has(j)) continue;
                const other = titleEntries[j];
                const sharesId = group.some(item => 
                    (item.ids.tmdbId && item.ids.tmdbId === other.ids.tmdbId) ||
                    (item.ids.malId && item.ids.malId === other.ids.malId) ||
                    (item.ids.imdbId && item.ids.imdbId === other.ids.imdbId) ||
                    (item.ids.anilistId && item.ids.anilistId === other.ids.anilistId)
                );
                if (sharesId) {
                    group.push(other);
                    visited.add(j);
                    added = true;
                }
            }
        }
        entities.push(group);
    }

    const finalResults = [];
    const isAnimeSource = (s) => ['AniList', 'MyAnimeList'].includes(s);

    entities.forEach(group => {
        const allSources = new Set();
        const mergedIds = {};
        const uniqueTitles = new Set();
        let isTopResult = false;
        
        group.forEach(item => {
            item.sources.forEach(s => allSources.add(s));
            Object.assign(mergedIds, item.ids);
            uniqueTitles.add(item.title);
            if (item.isTopResult) isTopResult = true;
        });

        const sourceList = Array.from(allSources);
        const hasAnimeSource = sourceList.some(isAnimeSource);
        const isEntityAnime = hasAnimeSource;

        // Determine best lang priority for the entity to pass it on
        let bestLang = 4;
        group.forEach(item => {
            if (item.langPriority < bestLang) bestLang = item.langPriority;
        });

        if (isEntityAnime) {
            // Anime must have at least 2 sources across the whole entity
            if (sourceList.length >= 2) {
                Array.from(uniqueTitles).forEach(t => {
                    const others = Array.from(uniqueTitles).filter(ot => ot !== t);
                    const tItem = group.find(i => i.title === t);
                    finalResults.push({
                        title: t,
                        alternate_titles: others,
                        source: sourceList.join(', '),
                        sourceCount: sourceList.length,
                        ids: mergedIds,
                        is_anime: true,
                        langPriority: tItem ? tItem.langPriority : bestLang
                    });
                });
            }
        } else {
            // Non-anime: keep all titles of the entity if it's a top result entity
            if (isTopResult) {
                Array.from(uniqueTitles).forEach(t => {
                    const others = Array.from(uniqueTitles).filter(ot => ot !== t);
                    const tItem = group.find(i => i.title === t);
                    finalResults.push({
                        title: t,
                        alternate_titles: others,
                        source: sourceList.join(', '),
                        sourceCount: sourceList.length,
                        ids: mergedIds,
                        is_anime: false,
                        langPriority: tItem ? tItem.langPriority : bestLang
                    });
                });
            }
        }
    });

    // Sort by langPriority: 1 (EN) > 2 (FR) > 3 (JP) > 4 (Other), then source count
    finalResults.sort((a, b) => {
        if (a.langPriority !== b.langPriority) {
            return a.langPriority - b.langPriority;
        }
        return b.sourceCount - a.sourceCount;
    });

    if (finalResults.length > 0) {
        try {
            const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            db.prepare('INSERT OR REPLACE INTO PersistentCache (key, value, expires_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(finalResults), thirtyDaysFromNow);
        } catch (e) { }
    }
    return finalResults;
}

/**
 * Lookup titles by external IDs (tvdbid, imdbid, tmdbid).
 * STRICT FILTERING:
 * 1. If NO AniList/MAL correspondence found -> NOT ANIME -> Keep TMDB titles (EN, FR, JP).
 * 2. If AniList/MAL correspondence found -> ANIME -> Keep ONLY titles with AT LEAST 2 sources.
 */
async function getTitlesFromIds({ tvdbid, imdbid, tmdbid } = {}) {
    const conf = config.getConfig();
    if (!conf.TMDB_API_KEY) return [];

    const cacheKey = `ids_v4_${tvdbid || ''}_${imdbid || ''}_${tmdbid || ''}`;
    try {
        const cached = db.prepare('SELECT value FROM PersistentCache WHERE key = ? AND expires_at > CURRENT_TIMESTAMP').get(cacheKey);
        if (cached) return JSON.parse(cached.value);
    } catch (e) { }

    const titleSources = new Map(); // Map of Title -> { sources: Set, isFrench: boolean }
    let tmdbInternalId = null;
    let mediaType = null;

    const addTitle = (title, source, isFrench = false) => {
        if (!title || !title.trim()) return;
        const t = title.trim();
        if (!titleSources.has(t)) {
            titleSources.set(t, { sources: new Set([source]), isFrench });
        } else {
            const entry = titleSources.get(t);
            entry.sources.add(source);
            if (isFrench) entry.isFrench = true;
        }
    };

    try {
        // 1. Find via TMDB's /find endpoint using external IDs
        if (tvdbid) {
            const res = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/find/${tvdbid}?api_key=${conf.TMDB_API_KEY}&external_source=tvdb_id`, { timeout: 8000 }));
            const tvResult = res.data?.tv_results?.[0];
            if (tvResult) {
                addTitle(tvResult.name, 'TMDB (by ID)');
                addTitle(tvResult.original_name, 'TMDB (by ID)');
                tmdbInternalId = tvResult.id;
                mediaType = 'tv';
            }
        }

        if (!tmdbInternalId && imdbid) {
            const res = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/find/${imdbid}?api_key=${conf.TMDB_API_KEY}&external_source=imdb_id`, { timeout: 8000 }));
            const tvResult = res.data?.tv_results?.[0];
            const movieResult = res.data?.movie_results?.[0];
            if (tvResult) {
                addTitle(tvResult.name, 'TMDB (by ID)');
                addTitle(tvResult.original_name, 'TMDB (by ID)');
                tmdbInternalId = tvResult.id;
                mediaType = 'tv';
            } else if (movieResult) {
                addTitle(movieResult.title, 'TMDB (by ID)');
                addTitle(movieResult.original_title, 'TMDB (by ID)');
                tmdbInternalId = movieResult.id;
                mediaType = 'movie';
            }
        }

        if (!tmdbInternalId && tmdbid) {
            tmdbInternalId = tmdbid;
            try {
                const res = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/tv/${tmdbid}?api_key=${conf.TMDB_API_KEY}`, { timeout: 8000 }));
                if (res.data?.name) { addTitle(res.data.name, 'TMDB (by ID)'); mediaType = 'tv'; }
                if (res.data?.original_name) addTitle(res.data.original_name, 'TMDB (by ID)');
            } catch (e) {
                try {
                    const res = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/movie/${tmdbid}?api_key=${conf.TMDB_API_KEY}`, { timeout: 8000 }));
                    if (res.data?.title) { addTitle(res.data.title, 'TMDB (by ID)'); mediaType = 'movie'; }
                    if (res.data?.original_title) addTitle(res.data.original_title, 'TMDB (by ID)');
                } catch (e2) { }
            }
        }

        // 2. Fetch alternative titles — only keep EN, FR, and original
        if (tmdbInternalId && mediaType) {
            try {
                const altRes = await tmdbLimiter.schedule(() => axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbInternalId}/alternative_titles?api_key=${conf.TMDB_API_KEY}`, { timeout: 8000 }));
                const altTitles = altRes.data?.results || altRes.data?.titles || [];
                for (const alt of altTitles) {
                    if (alt.title && alt.title.trim() && ALLOWED_LANGS.has(alt.iso_3166_1)) {
                        addTitle(alt.title.trim(), 'TMDB (by ID)', alt.iso_3166_1 === 'FR');
                    }
                }
            } catch (e) { }
        }
    } catch (e) {
        console.error('ID Translation error:', e.message);
    }

    // Capture TMDB-only titles before anime enrichment
    const tmdbTitlesOnly = Array.from(titleSources.keys());

    // 3. Search AniList + MAL
    let foundAnimeMatch = false;
    let foundAnimeIds = {};
    const candidates = tmdbTitlesOnly.slice(0, 3);
    if (candidates.length > 0) {
        const searches = [];
        for (const name of candidates) {
            searches.push(searchAniList(name).catch(() => []));
            searches.push(searchMAL(name).catch(() => []));
        }
        const searchResults = await Promise.all(searches);
        searchResults.flat().forEach(item => {
            if (item.title) {
                addTitle(item.title, item.source);
                foundAnimeMatch = true;
                if (item.ids) {
                    foundAnimeIds = { ...foundAnimeIds, ...item.ids };
                }
            }
        });
    }
    const allIds = { tmdbId: tmdbInternalId, tvdbId: tvdbid, imdbId: imdbid, ...foundAnimeIds };
    const allUniqueTitles = Array.from(titleSources.keys());
    
    const results = Array.from(titleSources.entries())
        .map(([title, data]) => {
            const others = allUniqueTitles.filter(t => t !== title);
            return { 
                title, 
                alternate_titles: others,
                source: Array.from(data.sources).join(', '),
                sourceCount: data.sources.size,
                isFrench: data.isFrench,
                ids: allIds,
                is_anime: foundAnimeMatch
            };
        });

    let finalResults = [];
    if (!foundAnimeMatch) {
        // CASE: NOT ANIME -> Keep all TMDB titles
        finalResults = results;
    } else {
        // CASE: ANIME -> STRICT FILTER: Keep if 2+ sources OR is French title
        finalResults = results.filter(r => r.sourceCount >= 2 || r.isFrench);
    }

    // Sort by sourceCount descending (priority)
    finalResults.sort((a, b) => b.sourceCount - a.sourceCount);

    if (finalResults.length > 0) {
        try {
            const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            db.prepare('INSERT OR REPLACE INTO PersistentCache (key, value, expires_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(finalResults), thirtyDays);
        } catch (e) { }
    }

    return finalResults;
}

// Legacy wrapper for backward compat
async function getTitleById(tvdbid, imdbid) {
    const results = await getTitlesFromIds({ tvdbid, imdbid });
    return results.length > 0 ? results[0].title : null;
}

module.exports = {
    getAlternateTitles,
    getTitleById,
    getTitlesFromIds
};
