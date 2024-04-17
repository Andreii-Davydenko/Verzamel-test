const {
  format, isAfter, isBefore, isEqual, startOfDay, endOfDay,
} = require('date-fns');
const Captcha = require('2captcha');

/**
 * @abstract
 */
class Provider {
  /**
   * @private
   * @type {string}
   */
  name = '';

  /**
   * @private
   * @type {Logger}
   */
  logger;

  /**
   * @private
   * @type {string}
   */
  authUrl;

  /**
   * @private
   * @type {string}
   */
  invoiceUrl;

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @param {Object} ctx
   * @param {{ name: String, url: String, username: String, password: String , accountId: String }} ctx.ws
   * @param {import('playwright-core').Page} ctx.page
   * @param {import('electron').BrowserWindow} ctx.win
   * @param {{ format: String, dateFormat: String }} ctx.settings
   * @param {{ from: String, to: String }} ctx.filters
   * @param {Logger} ctx.logger
   */
  constructor(ctx) {
    this.ws = ctx.ws;
    this.page = ctx.page;
    this.win = ctx.win;
    this.settings = ctx.settings;
    this.filters = ctx.filters;
    this.logger = ctx.logger;
  }

  /**
   * @public
   * @return {Promise<*[]>}
   */
  async fetch() {
    return [];
  }

  /**
   * @protected
   * @param {string} message
   * @param {Object} payload
   * @return {void}
   */
  onSuccess(message, payload = null) {
    this.logger.info(`${this.name} - ${this.ws.name}`, message, payload);
  }

  /**
   * @protected
   * @param {Error} err
   * @return {void}
   */
  onError(err) {
    this.logger.error(`${this.name} - ${this.ws.name}`, err);
  }

  /**
   * @protected
   * @param {Error} err
   * @param {import('playwright-core').Page} page
   * @return {Promise<void>}
   */
  async onPageError(err, page) {
    this.logger.error(this.name, err);
    await this.logger.screenshot(page);
  }

  /**
   * @protected
   * @param {Date} date
   * @return {String}
   */
  formatDate(date) {
    return format(date, this.settings.dateFormat);
  }

  /**
   * @protected
   * @param {(() => Promise)[]} functions
   * @return {Promise<*>[]}
   */
  async runSequentially(functions) {
    if (functions.length === 0) return [];
    const [first, ...rest] = functions;
    return [await first(), ...(await this.runSequentially(rest))];
  }

  /**
   * @protected
   * @param {Number} total
   */
  updateFetchStatus(total) {
    this.fetchCount += 1;
    this.win.webContents.send('onFetchWsChange', {
      msg: 'fetchingInvoicesFromWebsite',
      wsName: this.ws.name,
      percent: Math.round((this.fetchCount / total) * 100),
    });
  }

  /**
   * @protected
   * @param {Number} total
   */
  updateTimeoutStatus(total) {
    this.win.webContents.send('onFetchWsChange', {
      msg: 'approvalNotice',
      wsName: this.ws.name,
    });
    if (total === 1) {
      this.win.webContents.send('onFetchWsChange', {
        msg: 'Loading...',
        wsName: this.ws.name,
      });
    }
  }

  /**
   * @protected
   * @param {{ description: String, date: Date, href: String, wsName: String }[]} invoiceList
   * @return {*}
   */
  applyFilters(invoiceList) {
    if (!this.filters?.to || !this.filters?.from) return invoiceList;
    const from = startOfDay(new Date(this.filters.from));
    const to = endOfDay(new Date(this.filters.to));
    return invoiceList
      .filter((invoice) => (isAfter(invoice.date, from) && isBefore(invoice.date, to))
        || isEqual(invoice.date, from) || isEqual(invoice.date, to));
  }

  /**
   * @protected
   * @param {string} captchaSelector
   * @return {Promise<void>}
   */
  async handleCaptcha(captchaSelector) {
    const captchaWrapper = this.page.locator(captchaSelector);
    if (await captchaWrapper.isVisible({ timeout: 3000 })) {
      const captchaResponse = await this.page.solveRecaptchas();
      if (captchaResponse.error) {
        throw new Error('authenticationFailed');
      }
    }
  }

  /**
   * @protected
   * @param {string} captchaImage
   * @return {Promise<void>}
   */
  async handle2Captcha(captchaImage) {
    try {
      const solver = new Captcha.Solver('d47582b381fb7690ed580f75d5da15b9');
      const result = await solver.imageCaptcha(captchaImage);
      return result.data;
    } catch (err) {
      this.onError(new Error('Captcha Failed!'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @protected
   * @param {object} siteDetails
   * @return {Promise<object>}
   */
  async solveAmazonCaptcha({
    websiteURL, challengeScript, captchaScript, websiteKey, context, iv,
  }) {
    const API_KEY = 'd47582b381fb7690ed580f75d5da15b9';
    let solution;
    const createTaskResponse = await fetch(
      'https://api.2captcha.com/createTask',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientKey: API_KEY,
          task: {
            type: 'AmazonTaskProxyless',
            websiteURL,
            challengeScript,
            captchaScript,
            websiteKey,
            context,
            iv,
          },
        }),
      },
    );

    const createTaskResponseJSON = await createTaskResponse.json();
    await new Promise((resolve) => {
      (async () => {
        if (
          !createTaskResponseJSON.errorId
  && !!createTaskResponseJSON
  && createTaskResponseJSON.taskId
  && !createTaskResponseJSON.status
        ) {
          while (
            !!createTaskResponseJSON
    && createTaskResponseJSON.taskId
    && !createTaskResponseJSON.status
          ) {
            try {
              const getTaskResultResponse = await fetch(
                'https://api.2captcha.com/getTaskResult',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    clientKey: API_KEY,
                    taskId: createTaskResponseJSON.taskId,
                  }),
                },
              );

              const getTaskResultResponseJSON = await getTaskResultResponse.json();
              if (
                getTaskResultResponseJSON.status === 'ready'
      && !!getTaskResultResponseJSON.solution
              ) {
                solution = getTaskResultResponseJSON.solution;
                resolve();
                break;
              } else if (getTaskResultResponseJSON.errorId) {
                resolve();
                break;
              }
            } catch (error) {
              solution = solution || null;
            }
          }
        } else {
          resolve();
        }
      })();
    });
    return solution;
  }
}

module.exports = Provider;
