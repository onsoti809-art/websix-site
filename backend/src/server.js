// Websix backend — Express API with security middleware.
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { router: paymentsRouter, webhookHandler } = require('./routes/payments');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());

const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));

// Stripe webhook needs the RAW body for signature verification — mount BEFORE express.json().
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'websix-backend' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/payments', paymentsRouter);
app.use('/api/activities', require('./routes/activities'));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'server_error' }); });

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('[websix-backend] listening on :' + port));
