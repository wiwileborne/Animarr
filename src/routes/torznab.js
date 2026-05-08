const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const db = require('../database/db');
const config = require('../config');
const cleaner = require('../services/cleaner');
const { getAlternateTitles, getTitleById, getTitlesFromIds } = require('../services/apiFetcher');

const router = express.Router();

// Helper to log requests to DB
function logRequest(original, cleaned, resolved, action, code) {
    try {
        const stmt = db.prepare('INSERT INTO Logs (original_query, cleaned_query, resolved_titles, action_taken, prowlarr_response_code) VALUES (?, ?, ?, ?, ?)');
        stmt.run(original, cleaned, JSON.stringify(resolved), action, code);

        // Limit to 2000 entries and max 7 days old
        db.prepare('DELETE FROM Logs WHERE id NOT IN (SELECT id FROM Logs ORDER BY id DESC LIMIT 2000)').run();
        db.prepare('DELETE FROM Logs WHERE timestamp < datetime("now", "-7 days")').run();
    } catch (e) {
        console.error('Failed to log request:', e);
    }
}

// Intercept all requests to /api
router.get('/', async (req, res) => {
    let originalQuery = req.query.q;
    const conf = config.getConfig();
    const prowlarrBaseUrl = conf.PROWLARR_URL.replace(/\/$/, '');

    // Detect Requester Type (Sonarr vs Radarr)
    const userAgent = req.headers['user-agent'] || '';
    let requesterType = 'both';
    if (userAgent.toLowerCase().includes('sonarr')) requesterType = 'sonarr';
    else if (userAgent.toLowerCase().includes('radarr')) requesterType = 'radarr';

    // Collect IDs from request params
    const tvdbid = req.query.tvdbid;
    const imdbid = req.query.imdbid;
    const tmdbid = req.query.tmdbid;
    const hasIds = !!(tvdbid || imdbid || tmdbid);

    // If no search query but we have IDs, translate ID to title first
    if (!originalQuery && hasIds) {
        const translatedTitle = await getTitleById(tvdbid, imdbid);
        if (translatedTitle) {
            originalQuery = translatedTitle;
            delete req.query.tvdbid;
            delete req.query.imdbid;
            delete req.query.tmdbid;
            req.query.t = 'search';
        }
    }

    // If still no search query, just proxy directly
    if (!originalQuery) {
        try {
            const proxyParams = { ...req.query };
            if (conf.PROWLARR_API_KEY) {
                proxyParams.apikey = conf.PROWLARR_API_KEY;
            }
            
            // Smart URL handling: pass through the dynamic indexer path
            let fullUrl = prowlarrBaseUrl.replace(/\/$/, '');
            const requestPath = req.baseUrl; // e.g. '/api' or '/1/api' or '/prowlarr/1/api'
            
            if (requestPath && requestPath !== '/api' && requestPath !== '') {
                // If Radarr asked for /2/api, we append it
                // Make sure we don't duplicate slashes
                fullUrl += requestPath.startsWith('/') ? requestPath : '/' + requestPath;
            } else {
                if (!fullUrl.endsWith('/api')) {
                    fullUrl += '/api';
                }
            }

            
            console.log(`[Proxy] Proxying to: ${fullUrl} (t=${req.query.t})`);
            
            const response = await axios.get(fullUrl, { 
                params: proxyParams, 
                responseType: 'stream',
                headers: {
                    'Accept': 'text/xml, application/xml, */*'
                },
                maxRedirects: 0,
                validateStatus: null 
            });
            
            if (response.status >= 300 && response.status < 400) {
                console.warn(`[Proxy] Prowlarr redirect detected: ${response.headers.location}`);
            }

            res.status(response.status);
            response.headers['content-type'] && res.set('Content-Type', response.headers['content-type']);
            return response.data.pipe(res);
        } catch (error) {
            console.error('[Proxy] Prowlarr proxy error:', error.message);
            const status = error.response?.status || 500;
            return res.status(status).send(`Error proxying to Prowlarr (${status}): ${error.message}`);
        }
    }

    // Check XML Response Cache (10 minutes)
    const xmlCacheKey = `xml_${JSON.stringify(req.query)}_${requesterType}`;
    try {
        const cachedXml = db.prepare('SELECT value FROM PersistentCache WHERE key = ? AND expires_at > CURRENT_TIMESTAMP').get(xmlCacheKey);
        if (cachedXml) {
            res.set('Content-Type', 'text/xml');
            return res.send(cachedXml.value);
        }
    } catch(e) {}

    let cleanedQuery = cleaner.cleanQuery(originalQuery, requesterType);
    let resolvedTitles = [{ title: cleanedQuery, source: 'original query' }];
    let actionTaken = 'cleaned';

    // 0. Enrich with ID-based lookups (precise TMDB alternative titles)
    if (hasIds) {
        try {
            const idTitles = await getTitlesFromIds({ tvdbid, imdbid, tmdbid });
            if (idTitles.length > 0) {
                resolvedTitles.push(...idTitles);
                actionTaken = 'id_enriched';
            }
        } catch (e) {
            console.error('ID enrichment failed:', e.message);
        }
    }

    // 1. Fetch from Dictionary (check original_title or inside alternate_titles JSON array)
    let hasDict = false;
    let dictEntry = db.prepare(`
        SELECT id, original_title, alternate_titles, source 
        FROM Dictionary 
        WHERE original_title = ? COLLATE NOCASE 
           OR EXISTS (SELECT 1 FROM json_each(alternate_titles) WHERE value = ? COLLATE NOCASE)
        LIMIT 1
    `).get(cleanedQuery, cleanedQuery);

    if (dictEntry) {
        try {
            const parsed = JSON.parse(dictEntry.alternate_titles);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const sourceName = dictEntry.source === 'manual' ? 'custom dictionary' : 'auto-api (cached)';
                resolvedTitles.push(...parsed.map(t => ({ title: t, source: sourceName })));
                hasDict = true;
                actionTaken = dictEntry.source === 'manual' ? 'dictionary_match' : 'auto-api_cached';
            }
        } catch(e) {}
    }

    // 2. Fetch from APIs if needed
    if (!dictEntry || dictEntry.source === 'manual') {
        const apiTitles = await getAlternateTitles(cleanedQuery);
        if (apiTitles.length > 0) {
            resolvedTitles.push(...apiTitles);
            actionTaken = hasDict ? 'api_and_dict' : 'api_enriched';

            if (!dictEntry) {
                try {
                    // Check if the API IDs match an EXISTING dictionary entry
                    const tmdbId = apiTitles[0].ids?.tmdbId ? String(apiTitles[0].ids.tmdbId) : null;
                    const anilistId = apiTitles[0].ids?.anilistId ? String(apiTitles[0].ids.anilistId) : null;
                    const malId = apiTitles[0].ids?.malId ? String(apiTitles[0].ids.malId) : null;

                    let existingEntry = null;
                    if (tmdbId || anilistId || malId) {
                        existingEntry = db.prepare(`
                            SELECT id, alternate_titles FROM Dictionary 
                            WHERE (tmdb_id = ? AND ? IS NOT NULL)
                               OR (anilist_id = ? AND ? IS NOT NULL)
                               OR (mal_id = ? AND ? IS NOT NULL)
                            LIMIT 1
                        `).get(tmdbId, tmdbId, anilistId, anilistId, malId, malId);
                    }

                    const extractedTitles = apiTitles.map(t => t.title);
                    if (!extractedTitles.includes(cleanedQuery)) {
                        extractedTitles.push(cleanedQuery);
                    }

                    if (existingEntry) {
                        // Merge with existing entry to avoid duplicates
                        let currentAlts = [];
                        try { currentAlts = JSON.parse(existingEntry.alternate_titles) || []; } catch(e){}
                        const mergedAlts = Array.from(new Set([...currentAlts, ...extractedTitles]));
                        db.prepare('UPDATE Dictionary SET alternate_titles = ? WHERE id = ?').run(JSON.stringify(mergedAlts), existingEntry.id);
                    } else {
                        // Pick the best English/Romaji title as original_title if possible
                        const newOriginalTitle = apiTitles[0].title || cleanedQuery;
                        db.prepare(`
                            INSERT INTO Dictionary 
                            (original_title, alternate_titles, source, tmdb_id, mal_id, anilist_id, imdb_id, tvdb_id, is_anime) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            newOriginalTitle, 
                            JSON.stringify(extractedTitles), 
                            'auto-api',
                            tmdbId,
                            malId,
                            anilistId,
                            apiTitles[0].ids?.imdbId ? String(apiTitles[0].ids.imdbId) : null,
                            apiTitles[0].ids?.tvdbId ? String(apiTitles[0].ids.tvdbId) : null,
                            apiTitles[0].is_anime ? 1 : 0
                        );
                    }
                } catch(e) {
                    console.error('Failed to auto-cache in Dictionary:', e);
                }
            }
        }
    }

    // 3. Deduplicate
    const uniqueMap = new Map();
    resolvedTitles.forEach(item => {
        const key = item.title.toLowerCase();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, { ...item });
        } else {
            const existing = uniqueMap.get(key);
            if (!existing.source.includes(item.source)) {
                existing.source += `, ${item.source}`;
            }
        }
    });

    resolvedTitles = Array.from(uniqueMap.values()).slice(0, 4);

    // 4. Query Prowlarr
    try {
        const fetchPromises = resolvedTitles.map(async (item) => {
            const params = { ...req.query, q: item.title };
            try {
                let searchUrl = prowlarrBaseUrl.replace(/\/$/, '');
                const requestPath = req.baseUrl;
                if (requestPath && requestPath !== '/api' && requestPath !== '') {
                    searchUrl += requestPath.startsWith('/') ? requestPath : '/' + requestPath;
                } else {
                    if (!searchUrl.endsWith('/api')) searchUrl += '/api';
                }
                const response = await axios.get(searchUrl, { params, timeout: 15000 });
                return response.data;
            } catch (err) {
                console.error(`Prowlarr error for query '${item.title}':`, err.message);
                return null;
            }
        });

        const xmlResults = await Promise.all(fetchPromises);
        const validXmls = xmlResults.filter(xml => xml != null);

        if (validXmls.length === 0) {
            logRequest(originalQuery, cleanedQuery, resolvedTitles, 'failed_all_prowlarr_requests', 500);
            return res.status(500).send('All Prowlarr requests failed');
        }

        if (validXmls.length === 1 && !db.prepare('SELECT 1 FROM OutputRegexRules WHERE is_active = 1').get()) {
            logRequest(originalQuery, cleanedQuery, resolvedTitles, actionTaken, 200);
            res.set('Content-Type', 'text/xml');
            return res.send(validXmls[0]);
        }

        // Merge & Apply Output Rules
        const parser = new xml2js.Parser();
        const builder = new xml2js.Builder();
        let baseObj = null;
        const allItems = [];

        for (const xml of validXmls) {
            try {
                const parsed = await parser.parseStringPromise(xml);
                if (!baseObj) baseObj = parsed;
                const items = parsed?.rss?.channel?.[0]?.item || [];
                allItems.push(...items);
            } catch (e) {}
        }

        if (baseObj && baseObj.rss && baseObj.rss.channel && baseObj.rss.channel[0]) {
            const uniqueItems = [];
            const seenIds = new Set();
            for (const item of allItems) {
                const id = item.guid?.[0]?._ || item.guid?.[0] || item.link?.[0];
                if (id && !seenIds.has(id)) {
                    seenIds.add(id);
                    uniqueItems.push(item);
                } else if (!id) uniqueItems.push(item);
            }

            // Apply Output Rules with requesterType
            for (const item of uniqueItems) {
                if (item.title && item.title[0]) {
                    item.title[0] = cleaner.applyOutputRules(item.title[0], requesterType);
                }
            }
            baseObj.rss.channel[0].item = uniqueItems;
        }

        const mergedXml = builder.buildObject(baseObj);
        try {
            const tenMins = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            db.prepare('INSERT OR REPLACE INTO PersistentCache (key, value, expires_at) VALUES (?, ?, ?)').run(xmlCacheKey, mergedXml, tenMins);
        } catch(e) {}

        logRequest(originalQuery, cleanedQuery, resolvedTitles, actionTaken + '_merged', 200);
        res.set('Content-Type', 'text/xml');
        return res.send(mergedXml);

    } catch (error) {
        logRequest(originalQuery, cleanedQuery, resolvedTitles, 'error', 500);
        return res.status(500).send('Internal Proxy Error');
    }
});

module.exports = router;
