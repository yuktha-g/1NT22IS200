// backend-test-submission/server.js
const express = require('express');
const cors = require('cors');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const { CustomLogger, requestLogger } = require('../logging-middleware/logger');

const app = express();
const PORT = process.env.PORT || 5000;
const logger = new CustomLogger();

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger(logger));

// In-memory storage (in production, use a database)
const urlDatabase = new Map();
const clickDatabase = new Map();

// Utility functions
const generateShortcode = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const isValidShortcode = (shortcode) => {
  return /^[a-zA-Z0-9]{3,10}$/.test(shortcode);
};

const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null);
};

const getGeolocation = (ip) => {
  // Simple geolocation simulation (in production, use a real geolocation service)
  const locations = ['New York, US', 'London, UK', 'Tokyo, JP', 'Mumbai, IN', 'Sydney, AU'];
  return locations[Math.floor(Math.random() * locations.length)];
};

// Clean expired URLs every minute
cron.schedule('* * * * *', () => {
  const now = new Date();
  let expiredCount = 0;
  
  for (const [shortcode, data] of urlDatabase.entries()) {
    if (new Date(data.expiry) <= now) {
      urlDatabase.delete(shortcode);
      clickDatabase.delete(shortcode);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    logger.info(`Cleaned ${expiredCount} expired URLs`);
  }
});

// API Routes

// Create Short URL
app.post('/shorturls', (req, res) => {
  try {
    const { url, validity = 30, shortcode: customShortcode } = req.body;

    // Validation
    if (!url) {
      logger.warn('URL creation failed: Missing URL', { body: req.body });
      return res.status(400).json({
        error: 'URL is required',
        code: 'MISSING_URL'
      });
    }

    if (!validator.isURL(url, { protocols: ['http', 'https'] })) {
      logger.warn('URL creation failed: Invalid URL format', { url });
      return res.status(400).json({
        error: 'Invalid URL format',
        code: 'INVALID_URL'
      });
    }

    if (typeof validity !== 'number' || validity <= 0) {
      logger.warn('URL creation failed: Invalid validity', { validity });
      return res.status(400).json({
        error: 'Validity must be a positive number',
        code: 'INVALID_VALIDITY'
      });
    }

    // Handle shortcode
    let finalShortcode = customShortcode;
    
    if (customShortcode) {
      if (!isValidShortcode(customShortcode)) {
        logger.warn('URL creation failed: Invalid shortcode format', { shortcode: customShortcode });
        return res.status(400).json({
          error: 'Shortcode must be alphanumeric and 3-10 characters long',
          code: 'INVALID_SHORTCODE'
        });
      }
      
      if (urlDatabase.has(customShortcode)) {
        logger.warn('URL creation failed: Shortcode already exists', { shortcode: customShortcode });
        return res.status(409).json({
          error: 'Shortcode already exists',
          code: 'SHORTCODE_EXISTS'
        });
      }
    } else {
      // Generate unique shortcode
      do {
        finalShortcode = generateShortcode();
      } while (urlDatabase.has(finalShortcode));
    }

    // Calculate expiry
    const now = new Date();
    const expiry = new Date(now.getTime() + validity * 60 * 1000);

    // Store URL data
    const urlData = {
      url,
      shortcode: finalShortcode,
      createdAt: now.toISOString(),
      expiry: expiry.toISOString(),
      validity
    };

    urlDatabase.set(finalShortcode, urlData);
    clickDatabase.set(finalShortcode, []);

    const shortlink = `http://localhost:${PORT}/${finalShortcode}`;

    logger.info('URL created successfully', {
      shortcode: finalShortcode,
      originalUrl: url,
      expiry: expiry.toISOString()
    });

    res.status(201).json({
      shortlink,
      expiry: expiry.toISOString()
    });

  } catch (error) {
    logger.error('Error creating short URL', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get URL Statistics
app.get('/shorturls/:shortcode', (req, res) => {
  try {
    const { shortcode } = req.params;

    if (!urlDatabase.has(shortcode)) {
      logger.warn('Statistics request failed: Shortcode not found', { shortcode });
      return res.status(404).json({
        error: 'Shortcode not found',
        code: 'SHORTCODE_NOT_FOUND'
      });
    }

    const urlData = urlDatabase.get(shortcode);
    const clicks = clickDatabase.get(shortcode) || [];

    // Check if expired
    const now = new Date();
    if (new Date(urlData.expiry) <= now) {
      logger.warn('Statistics request failed: URL expired', { shortcode });
      return res.status(410).json({
        error: 'URL has expired',
        code: 'URL_EXPIRED'
      });
    }

    const statistics = {
      shortcode,
      originalUrl: urlData.url,
      shortlink: `http://localhost:${PORT}/${shortcode}`,
      createdAt: urlData.createdAt,
      expiry: urlData.expiry,
      totalClicks: clicks.length,
      clicks: clicks.map(click => ({
        timestamp: click.timestamp,
        referrer: click.referrer || 'Direct',
        userAgent: click.userAgent,
        location: click.location,
        ip: click.ip
      }))
    };

    logger.info('Statistics retrieved', { shortcode, totalClicks: clicks.length });

    res.json(statistics);

  } catch (error) {
    logger.error('Error retrieving statistics', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Redirect short URL
app.get('/:shortcode', (req, res) => {
  try {
    const { shortcode } = req.params;

    if (!urlDatabase.has(shortcode)) {
      logger.warn('Redirect failed: Shortcode not found', { shortcode });
      return res.status(404).json({
        error: 'Shortcode not found',
        code: 'SHORTCODE_NOT_FOUND'
      });
    }

    const urlData = urlDatabase.get(shortcode);
    const now = new Date();

    // Check if expired
    if (new Date(urlData.expiry) <= now) {
      logger.warn('Redirect failed: URL expired', { shortcode });
      return res.status(410).json({
        error: 'URL has expired',
        code: 'URL_EXPIRED'
      });
    }

    // Record click
    const clickData = {
      timestamp: now.toISOString(),
      referrer: req.get('Referer'),
      userAgent: req.get('User-Agent'),
      ip: getClientIP(req),
      location: getGeolocation(getClientIP(req))
    };

    const clicks = clickDatabase.get(shortcode) || [];
    clicks.push(clickData);
    clickDatabase.set(shortcode, clicks);

    logger.info('URL accessed', {
      shortcode,
      originalUrl: urlData.url,
      clickCount: clicks.length,
      userAgent: clickData.userAgent
    });

    // Redirect to original URL
    res.redirect(urlData.url);

  } catch (error) {
    logger.error('Error during redirect', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get all URLs (for frontend statistics page)
app.get('/api/urls', (req, res) => {
  try {
    const allUrls = [];
    const now = new Date();

    for (const [shortcode, urlData] of urlDatabase.entries()) {
      const clicks = clickDatabase.get(shortcode) || [];
      const isExpired = new Date(urlData.expiry) <= now;

      allUrls.push({
        shortcode,
        originalUrl: urlData.url,
        shortlink: `http://localhost:${PORT}/${shortcode}`,
        createdAt: urlData.createdAt,
        expiry: urlData.expiry,
        totalClicks: clicks.length,
        isExpired,
        status: isExpired ? 'expired' : 'active'
      });
    }

    // Sort by creation date (newest first)
    allUrls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    logger.info('All URLs retrieved', { count: allUrls.length });

    res.json({ urls: allUrls });

  } catch (error) {
    logger.error('Error retrieving all URLs', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'url-shortener-backend'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('Route not found', { url: req.originalUrl, method: req.method });
  res.status(404).json({
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND'
  });
});

app.listen(PORT, () => {
  logger.info(`URL Shortener Backend running on port ${PORT}`);
});