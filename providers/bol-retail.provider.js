const {
  format, subYears, subDays, isBefore,
} = require('date-fns');
const fs = require('fs/promises');
const Provider = require('./provider');

class BolRetailProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Bol Retail';

  /**
  * @private
  * @type {string}
  */
  baseUrl = 'https://api.bol.com/retailer/invoices';

  /**
  * @private
  * @type {string}
  */
  tokenUrl = 'https://login.bol.com/token?grant_type=client_credentials';

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @private
   * @type {number}
   */
  rateLimitRemaining = 24;

  /**
   * @private
   * @type {number}
   */
  rateLimitReset = 50;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[]>}
   */
  async fetch() {
    const token = await this.createToken();
    const invoiceList = await this.getInvoiceList(token);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    try {
      return this.runSequentially(
        invoiceListNormalized.map((invoice) => async () => {
          await this.checkRateLimit();
          const download = await this.getDownload(token, invoice.link);
          this.updateFetchStatus(invoiceList.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            fileName: `${invoice.description}`,
          };
        }),
      );
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<String>}
   */
  async createToken() {
    const authKey = this.ws.username.concat(':', this.ws.password);
    const encodedAuthKey = Buffer.from(authKey).toString('base64');
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${encodedAuthKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      const token = data?.access_token || null;
      this.onSuccess('Authentication complete', { token });
      return token;
    }
    this.onError(new Error(`${this.tokenUrl} Request failed. Status ${response.statusText}`));
    throw new Error('authenticationFailed');
  }

  /**
   * @private
   * @return {[{from: Date, to: Date},...*[]]}
   */
  getTimePeriods() {
    const to = this.filters?.to ? new Date(this.filters.to) : new Date();
    const from = this.filters?.from ? new Date(this.filters.from) : subYears(to, 1);
    let periods = [];
    let currentDate = to;
    do {
      const subDate = subDays(currentDate, 30);
      periods = [{ from: subDate, to: currentDate }, ...periods];
      currentDate = isBefore(subDate, from) ? from : subDate;
    } while (isBefore(from, currentDate));
    return periods;
  }

  /**
   * @private
   * @param {String} token
   * @return {Promise<{issueDate: Number, invoiceId: String}[]>}
   */
  async getInvoiceList(token) {
    try {
      const timePeriods = this.getTimePeriods();
      /**
       * @type {Promise<{issueDate: Number, invoiceId: String}[][]>}
       */
      const invoiceLists = await this.runSequentially(
        timePeriods.map((timePeriod) => async () => {
          await this.checkRateLimit();
          return this.getInvoiceListForTimePeriod(token, {
            from: format(timePeriod.from, 'yyyy-MM-dd'),
            to: format(timePeriod.to, 'yyyy-MM-dd'),
          });
        }),
      );
      const invoiceListFlat = invoiceLists.flatMap((item) => item);
      this.onSuccess('Collect invoice list complete', { invoiceListFlat });
      return invoiceListFlat;
    } catch (err) {
      this.onError(err);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} token
   * @param {{ from: String, to: String }} filter
   * @return {Promise<{ invoiceId: String, issueDate: String }[]>}
   */
  async getInvoiceListForTimePeriod(token, filter = {}) {
    const url = new URL(this.baseUrl);
    const params = new URLSearchParams({
      ...(filter.from && { 'period-start-date': filter.from }),
      ...(filter.to && { 'period-end-date': filter.to }),
    });
    url.search = params.toString();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.retailer.V9+json',
      },
    });
    this.setRateLimit(response.headers);
    if (response.ok) {
      const data = await response.json();
      return data?.invoiceListItems || [];
    }
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{ issueDate: Number, invoiceId: String } []} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceId,
      date: new Date(invoice.issueDate),
      link: `${this.baseUrl}/${invoice.invoiceId}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} token
   * @param {String} link
   * @return {Object}
   */
  async getDownload(token, link) {
    // get pdf file, accept application/vnd.retailer.V9+pdf
    await this.checkRateLimit();
    const response = await fetch(link, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.retailer.V9+pdf',
      },
    });
    this.setRateLimit(response.headers);
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
    if (response.status === 401) {
      this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
      throw new Error('authenticationFailed');
    }
    if (response.status === 429) {
      this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
      throw new Error('rateLimit');
    }
    this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @protected
   * @param {Number} time time in milliseconds
   */
  delay(time) {
    return new Promise(
      (resolve) => {
        setTimeout(resolve, time);
      },
    );
  }

  /**
   * @private
   * @param {Headers} headers
   */
  setRateLimit(headers) {
    this.rateLimitRemaining = Number(headers.get('x-ratelimit-remaining'));
    this.rateLimitReset = Number(headers.get('x-ratelimit-reset'));
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async checkRateLimit() {
    if (this.rateLimitRemaining < 5) {
      const time = (this.rateLimitReset + 3) * 1000;
      await this.delay(time);
    }
  }
}

module.exports = BolRetailProvider;
