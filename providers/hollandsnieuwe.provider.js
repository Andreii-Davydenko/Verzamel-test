const fs = require('fs/promises');
const Provider = require('./provider');

class HollandsnieuweProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Hollandsnieuwe';

  /**
  * @private
  * @type {string}
  */
  authUrl = 'https://www.hollandsnieuwe.nl/login';

  /**
  * @private
  * @type {string}.
  */
  invoiceUrl = 'https://www.hollandsnieuwe.nl/mijn-hollandsnieuwe/ACCOUNT_ID/facturen';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://www.hollandsnieuwe.nl/rest/v/1/client/mijn/profile/PROFILE_ID/subscription/ACCOUNT_ID/view/subscriptionview/fragment/expensesperperiod/variant/showExpenses';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  profileId = undefined;

  /**
   * @private
   * @type {string}
   */
  sentryBase = undefined;

  /**
   * @private
   * @type {string}
   */
  xAuthToken = undefined;

  /**
   * @private
   * @type {string}
   */
  baggage = undefined;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(invoice.invoiceId);
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    const selectors = {
      username: 'input#username',
      password: 'input#current-password',
      submitButton: 'button#login',
      errorMessage: '[data-qa="login-error-server"] > div.invalid-feedback.d-block > p',
      cookieNotice: 'div.cookie-consent.modal',
      cookieNoticeButton: 'div.cookie-consent__btn.d-flex.flex-wrap.align-items-center > button.btn.btn-secondary',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        username,
        password,
        submitButton,
        errorMessage,
        cookieNotice,
        cookieNoticeButton,
      } = selectors;
      const cookieNoticeActive = await this.page.locator(cookieNotice).isVisible();
      if (cookieNoticeActive) await this.page.locator(cookieNoticeButton).click();
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      const regex = /^https:\/\/www.hollandsnieuwe.nl\/rest\/v\/(\d+)\/client\/mijn\/profile\/(\d+)\/view\/profileview\/fragment\/subscriptionsfragment\/variant\/subscriptionsvariant$/;
      let didNotFindAccountIdOnList = true;
      const purchaseIDMap = {};
      try {
        const responsePromise = this.page.waitForResponse(
          (response) => regex.test(response.url()),
        );
        // Wait for the response to the specific request
        const response = await responsePromise;

        if (response) {
          const data = await response.json();
          if (data.attributes.subscriptionInfo && data.profileId) {
            this.profileId = data.profileId;
            data.attributes.subscriptionInfo.forEach(({ purchaseId } = {}) => {
              purchaseIDMap[purchaseId] = 1;
            });
            if (purchaseIDMap[this.ws.accountId] === 1) {
              didNotFindAccountIdOnList = false;
            }
          }
        }
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      if (didNotFindAccountIdOnList) {
        const invalidAccountIdError = new Error('invalidAccountId');
        await this.onPageError(invalidAccountIdError, this.page);
        throw invalidAccountIdError;
      } else {
        this.onSuccess('Authentication complete');
        this.authDone = true;
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getAuthCookie() {
    try {
      const thisPageURL = this.page.url();
      return (
        await this.page.context()
          .cookies())
        .filter(({ value, domain }) => !!value
        && thisPageURL
          .split('://')[1]
          .split('/')[0]
          .endsWith(domain))
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ');
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {cookie: String,userAgent: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    return { cookie, userAgent };
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    let invoices = [];
    let hasExtractedInfoFromHeader = false;
    // Intercept network requests
    await this.page.route('**/*', (route) => {
      if (!hasExtractedInfoFromHeader) {
        const headers = route.request().headers();
        if (
          !!headers
           && typeof headers['sentry-trace'] === 'string'
           && typeof headers['x-auth-token'] === 'string'
           && typeof headers.baggage === 'string'
        ) {
          const [sentryBase] = headers['sentry-trace'].split('-');
          this.sentryBase = sentryBase;
          this.xAuthToken = headers['x-auth-token'];
          this.baggage = headers.baggage;
          hasExtractedInfoFromHeader = true;
        }
      }
      // Continue with the request
      route.continue();
    });
    // Create a promise to resolve when the response is received
    const responsePromise = this.page.waitForResponse(
      (response) => response.url().startsWith(this.invoiceListUrl.replace(
        'PROFILE_ID',
        this.profileId,
      ).replace(
        'ACCOUNT_ID',
        this.ws.accountId,
      )),
    );
    // Navigate to a web page
    await this.page.goto(
      this.invoiceUrl.replace(
        'ACCOUNT_ID',
        this.ws.accountId,
      ),
      { timeout: 50000 },
    );
    // Wait for the response to the specific request
    const response = await responsePromise;

    if (response) {
      const data = await response.json();
      invoices = data.attributes.statements;
    }
    return invoices;
  }

  generateRandomSentry() {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';

    for (let i = 0; i < 16; i += 1) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      randomString += characters[randomIndex];
    }

    return randomString;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.statementId,
      fileName: invoice.statementNumber,
      invoiceId: invoice.statementId,
      date: new Date(invoice.statementPeriodStartDate),
    }));
  }

  async streamToBuffer(readableStream) {
    // Create a Uint8Array to store the chunks of data
    const chunks = [];

    // Create a readable stream reader
    const reader = readableStream.getReader();
    let notDone = true;
    try {
      while (notDone) {
        // Read the next chunk from the stream
        const { done, value } = await reader.read();
        // Check if the stream is done
        if (done) {
          break;
        }
        // Append the chunk to the array
        chunks.push(value);
      }
      return Buffer.from(
        Uint8Array.from(
          chunks.reduce(
            (acc, chunk) => [...acc, ...chunk],
            [],
          ),
        ),
      );
    } finally {
      notDone = false;
      // Release the reader's lock when done
      await reader.releaseLock();
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId) {
    const { cookie, userAgent } = await this.getAuthAccess();
    try {
      const response = await fetch(
        `https://www.hollandsnieuwe.nl/rest/v/1/client/mijn/profile/${
          this.profileId
        }/subscription/${
          this.ws.accountId
        }/statements/${
          invoiceId
        }/invoices/`,
        {
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
            baggage: this.baggage,
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sentry-trace': `${this.sentryBase}-${this.generateRandomSentry()}-0`,
            'x-auth-token': this.xAuthToken,
            cookie,
            Referer: this.invoiceUrl,
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'user-agent': userAgent,
          },
        },
      );
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return {
        buffer: await this.streamToBuffer(response.body),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (error) {
      this.onError(new Error(`'Error occurred:', ${error.message}`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = HollandsnieuweProvider;
