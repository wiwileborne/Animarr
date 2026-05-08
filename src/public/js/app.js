document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');

    // Modal elements
    const confirmModal = document.getElementById('confirm-modal');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMsg = document.getElementById('confirm-msg');
    const confirmYes = document.getElementById('confirm-yes');
    const confirmNo = document.getElementById('confirm-no');

    // Tabs
    const navLinks = document.querySelectorAll('.nav-links li');
    const tabContents = document.querySelectorAll('.tab-content');

    // API Base
    const API_BASE = '/dashboard-api';

    // State
    let authRequired = false;
    let logsPage = 1;
    let dictPage = 1;
    let dictSearch = '';
    let logsTotalPages = 1;
    let dictTotalPages = 1;
    let editingDictId = null;
    let editingRegexId = null;
    let editingOutputRegexId = null;
    let searchTimeout;

    // ---------------- Actions ----------------

    function showConfirm(title, msg, onConfirm) {
        confirmTitle.textContent = title;
        confirmMsg.textContent = msg;
        confirmModal.classList.remove('hidden');
        
        const handleYes = () => {
            confirmModal.classList.add('hidden');
            confirmYes.removeEventListener('click', handleYes);
            confirmNo.removeEventListener('click', handleNo);
            onConfirm();
        };
        
        const handleNo = () => {
            confirmModal.classList.add('hidden');
            confirmYes.removeEventListener('click', handleYes);
            confirmNo.removeEventListener('click', handleNo);
        };
        
        confirmYes.addEventListener('click', handleYes);
        confirmNo.addEventListener('click', handleNo);
    }

    const deleteDict = (id) => {
        showConfirm('Delete Entry', 'Are you sure you want to delete this dictionary entry?', async () => {
            try {
                const res = await fetch(`${API_BASE}/dictionary/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) loadDictionary();
                else alert('Failed to delete');
            } catch (e) { alert('Network error'); }
        });
    };

    const editDict = (id, original, alternates, tmdb, mal, anilist, imdb, tvdb, isAnime) => {
        editingDictId = id;
        document.getElementById('dict-original').value = original;
        document.getElementById('dict-alternates').value = alternates;
        document.getElementById('dict-tmdb-id').value = tmdb || '';
        document.getElementById('dict-mal-id').value = mal || '';
        document.getElementById('dict-anilist-id').value = anilist || '';
        document.getElementById('dict-imdb-id').value = imdb || '';
        document.getElementById('dict-tvdb-id').value = tvdb || '';
        document.getElementById('dict-is-anime').checked = !!isAnime;
        const formTitle = document.querySelector('#add-dict-form h3');
        if (formTitle) formTitle.textContent = 'Edit Dictionary Entry';
        document.getElementById('add-dict-form').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteRegex = (id) => {
        showConfirm('Delete Regex', 'Are you sure you want to delete this regex rule?', async () => {
            try {
                const res = await fetch(`${API_BASE}/regex/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) loadRegex();
                else alert('Failed to delete regex');
            } catch (e) { console.error('Delete Regex error', e); }
        });
    };

    const editRegex = (id, pattern, replacement, description, is_active, applies_to) => {
        editingRegexId = id;
        document.getElementById('regex-pattern').value = pattern;
        document.getElementById('regex-replacement').value = replacement;
        document.getElementById('regex-desc').value = description;
        document.getElementById('regex-active').checked = !!is_active;
        document.getElementById('regex-target').value = applies_to || 'both';
        const formTitle = document.querySelector('#add-regex-form h3');
        if (formTitle) formTitle.textContent = 'Edit Regex Rule';
        document.getElementById('add-regex-form').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteOutputRegex = (id) => {
        showConfirm('Delete Output Regex', 'Are you sure you want to delete this output regex rule?', async () => {
            try {
                const res = await fetch(`${API_BASE}/outputregex/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) loadOutputRegex();
                else alert('Failed to delete output regex');
            } catch (e) { console.error('Delete OutputRegex error', e); }
        });
    };

    const editOutputRegex = (id, pattern, replacement, description, is_active, applies_to) => {
        editingOutputRegexId = id;
        document.getElementById('outputregex-pattern').value = pattern;
        document.getElementById('outputregex-replacement').value = replacement;
        document.getElementById('outputregex-desc').value = description;
        document.getElementById('outputregex-active').checked = !!is_active;
        document.getElementById('outputregex-target').value = applies_to || 'both';
        const formTitle = document.querySelector('#add-outputregex-form h3');
        if (formTitle) formTitle.textContent = 'Edit Output Regex Rule';
        document.getElementById('add-outputregex-form').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Global Exposure
    window.deleteDict = deleteDict;
    window.editDict = editDict;
    window.deleteRegex = deleteRegex;
    window.editRegex = editRegex;
    window.deleteOutputRegex = deleteOutputRegex;
    window.editOutputRegex = editOutputRegex;

    // ---------------- Loaders ----------------

    async function loadStats() {
        try {
            const res = await fetch(`${API_BASE}/stats`);
            const stats = await res.json();
            document.getElementById('stat-total-req').textContent = stats.logsTotal;
            document.getElementById('stat-success-rate').textContent = `${stats.successRate}%`;
            document.getElementById('stat-cache-total').textContent = stats.cacheTotal;
            document.getElementById('stat-logs-24h').textContent = stats.logs24h;
        } catch (e) {}
    }

    async function loadLogs() {
        try {
            const res = await fetch(`${API_BASE}/logs?page=${logsPage}`);
            if (res.status === 401) return showLogin();
            const result = await res.json();
            logsTotalPages = result.pagination.pages;
            
            document.getElementById('page-info-logs').textContent = `Page ${logsPage} of ${logsTotalPages || 1}`;
            document.getElementById('prev-logs').disabled = logsPage <= 1;
            document.getElementById('next-logs').disabled = logsPage >= logsTotalPages;

            const tbody = document.querySelector('#logs-table tbody');
            tbody.innerHTML = '';
            result.data.forEach(log => {
                let resolvedStr = '-';
                try {
                    const arr = JSON.parse(log.resolved_titles);
                    resolvedStr = arr.map(a => {
                        const title = typeof a.title === 'string' && a.title.trim() !== '' ? a.title : '[Empty]';
                        const source = a.source || 'unknown';
                        return `<span class="badge" title="${source}">${title} <i>(${source})</i></span>`;
                    }).join(' ');
                } catch(e) {}
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(log.timestamp).toLocaleString()}</td>
                    <td>${log.original_query || '-'}</td>
                    <td>${log.cleaned_query || '-'}</td>
                    <td>${resolvedStr}</td>
                    <td>${log.action_taken || '-'}</td>
                    <td>${log.prowlarr_response_code || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {}
    }

    async function loadDictionary() {
        try {
            const res = await fetch(`${API_BASE}/dictionary?page=${dictPage}&search=${encodeURIComponent(dictSearch)}`);
            const data = await res.json();
            const tbody = document.querySelector('#dict-table tbody');
            tbody.innerHTML = '';
            
            data.results.forEach(row => {
                const tr = document.createElement('tr');
                const alternates = JSON.parse(row.alternate_titles || '[]');
                tr.innerHTML = `
                    <td>${row.original_title}</td>
                    <td>${alternates.join(', ')}</td>
                    <td>${row.source} ${row.is_anime ? '<span class="badge">Anime</span>' : ''}</td>
                    <td>
                        <button class="action-btn edit-btn">Edit</button>
                        <button class="action-btn delete-btn">Delete</button>
                    </td>
                `;
                
                tr.querySelector('.edit-btn').addEventListener('click', () => editDict(
                    row.id, row.original_title, row.alternate_titles,
                    row.tmdb_id, row.mal_id, row.anilist_id, row.imdb_id, row.tvdb_id, row.is_anime
                ));
                tr.querySelector('.delete-btn').addEventListener('click', () => deleteDict(row.id));
                tbody.appendChild(tr);
            });
            
            document.getElementById('page-info-dict').textContent = `Page ${data.page} of ${data.totalPages || 1}`;
            dictTotalPages = data.totalPages || 1;
            document.getElementById('prev-dict').disabled = dictPage <= 1;
            document.getElementById('next-dict').disabled = dictPage >= dictTotalPages;
        } catch (e) { console.error('Load Dict error', e); }
    }

    async function loadRegex() {
        try {
            const res = await fetch(`${API_BASE}/regex`);
            const rules = await res.json();
            const tbody = document.querySelector('#regex-table tbody');
            tbody.innerHTML = '';
            rules.forEach(rule => {
                const tr = document.createElement('tr');
                const targetLabel = rule.applies_to === 'both' ? 'Both' : (rule.applies_to === 'sonarr' ? 'Sonarr' : 'Radarr');
                tr.innerHTML = `
                    <td><code>${rule.pattern}</code></td>
                    <td><code>${rule.replacement}</code></td>
                    <td><span class="badge ${rule.applies_to}">${targetLabel}</span></td>
                    <td>${rule.description || '-'}</td>
                    <td>${rule.is_active ? 'Yes' : 'No'}</td>
                    <td>
                        <button class="action-btn edit-btn">Edit</button>
                        <button class="action-btn delete-btn">Delete</button>
                    </td>
                `;
                tr.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    editRegex(rule.id, rule.pattern, rule.replacement, rule.description, rule.is_active, rule.applies_to);
                });
                tr.querySelector('.delete-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    deleteRegex(rule.id);
                });
                tbody.appendChild(tr);
            });
        } catch (e) {}
    }

    async function loadOutputRegex() {
        try {
            const res = await fetch(`${API_BASE}/outputregex`);
            const rules = await res.json();
            const tbody = document.querySelector('#outputregex-table tbody');
            tbody.innerHTML = '';
            rules.forEach(rule => {
                const tr = document.createElement('tr');
                const targetLabel = rule.applies_to === 'both' ? 'Both' : (rule.applies_to === 'sonarr' ? 'Sonarr' : 'Radarr');
                tr.innerHTML = `
                    <td><code>${rule.pattern}</code></td>
                    <td><code>${rule.replacement}</code></td>
                    <td><span class="badge ${rule.applies_to}">${targetLabel}</span></td>
                    <td>${rule.description || '-'}</td>
                    <td>${rule.is_active ? 'Yes' : 'No'}</td>
                    <td>
                        <button class="action-btn edit-btn">Edit</button>
                        <button class="action-btn delete-btn">Delete</button>
                    </td>
                `;
                tr.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    editOutputRegex(rule.id, rule.pattern, rule.replacement, rule.description, rule.is_active, rule.applies_to);
                });
                tr.querySelector('.delete-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    deleteOutputRegex(rule.id);
                });
                tbody.appendChild(tr);
            });
        } catch (e) {}
    }

    async function loadConfig() {
        try {
            const res = await fetch(`${API_BASE}/config`);
            const conf = await res.json();
            document.getElementById('conf-prowlarr-url').value = conf.PROWLARR_URL || '';
            document.getElementById('conf-prowlarr-key').value = conf.PROWLARR_API_KEY || '';
            document.getElementById('conf-enable-anilist').checked = conf.ENABLE_ANILIST === 'true';
            document.getElementById('conf-enable-mal').checked = conf.ENABLE_MAL === 'true';
            document.getElementById('conf-enable-tmdb').checked = conf.ENABLE_TMDB === 'true';
            document.getElementById('conf-tmdb-key').value = conf.TMDB_API_KEY || '';
            document.getElementById('conf-enable-imdb').checked = conf.ENABLE_IMDB === 'true';
            document.getElementById('conf-imdb-key').value = conf.IMDB_API_KEY || '';
        } catch (e) {}
    }

    // ---------------- Auth & UI ----------------

    function showLogin() {
        loginScreen.classList.remove('hidden');
        dashboardScreen.classList.add('hidden');
    }

    function showDashboard() {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        if (authRequired) logoutBtn.classList.remove('hidden');
        loadStats();
        loadLogs();
    }

    async function init() {
        try {
            const res = await fetch(`${API_BASE}/auth/status`);
            const data = await res.json();
            authRequired = data.authRequired;
            if (authRequired) {
                const testRes = await fetch(`${API_BASE}/logs`);
                if (testRes.status === 401) showLogin();
                else showDashboard();
            } else showDashboard();
        } catch (e) { console.error('Init error', e); }
    }

    // ---------------- Event Listeners ----------------

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('password').value;
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (data.success) showDashboard();
            else loginError.textContent = data.error || 'Login failed';
        } catch (e) { loginError.textContent = 'Network error'; }
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        showLogin();
    });

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(t => t.classList.add('hidden'));
            link.classList.add('active');
            const tabId = link.getAttribute('data-tab');
            const targetContent = document.getElementById(`tab-${tabId}`);
            if (targetContent) targetContent.classList.remove('hidden');
            
            if (tabId === 'overview') loadStats();
            if (tabId === 'logs') loadLogs();
            if (tabId === 'dictionary') loadDictionary();
            if (tabId === 'regex') loadRegex();
            if (tabId === 'outputregex') loadOutputRegex();
            if (tabId === 'config') loadConfig();
        });
    });

    // Pagination & Refresh
    document.getElementById('refresh-logs').addEventListener('click', () => { logsPage = 1; loadLogs(); });
    document.getElementById('prev-logs').addEventListener('click', () => { if (logsPage > 1) { logsPage--; loadLogs(); } });
    document.getElementById('next-logs').addEventListener('click', () => { if (logsPage < logsTotalPages) { logsPage++; loadLogs(); } });

    document.getElementById('prev-dict').addEventListener('click', () => { if (dictPage > 1) { dictPage--; loadDictionary(); } });
    document.getElementById('next-dict').addEventListener('click', () => { if (dictPage < dictTotalPages) { dictPage++; loadDictionary(); } });

    document.getElementById('search-dict').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            dictSearch = e.target.value;
            dictPage = 1;
            loadDictionary();
        }, 300);
    });

    // API Search Logic
    document.getElementById('run-api-search').addEventListener('click', async () => {
        const query = document.getElementById('search-api-query').value;
        const target = document.getElementById('search-api-target').value;
        if (!query) return;
        
        const btn = document.getElementById('run-api-search');
        btn.disabled = true;
        btn.textContent = 'Searching...';
        
        try {
            const res = await fetch(`${API_BASE}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, target })
            });
            const data = await res.json();
            
            const resultsDiv = document.getElementById('api-search-results');
            const tbody = document.querySelector('#api-results-table tbody');
            tbody.innerHTML = '';
            
            if (data.results && data.results.length > 0) {
                if (data.original !== data.cleaned) {
                    const infoRow = document.createElement('tr');
                    infoRow.innerHTML = `<td colspan="3" style="color: var(--primary); font-size: 0.8rem; text-align: center; background: rgba(59, 130, 246, 0.05);">
                        Rules Applied: "${data.original}" ➔ <b>"${data.cleaned}"</b>
                    </td>`;
                    tbody.appendChild(infoRow);
                }
                data.results.forEach(item => {
                    const tr = document.createElement('tr');
                    const allTitles = [item.title, ...(item.alternate_titles || [])];
                    const displayTitle = item.title;
                    
                    tr.innerHTML = `
                        <td>${displayTitle}</td>
                        <td>${item.source}</td>
                        <td><button class="action-btn edit-btn">Add to Dict</button></td>
                    `;
                    tr.querySelector('button').addEventListener('click', () => {
                        navLinks.forEach(l => {
                            if (l.getAttribute('data-tab') === 'dictionary') l.click();
                        });
                        document.getElementById('add-dict-btn').click();
                        document.getElementById('dict-original').value = query;
                        
                        document.getElementById('dict-alternates').value = JSON.stringify(allTitles);
                        document.getElementById('dict-tmdb-id').value = item.ids.tmdbId || '';
                        document.getElementById('dict-mal-id').value = item.ids.malId || '';
                        document.getElementById('dict-anilist-id').value = item.ids.anilistId || '';
                        document.getElementById('dict-imdb-id').value = item.ids.imdbId || '';
                        document.getElementById('dict-tvdb-id').value = item.ids.tvdbId || '';
                        document.getElementById('dict-is-anime').checked = !!item.is_anime;
                    });
                    tbody.appendChild(tr);
                });
                resultsDiv.classList.remove('hidden');
            } else {
                tbody.innerHTML = '<tr><td colspan="3">No results found</td></tr>';
                resultsDiv.classList.remove('hidden');
            }
        } catch (e) {
            alert('Search failed');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Search APIs';
        }
    });

    // ID-based Search Logic
    document.getElementById('run-id-search').addEventListener('click', async () => {
        const tmdbid = document.getElementById('search-id-tmdb').value.trim();
        const imdbid = document.getElementById('search-id-imdb').value.trim();
        const tvdbid = document.getElementById('search-id-tvdb').value.trim();
        if (!tmdbid && !imdbid && !tvdbid) return alert('Enter at least one ID');

        const btn = document.getElementById('run-id-search');
        btn.disabled = true;
        btn.textContent = 'Looking up...';

        try {
            const res = await fetch(`${API_BASE}/search-by-id`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tmdbid: tmdbid || undefined, imdbid: imdbid || undefined, tvdbid: tvdbid || undefined })
            });
            const data = await res.json();

            const resultsDiv = document.getElementById('api-search-results');
            const tbody = document.querySelector('#api-results-table tbody');
            tbody.innerHTML = '';

            if (data.results && data.results.length > 0) {
                const idInfo = [];
                if (tmdbid) idInfo.push(`TMDB: ${tmdbid}`);
                if (imdbid) idInfo.push(`IMDB: ${imdbid}`);
                if (tvdbid) idInfo.push(`TVDB: ${tvdbid}`);
                const infoRow = document.createElement('tr');
                infoRow.innerHTML = `<td colspan="3" style="color: var(--primary); font-size: 0.8rem; text-align: center; background: rgba(59, 130, 246, 0.05);">
                    ID Lookup: ${idInfo.join(' | ')} — <b>${data.results.length} titles found</b>
                </td>`;
                tbody.appendChild(infoRow);

                data.results.forEach(item => {
                    const tr = document.createElement('tr');
                    const allTitles = [item.title, ...(item.alternate_titles || [])];
                    const displayTitle = item.title;

                    tr.innerHTML = `
                        <td>${displayTitle}</td>
                        <td>${item.source}</td>
                        <td><button class="action-btn edit-btn">Add to Dict</button></td>
                    `;
                    tr.querySelector('button').addEventListener('click', () => {
                        navLinks.forEach(l => {
                            if (l.getAttribute('data-tab') === 'dictionary') l.click();
                        });
                        document.getElementById('add-dict-btn').click();
                        document.getElementById('dict-original').value = item.title;
                        document.getElementById('dict-alternates').value = JSON.stringify(allTitles);
                        document.getElementById('dict-tmdb-id').value = item.ids.tmdbId || '';
                        document.getElementById('dict-mal-id').value = item.ids.malId || '';
                        document.getElementById('dict-anilist-id').value = item.ids.anilistId || '';
                        document.getElementById('dict-imdb-id').value = item.ids.imdbId || '';
                        document.getElementById('dict-tvdb-id').value = item.ids.tvdbId || '';
                        document.getElementById('dict-is-anime').checked = !!item.is_anime;
                    });
                    tbody.appendChild(tr);
                });
                resultsDiv.classList.remove('hidden');
            } else {
                tbody.innerHTML = '<tr><td colspan="3">No titles found for these IDs</td></tr>';
                resultsDiv.classList.remove('hidden');
            }
        } catch (e) {
            alert('ID lookup failed');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Lookup by ID';
        }
    });

    // Forms submission handlers
    document.getElementById('form-dict').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            original_title: document.getElementById('dict-original').value,
            alternate_titles: document.getElementById('dict-alternates').value,
            tmdb_id: document.getElementById('dict-tmdb-id').value,
            mal_id: document.getElementById('dict-mal-id').value,
            anilist_id: document.getElementById('dict-anilist-id').value,
            imdb_id: document.getElementById('dict-imdb-id').value,
            tvdb_id: document.getElementById('dict-tvdb-id').value,
            is_anime: document.getElementById('dict-is-anime').checked
        };
        try {
            const url = editingDictId ? `${API_BASE}/dictionary/${editingDictId}` : `${API_BASE}/dictionary`;
            const method = editingDictId ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if ((await res.json()).success) {
                document.getElementById('add-dict-form').classList.add('hidden');
                document.getElementById('form-dict').reset();
                editingDictId = null;
                loadDictionary();
            } else alert('Failed to save');
        } catch (e) {}
    });

    document.getElementById('form-regex').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pattern = document.getElementById('regex-pattern').value;
        const replacement = document.getElementById('regex-replacement').value;
        const description = document.getElementById('regex-desc').value;
        const is_active = document.getElementById('regex-active').checked;
        const applies_to = document.getElementById('regex-target').value;
        
        try {
            const url = editingRegexId ? `${API_BASE}/regex/${editingRegexId}` : `${API_BASE}/regex`;
            const method = editingRegexId ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern, replacement, description, is_active, applies_to })
            });
            if ((await res.json()).success) {
                document.getElementById('add-regex-form').classList.add('hidden');
                document.getElementById('form-regex').reset();
                editingRegexId = null;
                loadRegex();
            }
        } catch (e) {}
    });

    document.getElementById('form-outputregex').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pattern = document.getElementById('outputregex-pattern').value;
        const replacement = document.getElementById('outputregex-replacement').value;
        const description = document.getElementById('outputregex-desc').value;
        const is_active = document.getElementById('outputregex-active').checked;
        const applies_to = document.getElementById('outputregex-target').value;
        
        try {
            const url = editingOutputRegexId ? `${API_BASE}/outputregex/${editingOutputRegexId}` : `${API_BASE}/outputregex`;
            const method = editingOutputRegexId ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern, replacement, description, is_active, applies_to })
            });
            if ((await res.json()).success) {
                document.getElementById('add-outputregex-form').classList.add('hidden');
                document.getElementById('form-outputregex').reset();
                editingOutputRegexId = null;
                loadOutputRegex();
            }
        } catch (e) {}
    });

    document.getElementById('test-prowlarr-btn').addEventListener('click', async () => {
        const url = document.getElementById('conf-prowlarr-url').value;
        const apiKey = document.getElementById('conf-prowlarr-key').value;
        const statusEl = document.getElementById('test-prowlarr-status');
        
        if (!url) {
            statusEl.textContent = '❌ Please enter a URL';
            statusEl.style.color = '#ff4d4d';
            return;
        }

        const btn = document.getElementById('test-prowlarr-btn');
        btn.disabled = true;
        statusEl.textContent = '⏳ Testing...';
        statusEl.style.color = '#aaa';

        try {
            const res = await fetch(`${API_BASE}/test-prowlarr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, apiKey })
            });
            const data = await res.json();
            if (data.success) {
                statusEl.textContent = '✅ ' + data.message;
                statusEl.style.color = '#4ade80';
            } else {
                statusEl.textContent = '❌ ' + (data.error || 'Connection failed');
                statusEl.style.color = '#ff4d4d';
            }
        } catch (e) {
            statusEl.textContent = '❌ Request failed: ' + e.message;
            statusEl.style.color = '#ff4d4d';
        } finally {
            btn.disabled = false;
        }
    });

    // Config form
    document.getElementById('form-config').addEventListener('submit', async (e) => {
        e.preventDefault();
        const configData = {
            PROWLARR_URL: document.getElementById('conf-prowlarr-url').value,
            PROWLARR_API_KEY: document.getElementById('conf-prowlarr-key').value,
            ENABLE_ANILIST: document.getElementById('conf-enable-anilist').checked ? 'true' : 'false',
            ENABLE_MAL: document.getElementById('conf-enable-mal').checked ? 'true' : 'false',
            ENABLE_TMDB: document.getElementById('conf-enable-tmdb').checked ? 'true' : 'false',
            TMDB_API_KEY: document.getElementById('conf-tmdb-key').value,
            ENABLE_IMDB: document.getElementById('conf-enable-imdb').checked ? 'true' : 'false',
            IMDB_API_KEY: document.getElementById('conf-imdb-key').value,
        };
        try {
            const res = await fetch(`${API_BASE}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configData)
            });
            if ((await res.json()).success) alert('Configuration saved!');
            else alert('Failed to save configuration');
        } catch (e) { alert('Network error'); }
    });

    document.getElementById('clear-cache-btn').addEventListener('click', () => {
        showConfirm(
            'Clear Search Cache', 
            'Are you sure you want to clear the search cache? This will reset all API metadata cached so far.',
            async () => {
                const btn = document.getElementById('clear-cache-btn');
                btn.disabled = true;
                const oldText = btn.textContent;
                btn.textContent = 'Clearing...';
                
                try {
                    const res = await fetch(`${API_BASE}/cache`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        alert('Cache cleared successfully!');
                        loadStats();
                    } else {
                        alert('Failed to clear cache: ' + (data.error || 'Unknown error'));
                    }
                } catch (e) {
                    alert('Error clearing cache');
                } finally {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        );
    });

    document.getElementById('clear-logs-btn').addEventListener('click', () => {
        showConfirm(
            'Clear DB Logs', 
            'Are you sure you want to completely clear the Request Logs? This will not affect the daily text log files.',
            async () => {
                const btn = document.getElementById('clear-logs-btn');
                btn.disabled = true;
                const oldText = btn.textContent;
                btn.textContent = 'Clearing...';
                
                try {
                    const res = await fetch(`${API_BASE}/logs`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        alert('Logs cleared successfully!');
                        loadLogs();
                        loadStats();
                    } else {
                        alert('Failed to clear logs: ' + (data.error || 'Unknown error'));
                    }
                } catch (e) {
                    alert('Error clearing logs');
                } finally {
                    btn.disabled = false;
                    btn.textContent = oldText;
                }
            }
        );
    });

    // UI Helpers
    document.getElementById('add-dict-btn').addEventListener('click', () => {
        editingDictId = null;
        document.getElementById('form-dict').reset();
        document.querySelector('#add-dict-form h3').textContent = 'Add Dictionary Entry';
        document.getElementById('add-dict-form').classList.toggle('hidden');
    });

    document.getElementById('add-regex-btn').addEventListener('click', () => {
        editingRegexId = null;
        document.getElementById('form-regex').reset();
        document.querySelector('#add-regex-form h3').textContent = 'Add Regex Rule';
        document.getElementById('add-regex-form').classList.toggle('hidden');
    });

    document.getElementById('add-outputregex-btn').addEventListener('click', () => {
        editingOutputRegexId = null;
        document.getElementById('form-outputregex').reset();
        document.querySelector('#add-outputregex-form h3').textContent = 'Add Output Regex Rule';
        document.getElementById('add-outputregex-form').classList.toggle('hidden');
    });

    document.getElementById('cancel-dict-btn').addEventListener('click', () => {
        document.getElementById('add-dict-form').classList.add('hidden');
    });

    document.getElementById('cancel-regex-btn').addEventListener('click', () => {
        document.getElementById('add-regex-form').classList.add('hidden');
    });

    document.getElementById('cancel-outputregex-btn').addEventListener('click', () => {
        document.getElementById('add-outputregex-form').classList.add('hidden');
    });

    // Tester Logic
    document.getElementById('run-test').addEventListener('click', async () => {
        const title = document.getElementById('test-title').value;
        const target = document.getElementById('test-target').value;
        if (!title) return;
        try {
            const res = await fetch(`${API_BASE}/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, target })
            });
            const data = await res.json();
            document.getElementById('res-orig').textContent = data.original;
            document.getElementById('res-cleaned').textContent = data.cleaned;
            document.getElementById('res-output').textContent = data.output;
            document.getElementById('test-result').classList.remove('hidden');
        } catch (e) {}
    });

    // Initialize
    init();
});
