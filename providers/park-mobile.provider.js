const fs = require('fs/promises');
const Provider = require('./provider');

class Parkmobile extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Parkmobile';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://account.parkmobile.com/login';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://nl.parkmobile.com/api';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {string}
   */
  token = '';

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = true;

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    await this.handle2FA(code);
    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
      return Promise.all(invoiceListFiltered.map(async (invoice, i) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoiceList[i].invoiceId.toString(),
        };
      }));
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]>}
   */
  async getInvoiceList() {
    const response = await fetch(`${this.baseUrl}/account/invoices/1/1000`, {
      method: 'GET',
      headers: { Pmauthenticationtoken: this.token },
    });
    if (response.ok) {
      const data = await response.json();
      const invoices = data?.invoices || [];
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    }
    this.onError(new Error(`${this.baseUrl}/account/invoices/1/1000 Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.title,
      date: new Date(invoice.generationDate),
      link: `${this.baseUrl}${invoice.documentUrl}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Object}
   */
  async getDownload(link) {
    const response = await fetch(link, {
      method: 'GET',
      headers: { Pmauthenticationtoken: this.token },
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
    this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('input#mfaPin').fill(code);
      await this.page.locator('button[type="submit"]').click();
      await this.page.waitForRequest(async (req) => {
        if (!req.url().includes('https://nl.parkmobile.com/api/account/identify')) return false;
        this.token = await req.headerValue('Pmauthenticationtoken');
        return true;
      });
      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError((new Error('2FA Verification Failed')), this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @public
   * @return {Promise<string>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('#login_password').fill(this.ws.password);
      await this.page.locator('button[type=submit]').click();
      await this.page.waitForURL('https://account.parkmobile.com/mfa');
      this.onSuccess('Verification code sent');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError((new Error('authenticationFailed')), this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = Parkmobile;
