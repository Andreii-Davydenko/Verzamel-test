const fs = require('fs/promises');
const Provider = require('./provider');

class MyParcelProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Myparcel';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://backoffice.myparcel.nl/login';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://backoffice.myparcel.nl/api';

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
    const token = await this.authenticate();
    const invoiceList = await this.getInvoiceList(token);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link, token);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{id:number,invoice_date:string,number:string,shop_name:string}[]>}
   */
  async getInvoiceList(token) {
    const response = await fetch(`${this.baseUrl}/invoices`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.invoice_normal+json' },
    });
    if (response.ok) {
      const { data } = await response.json();
      const invoices = data?.invoices || [];
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    }
    this.onError(new Error(`${this.baseUrl} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{id:number,invoice_date:string,number:string,shop_name:string}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String, fileName: string}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.shop_name,
      date: new Date(invoice.invoice_date),
      link: `${this.baseUrl}/invoices/${invoice.id}`,
      wsName: this.ws.name,
      fileName: invoice.number,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Promise<String>}
   */
  async getDownloadLink(link, token) {
    const response = await fetch(link, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json.invoice_normal_pdf_link+json' },
    });
    if (response.ok) {
      const { data } = await response.json();
      const url = data?.pdfs?.url;
      this.onSuccess('Get PDF link complete', url);
      return url ? `${this.baseUrl}${url}` : '';
    }
    this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Promise<Object>}
   */
  async getDownload(link, token) {
    const downloadLink = await this.getDownloadLink(link, token);
    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: { Accept: '*/*' },
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      this.onSuccess('PDF prefetch complete', { downloadLink });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
    this.onError(new Error(`${downloadLink} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  async authenticate() {
    let token;
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('input.auth0-lock-input[name="username"]').fill(this.ws.username);
      await this.page.locator('input.auth0-lock-input[name="password"]').fill(this.ws.password);
      await this.page.locator('button.auth0-lock-submit[type="submit"]').click();
      await this.page.waitForResponse(async (res) => {
        if (!res.url().includes('https://account.myparcel.nl/oauth/token')) return false;
        const data = await res.json();
        if (!data.access_token) return false;
        token = data.access_token;
        this.onSuccess('Authentication complete');
        this.authDone = true;
        return true;
      });
      return token;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = MyParcelProvider;
