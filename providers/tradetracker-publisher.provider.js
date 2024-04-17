const { parse } = require('date-fns');
const Provider = require('./provider');

class TradetrackerPublisherProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'TradeTracker - Publisher';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://affiliate.tradetracker.com/financial/invoice';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://affiliate.tradetracker.com/financial/invoice';

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

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @public
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListFiltered = this.applyFilters(invoiceList);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          description: invoice.description,
          date: this.formatDate(invoice.date),
          download,
          fileName: download.suggestedFilename(),
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.waitForSelector('table.list-view-totals.table-totals');
      const invoiceLeftHandles = await this.page.$$('.grid-content-left table.list-view-totals.table-totals tbody tr');
      const invoiceRightHandles = await this.page.$$('.grid-content table.list-view-totals.table-totals tbody tr');
      const invoiceList = await Promise.all(invoiceLeftHandles.map(async (invoiceLeftHandle, i) => {
        const description = await this.getDescription(invoiceLeftHandle);
        const date = await this.getDate(invoiceLeftHandle);
        const href = await this.getHref(invoiceRightHandles[i]);
        return {
          description, href, date: this.parseDate(date), wsName: this.ws.name,
        };
      }));
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} dateString
   * @return {Date}
   */
  parseDate(dateString) {
    return parse(dateString, 'M/d/yy', new Date());
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDescription(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('td:nth-of-type(2)');
    return descriptionHandle && descriptionHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDate(invoiceHandle) {
    const dateHandle = await invoiceHandle.$('td:nth-of-type(3)');
    return dateHandle && dateHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getHref(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('td.action.last a[title="Download as PDF"]');
    return descriptionHandle && descriptionHandle.getAttribute('href');
  }

  async getDownload(invoice) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.setAttribute('href', `${href}`);
        link.click();
      }, invoice.href);
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', invoice);
      return download;
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('#submitLogin').click();
      await this.page.waitForURL(this.invoiceUrl, { timeout: 5000 });
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = TradetrackerPublisherProvider;
