const fs = require('fs/promises');
const Provider = require('./provider');

class PlugAndPayStoreProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Plug&Pay - Store';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://admin.plugandpay.nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://v2.plugandpay.nl/settings/license/invoices';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://api.plugandpay.nl/v2/invoices?page=1';

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

  xTenantId = '';

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
          const download = await this.getInvoiceDownload(
            invoice.description,
            invoice.downloadURL,
          );
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
      username: 'input[id="email"]',
      password: 'input[id="password"]',
      submitButton: 'button[id="login-btn"]',
      errorMessage: 'p.help.is-danger.inline',
    };

    try {
      await this.page.goto(this.authUrl);
      const {
        username, password, submitButton, errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL(
          'https://v2.plugandpay.nl/',
        );
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
      return this.authDone;
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
    const invoices = [];
    let hasExtractedInfoFromHeader = false;
    // Intercept network requests
    await this.page.route('**/*', (route) => {
      if (!hasExtractedInfoFromHeader) {
        const url = route.request().url();
        const method = route.request().method();
        const headers = route.request().headers();
        if (
          url === this.invoiceListUrl
          && method === 'GET'
          && headers['x-tenant-id']
        ) {
          this.xTenantId = headers['x-tenant-id'];
          hasExtractedInfoFromHeader = true;
        }
      }
      // Continue with the request
      route.continue();
    });
    // Create a promise to resolve when the response is received
    const invoiceListResponsePromise = this.page.waitForResponse(
      (response) => (response.url()) === this.invoiceListUrl,
    );
    // Navigate to a web page
    await this.page.goto(this.invoiceUrl);
    // Wait for the response to the specific request
    let hasMoreItems = true;
    const invoiceListResponse = await invoiceListResponsePromise;
    if (invoiceListResponse) {
      const data = await invoiceListResponse.json();
      hasMoreItems = !(!!data && !!data.meta && data.meta.current_page === data.meta.last_page);
      if (Array.isArray(data.data)) {
        data.data.forEach(({ id, invoice_number: invoiceNumber, invoice_date: invoiceDate }) => {
          invoices.push({
            description: invoiceNumber,
            fileName: invoiceNumber,
            date: new Date(invoiceDate),
            downloadURL: `https://v2.plugandpay.nl/orders/${id}/pdf`,
          });
        });
      }
    }
    let currentPage = 2;
    while (hasMoreItems) {
      const { cookie, userAgent } = await this.getAuthAccess();
      const currentPageInvoiceListResponse = await fetch(this.invoiceListUrl.replace('page=1', `page=${currentPage}`), {
        headers: {
          accept: 'application/json',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'x-accept-language': 'NL',
          'x-requested-with': 'XMLHttpRequest',
          'x-tenant-id': this.xTenantId,
          cookie,
          Referer: 'https://v2.plugandpay.nl/',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'user-agent': userAgent,
        },
        body: null,
        method: 'GET',
      });
      if (currentPageInvoiceListResponse) {
        const data = await currentPageInvoiceListResponse.json();
        hasMoreItems = !(!!data && !!data.meta && data.meta.current_page === data.meta.last_page);
        if (Array.isArray(data.data)) {
          data.data.forEach(({ id, invoice_number: invoiceNumber, invoice_date: invoiceDate }) => {
            invoices.push({
              description: invoiceNumber,
              fileName: invoiceNumber,
              date: new Date(invoiceDate),
              downloadURL: `https://v2.plugandpay.nl/orders/${id}/pdf`,
            });
          });
        }
      }
      currentPage += 1;
    }
    return invoices;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList = (invoiceList) => (invoiceList.map((invoice) => invoice));

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    const { cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(downloadURL, {
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
          Referer: 'https://v2.plugandpay.nl/',
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

module.exports = PlugAndPayStoreProvider;
