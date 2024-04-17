const Provider = require('./provider');

class YoufoneSimOnlyProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Youfone - Sim Only';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://my.youfone.nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://my.youfone.nl/facturen/sim-only';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}&
   */
  requires2FA = false;

  /**
   * @public
   * @param {String} code
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

      const invoiceData = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const invoice of invoiceListFiltered) {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);
        const invoiceDetails = {
          ...invoice,
          description: invoice.description,
          date: this.formatDate(invoice.date),
          download,
        };
        invoiceData.push(invoiceDetails);
      }

      return invoiceData;
    } catch (error) {
      if (this.authError) {
        throw new Error('authenticationFailed');
      }
      this.logger.error('Error: ', error.toString());
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(dateString) {
    const months = {
      januari: 0,
      februari: 1,
      maart: 2,
      april: 3,
      mei: 4,
      juni: 5,
      juli: 6,
      augustus: 7,
      september: 8,
      oktober: 9,
      november: 10,
      december: 11,
    };
    const [day, month, year] = dateString.split(' ');
    return new Date(year, months[month], day);
  }

  /**
   * @private
   * @return {Promise<Awaited<{invoiceId: *, date: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'networkidle' });

      const invoiceLocator = await this.page.locator(
        '.invoice__select mat-select',
      );

      if (await invoiceLocator.isEnabled()) {
        await invoiceLocator.click();
        await this.page
          .locator(`div mat-option:has-text("${this.ws.accountId}")`)
          .click();
      }

      const _customer = await this.page.evaluate(() => sessionStorage.getItem('_customer'));
      const _token = await this.page.evaluate(() => sessionStorage.getItem('_token'));

      const session = {
        _customer,
        _token,
      };

      const ctx = this.page.context();

      const invoiceRowsSelector = '.mdc-data-table__content tr';
      const invoiceCount = await this.page.locator(invoiceRowsSelector).count();

      const list = await this.page
        .locator(invoiceRowsSelector)
        .evaluateAll(async (node) => node.map((cell) => ({
          description: cell.querySelector('td:nth-child(2)')?.textContent,
          date: cell.querySelector('td:nth-child(1)')?.textContent,
        })));

      await this.page
        .locator('.mdc-data-table__content tr:nth-child(1) td:nth-child(4)')
        .click();

      list[0].link = this.page.url();
      const firstInvoice = list.shift();

      let promises;

      if (invoiceCount > 1) {
        promises = await list.map(async (element, index) => {
          const page = await ctx.newPage();

          await page.addInitScript((ses) => {
            Object.entries(ses).forEach(([key, value]) => {
              window.sessionStorage.setItem(key, value);
            });
          }, session);

          await page.goto(this.invoiceUrl, { waitUntil: 'networkidle' });

          const innerInvoiceLocator = await page.locator(
            '.invoice__select mat-select',
          );

          if (await innerInvoiceLocator.isEnabled()) {
            await innerInvoiceLocator.click();
            await page
              .locator(`div mat-option:has-text("${this.ws.accountId}")`)
              .click();
          }

          await page
            .locator(
              `.mdc-data-table__content tr:nth-child(${
                index + 2
              }) td:nth-child(4)`,
            )
            .click();

          return {
            description: element.description,
            date: element.date,
            link: await page.url(),
          };
        });
      }

      const invoiceList = await Promise.all(promises);
      invoiceList.unshift(firstInvoice);

      return invoiceList;
    } catch (err) {
      await this.onPageError(err.message, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const emailSelector = 'input[type="email"]';
    const passwordSelector = 'input[type="password"]';
    const submitButton = 'button[type="submit"]';
    const cookieButton = 'button[id="onetrust-accept-btn-handler"]';

    try {
      await this.page.goto(this.authUrl, { waitUntil: 'networkidle' });
      await this.page.locator(cookieButton).click();
      await this.page.fill(emailSelector, this.ws.username);
      await this.page.fill(passwordSelector, this.ws.password);
      await this.page.locator(submitButton).click();

      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(3000);

      let invalid = false;

      try {
        invalid = await this.page
          .getByText('Foutmelding bij het inloggen')
          .isVisible();
      } catch (e) {
        invalid = false;
      }

      if (invalid) {
        throw new Error('authenticationFailed');
      }

      await this.page.waitForURL('https://my.youfone.nl/**');

      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (error) {
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {String} link
   * @return {Promise<Object>}
   */
  async getDownload(link) {
    try {
      await this.page.goto(link, { waitUntil: 'networkidle' });
      const downloadPromise = this.page.waitForEvent('download');
      await this.page.locator('#download').click();
      const download = await downloadPromise;
      await download.path();
      this.onSuccess('PDF prefetch complete', link);
      return download;
    } catch (err) {
      await this.onPageError(err, this.page);
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
}

module.exports = YoufoneSimOnlyProvider;
