const fs = require('fs/promises');
const Provider = require('./provider');

class SimyoProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Simyo';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.simyo.nl/inloggen';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijn.simyo.nl/facturen';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://appapi.simyo.nl/webapi/api/v1/invoices/postpaid';

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

  sessionToken = '';

  xClientPlatform = '';

  xClientVersion = '';

  xClientToken = '';

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
          const download = await this.getInvoiceDownload(invoice.fileName);
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
      username: 'input#phonenumber',
      password: 'input#password',
      submitButton: 'button[data-test-id="submit-button"]',
      errorMessage: 'div.login__incorrect',
    };
    try {
      await this.page.goto(this.authUrl);
      const {
        username, password, submitButton, errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      const responsePromise = this.page.waitForResponse(
        (response) => response.url() === 'https://appapi.simyo.nl/webapi/api/v1/sessions',
      );
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL(
          'https://mijn.simyo.nl/',
        );
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      const response = await responsePromise;

      if (response) {
        const data = await response.json();
        if (data.result.sessionToken) {
          this.sessionToken = data.result.sessionToken;
          this.xClientPlatform = 'mijn';
          this.xClientVersion = '9.0.0';
          this.xClientToken = 'e77b7e2f43db41bb95b17a2a11581a38';
          this.onSuccess('Authentication complete');
          this.authDone = true;
          return this.authDone;
        }
      }
      throw new Error('authenticationFailed');
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
      return (await this.page.context().cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join(';');
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {cookie: String, userAgent: String} }
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
    // Create a promise to resolve when the response is received
    const invoiceListResponsePromise = this.page.waitForResponse(
      (response) => (response.url()) === this.invoiceListUrl,
    );
    // Navigate to a web page
    await this.page.goto(this.invoiceUrl);
    // Wait for the response to the specific request
    const invoiceListResponse = await invoiceListResponsePromise;
    if (invoiceListResponse) {
      const data = await invoiceListResponse.json();
      invoices = data.result.filter(({
        date,
        invoiceNumber,
      }) => (!!date
      && !!date.length
      && !Number.isNaN(Number(invoiceNumber))));
    }
    return invoices;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList = (invoiceList) => (invoiceList.map((invoice) => {
    const invoiceDateObject = new Date(invoice.date);
    return ({
      description: invoice.invoiceNumber,
      fileName: invoice.invoiceNumber,
      date: new Date(invoiceDateObject.getFullYear(), invoiceDateObject.getMonth(), 1),
    });
  }));

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId) {
    const { cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(`https://appapi.simyo.nl/webapi/api/v1/invoices/postpaid/${invoiceId}/download`, {
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,enq=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          cookie,
          'x-client-platform': this.xClientPlatform,
          'x-client-token': this.xClientToken,
          'x-client-version': this.xClientVersion,
          'x-session-token': this.sessionToken,
          Referer: 'https://mijn.simyo.nl/',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'user-agent': userAgent,
        },
        body: null,
        method: 'GET',
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return {
        buffer: Buffer.from(arrayBuffer),
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

module.exports = SimyoProvider;
