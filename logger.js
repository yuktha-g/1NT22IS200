// logging-middleware/logger.js
class CustomLogger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      meta,
      service: meta.service || 'url-shortener'
    };
    return JSON.stringify(logEntry, null, 2);
  }

  shouldLog(level) {
    return this.logLevels[level] <= this.logLevels[this.logLevel];
  }

  error(message, meta = {}) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  warn(message, meta = {}) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  info(message, meta = {}) {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  debug(message, meta = {}) {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }
}

// Express middleware
const requestLogger = (logger) => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Log incoming request
    logger.info('Incoming request', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      service: 'backend'
    });

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const duration = Date.now() - startTime;
      logger.info('Response sent', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        service: 'backend'
      });
      originalEnd.call(this, chunk, encoding);
    };

    next();
  };
};

// Frontend logger
const createFrontendLogger = () => {
  const logger = new CustomLogger();
  
  // Override methods for frontend
  const frontendLogger = {
    error: (message, meta = {}) => logger.error(message, { ...meta, service: 'frontend' }),
    warn: (message, meta = {}) => logger.warn(message, { ...meta, service: 'frontend' }),
    info: (message, meta = {}) => logger.info(message, { ...meta, service: 'frontend' }),
    debug: (message, meta = {}) => logger.debug(message, { ...meta, service: 'frontend' })
  };

  return frontendLogger;
};

module.exports = {
  CustomLogger,
  requestLogger,
  createFrontendLogger
};

// For frontend usage (browser)
if (typeof window !== 'undefined') {
  window.CustomLogger = {
    createFrontendLogger
  };
}