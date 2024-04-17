const fs = require('fs/promises');
const { isAfter } = require('date-fns');
const Provider = require('./provider');

class YellowbrickProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Yellowbrick';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://my.yellowbrick.nl/#/profile/payment';

  /**
   * @private
   * @type {string}
   */
  baseInvoicesUrl = 'https://my.yellowbrick.nl/api/search/billing/invoice/?includeHeaders=true&count=';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {String}
   */
  cookies = '';

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  /**
   * @public
   * @param {String}
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();
      this.cookies = await this.getAuthCookie();
      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      const invoiceData = await Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getInvoiceDownload(invoice.invoiceId, invoice.externalNumber);
        this.updateFetchStatus(invoiceListFiltered.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.externalNumber,
          download,
          fileName: invoice.invoiceId.toString(),
          wsName: this.ws.name,
        };
      }));
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      await this.page.close();
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      username: 'input[aria-label="Email, phone, customer number, or username"]',
      password: 'input[aria-label="Password"]',
      submitButton: 'button[id="login--button"]',
    };

    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForSelector(selectors.username);
      const {
        username,
        password,
        submitButton,
      } = selectors;
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      await this.page.locator(submitButton).click();
      await this.page.waitForURL(
        this.invoiceUrl,
        { waitUntil: 'domcontentloaded' },
      );
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (error) {
      await this.onPageError(error, this.page);
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
        .join(';') || '';
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {String}
   * @return {Promise<Response>}
   */
  async sendGetRequest(url) {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        pragma: 'no-cache',
        'sec-ch-ua': '" Not;A Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        Cookie: this.cookies,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Api-Caller': 'customer',
        'X-Mpp-Brand': 'yellowbrick',
      },
      body: null,
      method: 'GET',
    });
    return response;
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    let totalInvoices = 0;
    try {
      const responseWithTotal = await this.sendGetRequest(`${this.baseInvoicesUrl}1`);
      if (!responseWithTotal.ok) {
        this.onError('Failed to fetch invoices from website');
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      const responseTextWithTotal = await responseWithTotal.text();
      const { pagination } = JSON.parse(responseTextWithTotal);
      totalInvoices = pagination.totalResults;

      const invoicesResponse = await this.sendGetRequest(`${this.baseInvoicesUrl}${totalInvoices}`);
      if (!invoicesResponse.ok) {
        this.onError('Failed to fetch invoices from website');
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      const responseText = await invoicesResponse.text();
      const { response } = JSON.parse(responseText);
      const invoicesWithPdfStartDate = new Date('2022-02-15');
      const invoiceList = response
        .filter((invoice) => (isAfter(new Date(invoice.issueDate), invoicesWithPdfStartDate)));
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (error) {
      this.onError('Failed to fetch invoices from website');
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.id,
      externalNumber: invoice.externalNumber,
      date: new Date(invoice.issueDate),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, externalNumber) {
    let arrayBuffer;
    const link = `https://my.yellowbrick.nl/billing/invoice-pdf?invoiceId=${invoiceId}&invoiceNumber=${externalNumber}`;
    try {
      const response = await this.sendGetRequest(link);
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('Download complete', { invoiceId });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (error) {
      this.onError(new Error(`Failed to download invoice: ${invoiceId}`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = YellowbrickProvider;
