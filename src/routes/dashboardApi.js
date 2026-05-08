const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const config = require('../config');
const apiFetcher = require('../services/apiFetcher');
const regexCleaner = require('../services/cleaner');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'animarr-secret-key-change-me';

// Auth Middleware
function requireAuth(req, res, next) {
    const conf = config.getConfig();
    if (!conf.ADMIN_PASSWORD) {
        return next();
    }
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// Stats
router.get('/stats', async (req, res) => {
    try {
        const logsTotal = db.prepare('SELECT COUNT(*) as count FROM Logs').get().count;
        const cacheTotal = db.prepare('SELECT COUNT(*) as count FROM PersistentCache').get().count;
        const logs24h = db.prepare("SELECT COUNT(*) as count FROM Logs WHERE timestamp > datetime('now', '-24 hours')").get().count;
        
        res.json({
            logsTotal,
            cacheTotal,
            logs24h,
            successRate: 100 // Placeholder
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Logs
router.get('/logs', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const count = db.prepare('SELECT COUNT(*) as count FROM Logs').get().count;
    const logs = db.prepare('SELECT * FROM Logs ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);

    res.json({
        data: logs,
        pagination: {
            total: count,
            page,
            limit,
            pages: Math.ceil(count / limit)
        }
    });
});

// Run a manual test for Regex transformation
router.post('/test', (req, res) => {
    const { title, target } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const cleaned = regexCleaner.cleanQuery(title, target || 'both');
    const output = regexCleaner.applyOutputRules(cleaned, target || 'both');

    res.json({
        original: title,
        cleaned: cleaned,
        output: output
    });
});

// Run a manual search on metadata APIs
router.post('/search', async (req, res) => {
    const { query, target } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    try {
        const results = await apiFetcher.getAlternateTitles(query, true, target || 'both');
        const cleanedQuery = regexCleaner.cleanQuery(query, target || 'both');
        res.json({ 
            original: query,
            cleaned: cleanedQuery,
            results: results 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Run a manual search by external IDs
router.post('/search-by-id', async (req, res) => {
    const { tmdbid, imdbid, tvdbid } = req.body;
    if (!tmdbid && !imdbid && !tvdbid) return res.status(400).json({ error: 'At least one ID required' });

    try {
        const results = await apiFetcher.getTitlesFromIds({ tmdbid, imdbid, tvdbid });
        res.json({
            ids: { tmdbid: tmdbid || null, imdbid: imdbid || null, tvdbid: tvdbid || null },
            results: results
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Dictionary
router.get('/dictionary', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const limit = 10;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM Dictionary';
    let countQuery = 'SELECT COUNT(*) as count FROM Dictionary';
    const params = [];

    if (search) {
        query += ' WHERE original_title LIKE ? OR alternate_titles LIKE ?';
        countQuery += ' WHERE original_title LIKE ? OR alternate_titles LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const finalParams = [...params, limit, offset];

    const rows = db.prepare(query).all(...finalParams);
    const totalCount = db.prepare(countQuery).get(...params).count;

    res.json({ 
        results: rows, 
        total: totalCount, 
        page, 
        totalPages: Math.ceil(totalCount / limit) 
    });
});

router.post('/dictionary', (req, res) => {
    const { original_title, alternate_titles, tmdb_id, mal_id, anilist_id, imdb_id, tvdb_id, is_anime } = req.body;
    try {
        const parsed = JSON.parse(alternate_titles);
        db.prepare(`
            INSERT OR REPLACE INTO Dictionary 
            (original_title, alternate_titles, source, tmdb_id, mal_id, anilist_id, imdb_id, tvdb_id, is_anime) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            original_title, JSON.stringify(parsed), 'manual', 
            tmdb_id || null, mal_id || null, anilist_id || null, 
            imdb_id || null, tvdb_id || null, is_anime ? 1 : 0
        );
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Invalid data: ' + e.message });
    }
});

router.put('/dictionary/:id', (req, res) => {
    const { original_title, alternate_titles, tmdb_id, mal_id, anilist_id, imdb_id, tvdb_id, is_anime } = req.body;
    try {
        const parsed = JSON.parse(alternate_titles);
        db.prepare(`
            UPDATE Dictionary 
            SET original_title = ?, alternate_titles = ?, tmdb_id = ?, mal_id = ?, anilist_id = ?, imdb_id = ?, tvdb_id = ?, is_anime = ? 
            WHERE id = ?
        `).run(
            original_title, JSON.stringify(parsed), 
            tmdb_id || null, mal_id || null, anilist_id || null, 
            imdb_id || null, tvdb_id || null, is_anime ? 1 : 0, 
            req.params.id
        );
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Invalid data' });
    }
});

router.delete('/dictionary/:id', (req, res) => {
    db.prepare('DELETE FROM Dictionary WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Regex Rules
router.get('/regex', (req, res) => {
    const rules = db.prepare('SELECT * FROM RegexRules ORDER BY id DESC').all();
    res.json(rules);
});

router.post('/regex', (req, res) => {
    const { pattern, replacement, description, is_active, applies_to } = req.body;
    try {
        db.prepare('INSERT INTO RegexRules (pattern, replacement, description, is_active, applies_to) VALUES (?, ?, ?, ?, ?)').run(
            pattern, replacement || '', description || '', is_active ? 1 : 0, applies_to || 'both'
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/regex/:id', (req, res) => {
    const { pattern, replacement, description, is_active, applies_to } = req.body;
    try {
        db.prepare('UPDATE RegexRules SET pattern = ?, replacement = ?, description = ?, is_active = ?, applies_to = ? WHERE id = ?').run(
            pattern, replacement || '', description || '', is_active ? 1 : 0, applies_to || 'both', req.params.id
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/regex/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM RegexRules WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Output Regex Rules
router.get('/outputregex', (req, res) => {
    const rules = db.prepare('SELECT * FROM OutputRegexRules ORDER BY id DESC').all();
    res.json(rules);
});

router.post('/outputregex', (req, res) => {
    const { pattern, replacement, description, is_active, applies_to } = req.body;
    try {
        db.prepare('INSERT INTO OutputRegexRules (pattern, replacement, description, is_active, applies_to) VALUES (?, ?, ?, ?, ?)').run(
            pattern, replacement || '', description || '', is_active ? 1 : 0, applies_to || 'both'
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/outputregex/:id', (req, res) => {
    const { pattern, replacement, description, is_active, applies_to } = req.body;
    try {
        db.prepare('UPDATE OutputRegexRules SET pattern = ?, replacement = ?, description = ?, is_active = ?, applies_to = ? WHERE id = ?').run(
            pattern, replacement || '', description || '', is_active ? 1 : 0, applies_to || 'both', req.params.id
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/outputregex/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM OutputRegexRules WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Config
router.get('/config', (req, res) => {
    res.json(config.getConfig());
});

router.post('/config', (req, res) => {
    try {
        config.updateConfig(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/test-prowlarr', async (req, res) => {
    const { url, apiKey } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let baseUrl = url.replace(/\/$/, '');
    
    try {
        const axios = require('axios');
        // Test using Prowlarr's native v1 API instead of Torznab endpoints
        // since Torznab endpoints require a specific indexer ID to work properly.
        const testUrl = `${baseUrl}/api/v1/system/status`;
        console.log('[Test] Testing Prowlarr URL:', testUrl);
        
        const headers = { 'Accept': 'application/json' };
        if (apiKey) {
            headers['X-Api-Key'] = apiKey;
        }

        const response = await axios.get(testUrl, { 
            timeout: 10000,
            headers: headers
        });
        
        if (response.status === 200) {
            res.json({ success: true, message: 'Successfully connected to Prowlarr!' });
        } else {
            res.status(response.status).json({ error: `Prowlarr returned status ${response.status}` });
        }
    } catch (e) {
        console.error('Prowlarr test connection failed:', e.message);
        res.status(500).json({ error: 'Connection failed: ' + (e.response?.data?.message || e.message) });
    }
});

// Auth
router.get('/auth/status', (req, res) => {
    const conf = config.getConfig();
    res.json({ authRequired: !!conf.ADMIN_PASSWORD });
});

router.post('/auth/login', (req, res) => {
    const { password } = req.body;
    const conf = config.getConfig();
    if (password === conf.ADMIN_PASSWORD) {
        const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, secure: false });
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

router.post('/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.delete('/cache', (req, res) => {
    try {
        db.prepare('DELETE FROM PersistentCache').run();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/logs', (req, res) => {
    try {
        db.prepare('DELETE FROM Logs').run();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
