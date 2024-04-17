const Provider = require('./provider');

class MoneybirdProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Moneybird';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://moneybird.com/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://moneybird.com/ACCOUNT_ID/settings';

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
   * @private
   * @return {Promise<boolean>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.type('input[id="email"]', this.ws.username);
      await this.page.type('input[id="password"]', this.ws.password);
      await this.page.click('button[type="submit"]');

      await new Promise((resolve) => { setTimeout(resolve, 1000); });

      const invalid = await this.page.getByText('Inloggen mislukt').isVisible();
      if (invalid) {
        this.authDone = false;
        throw new Error('failedToAuthenticate');
      }
      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{description:string,date:Date,link:string}[]>}
   */
  async getListOfInvoices() {
    const invoiceUrl = this.invoiceUrl.replace('ACCOUNT_ID', this.ws.accountId);
    try {
      if (this.page.url() === 'https://moneybird.com/user/mandatory_user_actions/check_user_details') {
        this.onSuccess('User action required');
        const userAction = await this.page.waitForSelector('a[title="Herinner mij over 1 week"]');
        if (await userAction.isVisible()) {
          await userAction.click();
        }
      }
      await this.page.goto(invoiceUrl);

      this.page.locator('a[title="Abonnementsfacturen"]').click();

      await this.page.waitForSelector('tbody.table__group tr.table__row');
      const tableRows = await this.page.$$('tbody.table__group tr.table__row');
      const promises = tableRows.map(async (row) => {
        const cells = await row.$$('td.table__cell');
        return {
          id: await (await cells[0].$('a')).innerText(),
          date: this.parseDate(await cells[2].evaluate((node) => node.innerText)),
          link: `${await cells[5].evaluate((node) => node.querySelector('a').getAttribute('href'))}`,
        };
      });

      const list = await Promise.all(promises);
      return list;
    } catch (err) {
      this.onError(new Error(`Current page url: ${this.page.url()}`));
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    const parts = date.split('-');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.id,
      date: invoice.date,
      link: invoice.link,
    }));
  }

  /**
   * @public
   * @return {Promise<Awaited<{description: *, date: *, download: *, fileName: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();
      const invoiceList = await this.getListOfInvoices();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 15;
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 300); });
        }
        currentDownloads += 1;
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);

        currentDownloads -= 1;

        return {
          ...invoiceListFiltered,
          description: invoice.description,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
          wsName: this.ws.name,
        };
      }));
    } catch (err) {
      if (!this.authDone) throw err;
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      // this.page.close();
    }
  }

  /**
   * @private
   * @return {String}
   */
  async getCookie(key) {
    const cookieValue = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === key)[0].value;
    return `${key}=${cookieValue};`;
  }

  /**
     * @private
     * @param {{ link: String }} link
     * @return {Promise<import('playwright-core').Download>}
     */
  async getDownload(invoiceLink) {
    const fullLink = `https://moneybird.com${invoiceLink}`;
    const ctx = this.page.context();
    const downloadPage = await ctx.newPage();
    try {
      const downloadPromise = downloadPage.waitForEvent('download');
      await downloadPage.evaluate(async (href) => {
        const link = await document.createElement('a');
        link.setAttribute('href', `${href}`);
        link.click();
      }, fullLink);

      const download = await downloadPromise;
      await download.path();
      await downloadPage.close();

      this.onSuccess('Download complete', invoiceLink);
      return download;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = MoneybirdProvider;
