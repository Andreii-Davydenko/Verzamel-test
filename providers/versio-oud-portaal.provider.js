const Provider = require('./provider');

class VersioOudPortaalProvider extends Provider {
  /**
  * @private
  * @type {string}
  */
  name = 'Versio - Oud portaal';

  /**
    * @private
    * @type {string}
    */
  authUrl = 'https://login.mijn.versio.nl/';

  /**
    * @private
    * @type {string}
    */
  invoiceUrl = 'https://www.versio.nl/customer/financial/invoices';

  /**
    * @private
    * @type {boolean}
    */
  authDone = false;

  /**
    * @public
    * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
    */
  async fetch() {
    try {
      await this.authenticate();
      const invoiceList = await this.getInvoiceList();
      const dateFilteredList = this.getPastOneYear(invoiceList);
      const invoiceListFiltered = this.applyFilters(dateFilteredList);
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
        };
      }));
    } catch (err) {
      if (!this.authDone) throw err;
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  getPastOneYear(invoices) {
    if (!this.filters?.to || !this.filters?.from) {
      const currentDate = new Date();
      const filteredInvoices = invoices.map((invoice) => {
        const timeDifference = currentDate - invoice.date;
        if (timeDifference <= 365 * 24 * 60 * 60 * 1000) {
          return invoice;
        }
        return null;
      }).filter((invoice) => invoice !== null);
      return filteredInvoices;
    }
    return invoices;
  }

  /**
     * @private
     * @param {String} date
     * @return {Date}
     */
  parseDate(date) {
    const [day, month, year] = date.split('-');
    const parsedDate = `${month}-${day}-${year}`;
    const d = new Date(parsedDate.toLocaleString('en-US', { timeZone: 'GMT' }));
    return d;
  }

  /**
     * @private
     * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
     */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'domcontentloaded' });

      const cookieBtn = this.page.locator('input[value="Cookies accepteren"]');
      if (await cookieBtn.isVisible()) {
        await cookieBtn.click();
      }

      await this.page.waitForSelector('table.ps-container');
      const invoiceTable = await this.page.$$('table tbody tr:not(:first-child)');
      return await Promise.all(invoiceTable.map(async (invoice) => {
        const tdElements = await invoice.$$('td');

        const tdData = await Promise.all(tdElements.map(async (td) => {
          const textContent = await td.textContent();
          return textContent.trim();
        }));
        return {
          link: `https://www.versio.nl/customer/financial/invoice_pdf?id=${tdData[1]}`,
          fileName: tdData[1],
          date: this.parseDate(tdData[2]),
          wsName: this.ws.name,
          description: tdData[1],
        };
      }));
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
     * @private
     * @param {{ link: String }} invoice
     * @return {Promise<import('playwright-core').Download>}
     */
  async getDownload(link) {
    try {
      const ctx = this.page.context();
      const page = await ctx.newPage();
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const linkEl = document.createElement('a');
        linkEl.setAttribute('href', href);
        linkEl.click();
      }, link);

      const download = await downloadPromise;
      await download.path();
      await page.close();

      this.onSuccess('PDF prefetch complete', { link });
      return download;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
     * @private
     * @return {Promise<void>}
     */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl, { waitUntil: 'domcontentloaded' });

      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('button[type=submit]').click();

      await this.page.waitForURL('https://www.versio.nl/customer/');

      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = VersioOudPortaalProvider;
