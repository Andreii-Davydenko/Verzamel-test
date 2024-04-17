const Provider = require('./provider');

class WooCommerceProvider extends Provider {
  /**
   * @protected
   * @type {string}
   */
  name = '';

  /**
   * @protected
   * @type {string}
   */
  authUrl = '';

  /**
   * @protected
   * @type {string}
   */
  invoiceUrl = '';

  /**
   * @protected
   * @type {string}
   */
  usernameSelector = '';

  /**
   * @protected
   * @type {string}
   */
  passwordSelector = '';

  /**
   * @protected
   * @type {string}
   */
  submitSelector = '';

  /**
   * @protected
   * @type {string}
   */
  tableSelector = '';

  /**
   * @protected
   * @type {string}
   */
  tableRowSelector = '';

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
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
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return new Date(date);
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForSelector(this.tableSelector);
      const invoiceHandles = await this.page.$$(this.tableRowSelector);
      const invoiceList = await Promise.all(invoiceHandles.map(async (invoiceHandle) => {
        const description = await this.getDescription(invoiceHandle);
        const date = await this.getDate(invoiceHandle);
        const href = await this.getHref(invoiceHandle);
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
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDescription(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('td.woocommerce-orders-table__cell-order-number a');
    return descriptionHandle && descriptionHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDate(invoiceHandle) {
    const dateHandle = await invoiceHandle.$('td.woocommerce-orders-table__cell-order-date time');
    return dateHandle && dateHandle.getAttribute('datetime');
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getHref(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('td.woocommerce-orders-table__cell-order-actions a.invoice');
    return descriptionHandle && descriptionHandle.getAttribute('href');
  }

  /**
   * @private
   * @param {{ href: String }} invoice
   * @return {Promise<import('playwright-core').Download>}
   */
  async getDownload(invoice) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.setAttribute('href', href);
        link.setAttribute('id', 'my-link');
        link.setAttribute('style', 'display:inline-block;width:10px;height:10px;');
        document.body.append(link);
      }, invoice.href);
      await page.locator('#my-link').click({ modifiers: ['Alt'] });
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
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator(this.usernameSelector).fill(this.ws.username);
      await this.page.locator(this.passwordSelector).fill(this.ws.password);
      this.page.locator(this.submitSelector).click();
      await this.page.waitForResponse((res) => {
        const requirements = [
          res.url().includes(this.authUrl),
          res.request().method() === 'POST',
          res.status() === 302,
        ];
        if (requirements.every((requirement) => !!requirement)) {
          this.onSuccess('Authentication complete');
          this.authDone = true;
          return true;
        }
        return false;
      }, { timeout: 3000 });
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = WooCommerceProvider;
