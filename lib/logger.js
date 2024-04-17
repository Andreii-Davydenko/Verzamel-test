const winston = require('winston');

/**
 * @class
 */
class Logger {
  /**
   * @private
   * @type {String}
   */
  baseLogPath = null;

  /**
   * @private
    * @type {winston.Logger}
   */
  winstonLogger = null;

  /**
   * @private
   * @type {boolean}
   */
  debugMode = false;

  /**
   * Create Logger instance
   * @param {String} baseLogPath
   * @param {Boolean} debugMode
   */
  constructor(baseLogPath, debugMode) {
    this.baseLogPath = baseLogPath;
    this.winstonLogger = this.getWinstonLogger();
    this.setDebugMode(debugMode);
  }

  /**
   * @private
   * @return {winston.Logger}
   */
  getWinstonLogger() {
    const {
      combine, timestamp, printf, align,
    } = winston.format;
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: combine(
        timestamp({
          format: 'YYYY-MM-DD hh:mm:ss',
        }),
        align(),
        printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`),
      ),
      transports: [new winston.transports.Console()],
    });
  }

  /**
   * @private
   * @return {winston.FileTransportInstance}
   */
  getFileTransport() {
    const filename = `${this.baseLogPath}/debug.log`;
    return new winston.transports.File({ filename, level: 'info' });
  }

  /**
   * @public
   * @param {Boolean} debugMode
   */
  setDebugMode(debugMode) {
    this.debugMode = debugMode;
    const existingFileTransport = this.winstonLogger.transports
      .find((item) => item.filename);
    if (debugMode && !existingFileTransport) {
      this.winstonLogger.add(this.getFileTransport());
    } else if (!debugMode && existingFileTransport) {
      this.winstonLogger.remove(existingFileTransport);
    }
  }

  /**
   * @public
   * @param {String} providerName
   * @param {String} msg
   * @param {Object} payload
   */
  info(providerName, msg, payload = null) {
    const additionalInfo = payload ? ` | Payload: ${JSON.stringify(payload)}` : '';
    this.winstonLogger.info(`[${providerName}] ${msg}${additionalInfo}`);
  }

  /**
   * @public
   * @param {String} providerName
   * @param {Error} err
   */
  error(providerName, err) {
    this.winstonLogger.error(`[${providerName}] ${err}`);
  }

  /**
   * @public
   * @param {import('playwright-core').Page} page
   */
  async screenshot(page) {
    if (this.debugMode) {
      const date = new Date();
      await page.screenshot({ path: `${this.baseLogPath}/screenshot-${date.toISOString()}.png` });
    }
  }
}

module.exports = Logger;
