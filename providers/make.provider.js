const fs = require('fs/promises');
const Provider = require('./provider');

class MakeProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Make';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.make.com/en/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://eu2.make.com/organization/ORGANIZATION_ID/payments';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://eu2.make.com/api/v2/organizations/ORGANIZATION_ID/payments';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  clientId = undefined;

  /**
   * @private
   * @type {string}
   */
  xAndroidDevice = undefined;

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
      username: 'input[name="email"]',
      password: 'input[name="password"]',
      submitButton: 'button[type="submit"]',
      errorMessage: 'button[data-dismiss="alert"]',
    };
    try {
      await this.page.goto(this.authUrl);
      const {
        username, password, submitButton, errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      const regex = /^https:\/\/eu2.make.com\/organization\/(\d+)\/dashboard$/;
      try {
        await this.page.waitForURL(
          regex,
          { timeout: 50000 },
        );
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) throw new Error('Auth failed');
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
      const [, clientId] = this.page.url().match(regex) || [];
      this.clientId = clientId;
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
    let hasGottenXAndroidDevice = false;
    // Intercept network requests
    await this.page.route('**/*', (route) => {
      if (!hasGottenXAndroidDevice) {
        const headers = route.request().headers();
        if (!!headers && typeof headers['x-android-device'] === 'string') {
          this.xAndroidDevice = headers['x-android-device'];
          hasGottenXAndroidDevice = true;
        }
      }
      // Continue with the request
      route.continue();
    });
    // Create a promise to resolve when the response is received
    const responsePromise = this.page.waitForResponse(
      (response) => response.url().startsWith(this.invoiceListUrl.replace(
        'ORGANIZATION_ID',
        this.clientId,
      )),
    );
    // Navigate to a web page
    await this.page.goto(
      this.invoiceUrl.replace(
        'ORGANIZATION_ID',
        this.clientId,
      ),
      { timeout: 50000 },
    );
    // Wait for the response to the specific request
    const response = await responsePromise;

    if (response) {
      const data = await response.json();
      invoices = data.payments;
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
      description: invoice.invoice_number,
      fileName: invoice.invoice_number,
      invoiceId: invoice.id,
      date: new Date(invoice.created),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId) {
    const { cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const invoiceLoaderURL = `https://eu2.make.com/api/v2/organizations/ORGANIZATION_ID/invoice-url/${invoiceId}`.replace(
        'ORGANIZATION_ID',
        this.clientId,
      );
      const getInvoiceDownloadURL = await fetch(
        invoiceLoaderURL,
        {
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'no-cache',
            'imt-web-zone': 'production',
            pragma: 'no-cache',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-android-device': this.xAndroidDevice,
            cookie,
            Referer: this.invoiceUrl,
            'Referrer-Policy': 'same-origin',
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
        downloadURL = getInvoiceDownloadURLJSON.invoiceUrl;
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

module.exports = MakeProvider;
