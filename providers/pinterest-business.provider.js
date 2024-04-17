const fs = require('fs/promises');
const Provider = require('./provider');

class PinterestBusinessProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Pinterest - Business';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://ads.pinterest.com/login/';

  /**
   * @private
   * @type {string}
   */
  baseUrl = `https://ads.pinterest.com/advertiser/${this.ws.accountId}/billing/history`;

  /**
   * @private
   * @type {string}
   */
  downloadURL = `https://ads.pinterest.com/advertiser/${this.ws.accountId}/billing/`;

  /**
   * @private
   * @type {string}
   */
  invoiceURL = `https://api.pinterest.com/ads/v4/advertisers/${this.ws.accountId}/bills/?no_date_range=true`;

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
    let inv = [];
    try {
      inv = Promise.all(invoiceListFiltered.map(async (invoice, i) => {
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
    } catch (err) {
      await this.page.close();
      this.onError(
        new Error('failedToFetchInvoicesFromWebsite'),
      );
    }
    return inv;
  }

  /**
   * @private
   * @return {string}
   */
  async getToken() {
    await this.page.goto(this.baseUrl);
    const tokenValue = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === '_pinterest_sess')[0].value;
    return `_pinterest_sess=${tokenValue}`;
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
            Cookie: token,
            origin: 'https://ads.pinterest.com',
            referer: `https://ads.pinterest.com/advertiser/${this.ws.accountId}/billing/history`,
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            Host: 'api.pinterest.com',
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        invoices = data?.data || [];
        invoices = invoices.filter((invoice) => invoice.status === 'PAID');
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
      description: invoice.id,
      date: new Date(invoice.creation_date * 1000),
      link: this.downloadURL + invoice.id,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto(link, { waitUntil: 'load' });
      await page.waitForSelector('.printReceiptButton > .RCK');
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf();
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(pdf),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await page.close();
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
      await this.page.locator('#email').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('data-test-id=registerFormSubmitButton').click();
      const incorrect = await this.page
        .getByText('The password you entered is incorrect. Try again')
        .isVisible();
      if (incorrect) {
        await this.page.close();
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }
      const RateLimit = await this.page.getByText('Oops').isVisible();
      if (RateLimit) {
        await this.page.close();
        this.onError(new Error('RateLimit'));
        throw new Error('RateLimit');
      }
      await this.page.waitForURL(/(.)advertiser(.)/, { timeout: 50000 }).then(() => {
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

module.exports = PinterestBusinessProvider;
