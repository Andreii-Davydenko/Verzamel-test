const fs = require('fs/promises');
const Provider = require('./provider');

class CalendlyProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Calendly';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://calendly.com/app/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://calendly.com/app/admin/billing';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://calendly.com/api/billing/subscription/transaction_history';

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
      username: 'input[type="email"]',
      password: 'input[type="password"]',
      submitButton: 'form button[type="submit"]',
      errorMessage: 'form > div:first-child div:nth-child(3)',
    };
    try {
      await this.page.goto(this.authUrl);
      const {
        username, password, submitButton, errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(submitButton).click();
      await this.page.waitForURL(
        /^https:\/\/calendly\.com\/app\/login\?email=[a-zA-Z0-9%._-]+$/,
        { timeout: 50000 },
      );
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      const passwordError = await this.page.locator(errorMessage).isVisible();
      if (passwordError) throw new Error('Auth failed');
      await this.page.waitForURL('https://calendly.com/event_types/user/me');
      this.onSuccess('Authentication complete');
      this.authDone = true;
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
   * @return { {token: String, cookie: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    let token;
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    const csrfMetaElement = await this.page.$('meta[name="csrf-token"]');
    if (csrfMetaElement) {
      token = await csrfMetaElement.getAttribute('content');
    }
    return { token, cookie, userAgent };
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    let invoices = [];
    // Create a promise to resolve when the response is received
    const responsePromise = this.page.waitForResponse(
      (response) => response.url() === this.invoiceListUrl,
    );
    // Navigate to a web page
    await this.page.goto(this.invoiceUrl);
    // Wait for the response to the specific request
    const response = await responsePromise;

    if (response) {
      const data = await response.json();
      const mergerObject = {};
      data.invoices.forEach(({ id }, index) => {
        mergerObject[id] = index;
      });
      invoices = data
        .charges
        .filter(({ invoice_id: invoiceID } = {}) => !!invoiceID)
        .map((charge) => ({
          ...data.invoices[mergerObject[charge.invoice_id]],
          ...charge,
        }));
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
      description: `${invoice.title} - ${invoice.invoice_id}`,
      fileName: invoice.invoice_id,
      date: new Date(invoice.transacted_on),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId) {
    const { token, cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const getInvoiceDownloadURL = await fetch(
        `https://calendly.com/api/billing/subscription/invoices/${invoiceId}/download`,
        {
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-ch-ua':
              '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-csrf-token': token,
            'x-requested-with': 'XMLHttpRequest',
            cookie,
            Referer: this.invoiceUrl,
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'user-agent': userAgent,
          },
          body: null,
          method: 'GET',
        },
      );
      let downloadURL;
      if (!getInvoiceDownloadURL.ok) {
        const invoiceDownloadNotFound = new Error('Invoice download not found');
        this.onError(invoiceDownloadNotFound);
        throw invoiceDownloadNotFound;
      } else {
        const getInvoiceDownloadURLJSON = await getInvoiceDownloadURL.json();
        downloadURL = getInvoiceDownloadURLJSON.download_url;
      }
      const response = await fetch(downloadURL, {
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

module.exports = CalendlyProvider;
