const fs = require('fs/promises');
const Provider = require('./provider');

class OpenaiPlatformProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'OpenAI - Platform';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://platform.openai.com/login?launch';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://platform.openai.com/account/billing/history';

  /**
   * @private
   * @type {string}
   */
  invoiceURL = 'https://api.openai.com/dashboard/billing/invoices?system=api';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  count = 0;

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    await this.authenticate();
    const token = await this.getToken();
    const invoiceList = await this.getInvoiceList(token);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const inv = Promise.all(invoiceListFiltered.map(async (invoice, i) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoiceListFiltered[i].description.toString(),
        };
      }));
      await this.page.close();
      return inv;
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getToken() {
    await this.page.goto(this.baseUrl);
    const req = await this.page.waitForRequest((request) => request.url().includes('invoices'));
    const token = req.headers().authorization;
    this.onSuccess('Collect token complete', token);
    return token;
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<T[]>}
   */
  async getInvoiceList(token) {
    try {
      let invoices = [];
      const response = await fetch(
        this.invoiceURL,
        {
          method: 'GET',
          headers: {
            Authorization: token,
            origin: 'https://platform.openai.com',
            referer: 'https://platform.openai.com/',
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            Host: 'api.openai.com',
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        invoices = data?.data || [];
        this.onSuccess('Collect invoice list complete', invoices);
      }
      return invoices;
    } catch (err) {
      this.onError(
        new Error(
          `${this.invoiceURL} Request failed.`,
        ),
      );
      await this.page.close();
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {Array} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.number,
      date: new Date(invoice.created * 1000),
      link: invoice.pdf_url,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    let arrayBuffer;
    try {
      const response = await fetch(link, {
        method: 'GET',
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      this.onError(
        new Error(`${link} Request failed.`),
      );
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForURL(/(.)identifier(.)/);
      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('._button-login-id').click();
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('._button-login-password').click();
      const incorrect = await this.page
        .getByText('Wrong email or password')
        .isVisible();
      if (incorrect) {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }
      await this.page.waitForURL('https://platform.openai.com/apps').then(() => {
        this.onSuccess('Authentication complete');
        this.authDone = true;
        return true;
      });
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = OpenaiPlatformProvider;