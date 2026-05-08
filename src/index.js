const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./services/logger');
const config = require('./config');

const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // For ease of use with the dashboard
}));
app.use(cors());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const torznabRouter = require('./routes/torznab');
const dashboardApiRouter = require('./routes/dashboardApi');

// Torznab Proxy Endpoint
app.use('/api', torznabRouter);
app.use('/:indexerId/api', torznabRouter);
app.use('/prowlarr/:indexerId/api', torznabRouter);

// Dashboard API Endpoint
app.use('/dashboard-api', dashboardApiRouter);

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Animarr Proxy is running' });
});

app.use((req, res, next) => {
    // Exclude /api paths from fallback
    if (req.path.startsWith('/api') || req.path.startsWith('/dashboard-api')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const conf = config.getConfig();
// Start Server
app.listen(conf.PORT, () => {
    console.log(`Animarr Torznab Proxy running on port ${conf.PORT}`);
    if (conf.ADMIN_PASSWORD) {
        console.log('Dashboard is protected with password.');
    } else {
        console.log('Dashboard is open (No ADMIN_PASSWORD set). Relying on external SSO.');
    }

    // DB Cleanup Task (Runs every hour)
    const db = require('./database/db');
    setInterval(() => {
        try {
            // Delete logs older than 7 days
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            db.prepare("DELETE FROM Logs WHERE timestamp <= ?").run(sevenDaysAgo);
            
            // Delete expired cache
            db.prepare("DELETE FROM PersistentCache WHERE expires_at <= CURRENT_TIMESTAMP").run();
        } catch (e) {
            console.error('DB Cleanup error:', e);
        }
    }, 60 * 60 * 1000); // 1 hour
});
