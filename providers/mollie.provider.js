const { parse } = require('date-fns');
const fs = require('fs/promises');
const Provider = require('./provider');

class MollieProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Mollie';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://api.mollie.com/v2/invoices';

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[]>}
   */
  async fetch() {
    const invoiceList = await this.getInvoiceList();
    const normalizedInvoiceList = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(normalizedInvoiceList);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: `${invoice.description}.pdf`,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<{issuedAt: String, lines: {description: String}[], _links: {pdf: String} }[]>}
   */
  async getInvoiceList() {
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.ws.password}` },
    });
    if (response.status === 401) {
      this.onError(new Error(`${this.baseUrl} Request failed. Status ${response.statusText}`));
      throw new Error('authenticationFailed');
    }
    if (response.ok) {
      const data = await response.json();
      const invoices = data?._embedded?.invoices || [];
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    }
    this.onError(new Error(`${this.baseUrl} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{ issuedAt:String, _links: {pdf: {href: String}}}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.reference,
      date: this.parseDate(invoice.issuedAt),
      link: this.getLink(invoice),
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return parse(date, 'yyyy-MM-dd', new Date());
  }

  /**
   * @private
   * @param {{ _links: { pdf: String}}} invoice
   * @return {string}
   */
  getLink(invoice) {
    return invoice?._links?.pdf?.href || '';
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    const response = await fetch(link);
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
}

module.exports = MollieProvider;
