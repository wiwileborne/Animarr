const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create data directory if it doesn't exist (when packaged with pkg, we need a local folder)
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'animarr.sqlite'));
db.pragma('journal_mode = WAL');

// Init Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS Config (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS Dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_title TEXT UNIQUE NOT NULL,
        alternate_titles TEXT NOT NULL, -- JSON array of titles
        source TEXT DEFAULT 'manual', -- 'manual', 'anilist', 'tmdb', etc.
        tmdb_id TEXT,
        mal_id TEXT,
        anilist_id TEXT,
        imdb_id TEXT,
        tvdb_id TEXT,
        is_anime BOOLEAN,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS RegexRules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        replacement TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        description TEXT,
        applies_to TEXT DEFAULT 'both' -- 'both', 'sonarr', 'radarr'
    );

    CREATE TABLE IF NOT EXISTS OutputRegexRules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        replacement TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        description TEXT,
        applies_to TEXT DEFAULT 'both' -- 'both', 'sonarr', 'radarr'
    );

    CREATE TABLE IF NOT EXISTS PersistentCache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        original_query TEXT,
        cleaned_query TEXT,
        resolved_titles TEXT, -- JSON array
        action_taken TEXT,
        prowlarr_response_code INTEGER
    );
`);

// Insert default regex rules if the table is empty
const regexCount = db.prepare('SELECT COUNT(*) as count FROM RegexRules').get();
if (regexCount.count === 0) {
    const insertRegex = db.prepare('INSERT INTO RegexRules (pattern, replacement, description) VALUES (?, ?, ?)');
    insertRegex.run('(The Movie|Movie|The|\\d{4})', '', 'Remove "The Movie" and Years');
    insertRegex.run('([^a-zA-Z0-9 ]+)', ' ', 'Remove special characters');
    insertRegex.run('s\\d+e\\d+', '', 'Remove season/episode identifiers for general search');
}

module.exports = db;
