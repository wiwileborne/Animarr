const db = require('../database/db');

/**
 * Clean the query based on Regex rules
 * @param {string} query 
 * @param {string} requesterType 'sonarr', 'radarr', or 'both'
 */
function cleanQuery(query, requesterType = 'both') {
    if (!query) return query;

    let cleaned = query;
    // Get active regex rules filtered by target
    try {
        const rules = db.prepare(`
            SELECT pattern, replacement 
            FROM RegexRules 
            WHERE is_active = 1 
            AND (applies_to = 'both' OR applies_to = ?)
        `).all(requesterType);

        for (const rule of rules) {
            try {
                const regex = new RegExp(rule.pattern, 'giu');
                cleaned = cleaned.replace(regex, rule.replacement);
            } catch (e) {
                console.error(`Invalid regex pattern in DB: ${rule.pattern}`, e);
            }
        }
    } catch(e) {}

    // Clean up multiple spaces and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * Apply output rules to the final title
 * @param {string} title 
 * @param {string} requesterType 'sonarr', 'radarr', or 'both'
 */
function applyOutputRules(title, requesterType = 'both') {
    if (!title) return title;
    let output = title;
    try {
        const rules = db.prepare(`
            SELECT pattern, replacement 
            FROM OutputRegexRules 
            WHERE is_active = 1 
            AND (applies_to = 'both' OR applies_to = ?)
        `).all(requesterType);

        for (const rule of rules) {
            try {
                const regex = new RegExp(rule.pattern, 'giu');
                output = output.replace(regex, rule.replacement);
            } catch (e) {
                console.error(`Invalid output regex pattern in DB: ${rule.pattern}`, e);
            }
        }
    } catch(e) {}
    return output;
}

module.exports = {
    cleanQuery,
    applyOutputRules
};
