require('dotenv').config();
const db = require('./database/db');

function getConfig() {
    // Default configs from .env
    const defaults = {
        PORT: process.env.PORT || 5000,
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
        PROWLARR_URL: process.env.PROWLARR_URL || 'http://localhost:9696',
        PROWLARR_API_KEY: process.env.PROWLARR_API_KEY || '',
        ENABLE_ANILIST: 'true',
        ENABLE_MAL: 'true',
        ENABLE_TMDB: 'true',
        ENABLE_IMDB: 'true',
        TMDB_API_KEY: process.env.TMDB_API_KEY || '',
        IMDB_API_KEY: process.env.IMDB_API_KEY || ''
    };

    try {
        const rows = db.prepare('SELECT key, value FROM Config').all();
        const dbConfig = {};
        rows.forEach(row => {
            dbConfig[row.key] = row.value;
        });

        // Merge defaults with db config
        return { ...defaults, ...dbConfig };
    } catch (e) {
        // If DB isn't fully initialized yet
        return defaults;
    }
}

function updateConfig(newConfig) {
    const updateStmt = db.prepare('INSERT OR REPLACE INTO Config (key, value) VALUES (?, ?)');
    const transaction = db.transaction((configObj) => {
        for (const [key, value] of Object.entries(configObj)) {
            updateStmt.run(key, String(value));
        }
    });
    transaction(newConfig);
}

// Ensure defaults exist in DB
try {
    const currentConfig = getConfig();
    const insertStmt = db.prepare('INSERT OR IGNORE INTO Config (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(currentConfig)) {
        insertStmt.run(key, String(value));
    }
} catch(e) {}

module.exports = {
    getConfig,
    updateConfig
};
