const fs = require('fs/promises');
const Provider = require('./provider');

class PixlrProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Pixlr';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://pixlr.com';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://pixlr.com/nl/myaccount';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://pixlr.com/myaccount/invoice/';

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    await this.authenticate();
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          fileName: invoice.id,
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{ transId:string, dateStart:string, productName:string }[]} invoiceList
   * @return {{ id: String, description: String, date: Date, link: String, wsName: String }[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      id: invoice.transId,
      description: invoice.productName,
      date: new Date(invoice.dateStart),
      link: `${this.baseUrl}?transId=${invoice.transId}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @return {Promise<{ transId:string, dateStart:string, productName:string }[]>}
   */
  async getInvoiceList() {
    let invoiceList;
    try {
      this.page.goto(this.invoiceUrl);
      await this.page.waitForResponse(async (res) => {
        if (res.url().includes('/api/subscription/active') && res.status() === 200) {
          const { data } = await res.json();
          invoiceList = data?.transId || [];
          return true;
        }
        return false;
      });
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
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
      await page.goto(link);
      await page.waitForSelector('#invoice-breakdown');
      const buffer = await page.pdf();
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer,
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('div#head-login').click();
      await this.page.waitForSelector('div#entry-pop-right');
      await this.page.locator('div#entry-pop-right a#choose-email').click();
      await this.page.waitForSelector('form#entry-form');
      await this.page.locator('form#entry-form input#entry-email').fill(this.ws.username);
      await this.page.locator('form#entry-form input#entry-password').fill(this.ws.password);
      this.page.locator('button#entry-submit').click();
      await this.page.waitForResponse(async (res) => {
        const requirements = [
          res.url() === 'https://pixlr.com/auth/login',
          res.request().method() === 'POST',
          res.status() === 200,
        ];
        if (requirements.every((requirement) => !!requirement)) {
          const data = await res.json();
          if (data.status) {
            this.onSuccess('Authentication complete');
            this.authDone = true;
            return true;
          }
        }
        return false;
      }, { timeout: 3000 });
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = PixlrProvider;
