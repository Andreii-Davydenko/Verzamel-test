const fs = require('fs/promises');
const Provider = require('./provider');

class VodafoneZakelijkProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Vodafone Zakelijk';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.vodafone.nl/account/inloggen';

  /**
   * @private
   * @type {string}.
   */
  invoiceUrl = 'https://www.vodafone.nl/my/rekeningen';

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
   * @type {number}
   */
  accountId = undefined;

  /**
   * @private
   * @type {string}
   */
  accessToken = undefined;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = true;

  async waitForSelector(frameContext, selector, timeInMilliSeconds) {
    if (!frameContext || !(typeof frameContext.$$ === 'function')) {
      return false;
    }
    const numericTimeInMilliSeconds = Number(timeInMilliSeconds);
    const startTime = new Date();
    while (!(new Date() - startTime > (numericTimeInMilliSeconds || 60000))) {
      const targetOnFrame = await frameContext.$$(selector);
      if (!!targetOnFrame && targetOnFrame.length) {
        return true;
      }
    }
    return false;
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    const selectors = {
      codeInput: 'input[id="code"]',
      submitButton: 'button[data-cy="confirm-sms-token-form-submit-button"]',
      errorMessage: '[data-name="form_has_errors"]',
      cookieNoticeButton: 'button#onetrust-accept-btn-handler',
    };
    try {
      const {
        codeInput,
        submitButton,
        errorMessage,
        cookieNoticeButton,
      } = selectors;
      // this.authenticate
      await this.page.locator(codeInput).fill(code);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL('https://www.vodafone.nl/my');
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      try {
        await this.waitForSelector(this.page, cookieNoticeButton, 10000);
        const cookieNoticeActive = await this.page
          .locator(cookieNoticeButton)
          .isVisible();
        if (cookieNoticeActive) await this.page.locator(cookieNoticeButton).click();
      } catch (error) {
        // Can not complete cookie dialog
      }
      if (this.page.url().startsWith('https://www.vodafone.nl/my')) {
        this.onSuccess('Authentication complete');
        this.authDone = true;
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    if (!this.authDone) {
      await this.handle2FA(code);
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
      username: 'input[id="j_username"]',
      password: 'input[id="j_password"]',
      submitButton: 'button[id="loginFormSubmitButton"]',
      errorMessage: '[data-cy="login-form-error-messages"]',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        username,
        password,
        submitButton,
        errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL(/^https:\/\/www.vodafone.nl\/account\/extra-controle\/code-checken/);
      } catch (error) {
        if (this.page.url().startsWith('https://www.vodafone.nl/my')) {
          this.onSuccess('Authentication complete');
          this.authDone = true;
          return this.fetch.bind(this);
        }
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Verification code has been sent');
      return this.fetch.bind(this);
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
      return (await this.page.context().cookies())
        .filter(
          ({ value, domain }) => !!value
            && thisPageURL.split('://')[1].split('/')[0].endsWith(domain),
        )
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
    const specialRegExp = /^https:\/\/www.vodafone.nl\/rest\/my\/invoice\/([\d]{3,})\/billing-arrangement\/([\d]{3,})/;

    await this.page.goto(this.invoiceUrl);
    await this.page.waitForLoadState('domcontentloaded');
    // Intercept network requests

    await this.page.route('**/*', (route) => {
      if (!this.accessToken) {
        const theRequest = route.request();
        const url = theRequest.url();

        if (specialRegExp.test(url)) {
          const headers = theRequest.headers();
          const [, accessToken] = headers.authorization.split('Bearer ');
          this.accessToken = accessToken;
          const match = url.match(specialRegExp);
          if (match) {
            const [, profileId, accountId] = match || [];
            this.profileId = profileId;
            this.accountId = accountId;
          }
        }
      }
      // Continue with the request
      route.continue();
    });
    const responsePromise = this.page
      .waitForResponse(
        (response) => specialRegExp.test(response.url()),
      );
    // Navigate to a web page
    await this.page.goto(this.invoiceUrl);
    // Wait for the response to the specific request
    const response = await responsePromise;

    if (response) {
      const data = await response.json();
      invoices = data.data[0].invoices_type_bill;
    }
    return invoices;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.number,
      fileName: invoice.number,
      invoiceId: invoice.number,
      date: new Date(invoice.close_date),
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
        Uint8Array.from(chunks.reduce((acc, chunk) => [...acc, ...chunk], [])),
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
      // this.accessToken
      const response = await fetch(`https://www.vodafone.nl/rest/my/invoice/${this.profileId}/billing-arrangement/${this.accountId}/download/${invoiceId}?access_token=${this.accessToken}`, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          cookie,
          Referer: this.invoiceUrl,
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'user-agent': userAgent,
        },
        body: null,
        method: 'GET',
      });

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

module.exports = VodafoneZakelijkProvider;
