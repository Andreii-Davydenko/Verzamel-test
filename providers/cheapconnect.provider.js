const { parse } = require('date-fns');
const Provider = require('./provider');

class CheapConnectProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'CheapConnect';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://account.cheapconnect.net/';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://account.cheapconnect.net/invoices.php';

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
    if (!this.authDone) {
      await this.authenticate();
    }

    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      return Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getDownload(invoice.fileName);
          this.updateFetchStatus(invoiceList.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
          };
        }),
      );
    } catch (err) {
      this.onError(new Error(err));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'domcontentloaded' });

      await this.page.locator('span.select2-selection').click();
      await this.page.locator('span.select2-results li:last-of-type').click();
      await this.page.waitForLoadState('domcontentloaded');

      const invoiceSelector = 'tbody tr';

      const list = await this.page
        .locator(invoiceSelector)
        .evaluateAll(async (node) => node.map((cell) => ({
          description: cell.querySelector('td:nth-child(1)')?.textContent,
          date: cell.querySelector('td:nth-child(2)')?.textContent,
          link: `https://account.cheapconnect.net${cell
            .querySelector('td:nth-child(4) a')
            .getAttribute('href')}`,
        })));

      return list;
    } catch (err) {
      await this.onPageError(err.message, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{description: String, date: String, link: String}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String, fileName: string}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.description,
      date: this.parseDate(invoice.date),
      link: invoice.link,
      wsName: this.ws.name,
      fileName: `${invoice.description}.pdf`,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @return {Promise<Object>}
   */
  async getDownload(fileName) {
    try {
      const downloadLink = `https://account.cheapconnect.net/invoices/${fileName}`;
      const ctx = this.page.context();
      const page = await ctx.newPage();
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const linkEl = document.createElement('a');
        linkEl.setAttribute('href', href);
        linkEl.setAttribute('id', 'my-invoice');
        linkEl.setAttribute(
          'style',
          'display:inline-block;width:1px;height:1px;',
        );
        document.body.append(linkEl);
      }, downloadLink);
      await page.locator('#my-invoice').click({ modifiers: ['Alt'] });
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', { downloadLink });
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
      await this.page.goto(this.authUrl, {
        timeout: 50000,
        waitUntil: 'domcontentloaded',
      });
      await this.page.locator('input#username').fill(this.ws.username);

      await this.page.locator('input#password').fill(this.ws.password);

      await this.page.locator('button#logindiv').click();

      await this.page.waitForTimeout(3000);

      let invalid = false;

      try {
        invalid = await this.page
          .getByText(' Gebruikersnaam en/of wachtwoord fout')
          .isVisible();
      } catch (e) {
        invalid = false;
      }

      if (invalid) {
        throw new Error('authenticationFailed');
      }

      await this.page.waitForLoadState('networkidle');

      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError(err.message, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return parse(date, 'dd-MM-yyyy', new Date());
  }
}

module.exports = CheapConnectProvider;
