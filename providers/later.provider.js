const Provider = require('./provider');

class LaterProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Later';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://app.later.com/account/subscription/billing';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  /**
   * @public
   * @param {String}
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();
      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      const invoiceData = await Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getInvoiceDownload(invoice.link, invoice.date);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.invoiceId,
          download,
          fileName: invoice.invoiceId,
          wsName: this.ws.name,
        };
      }));
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      await this.page.close();
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      username: 'input[type="email"]',
      password: 'input[type="password"]',
      submitButton: 'button[data-test-id="login-form-submit-button"]',
    };

    try {
      await this.page.goto(this.invoiceUrl);
      const {
        username,
        password,
        submitButton,
      } = selectors;
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      await this.page.locator(submitButton).click();
      await this.page.waitForURL(
        this.invoiceUrl,
        { waitUntil: 'domcontentloaded' },
      );
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    try {
      await this.page.waitForSelector('table.qa--subscription__subSection-receipts');

      const invoicesList = await this.page.evaluate(() => {
        const tableRows = Array.from(
          document.querySelectorAll('table.qa--subscription__subSection-receipts tbody tr.qa--subscription__receipt'),
        );

        return tableRows.map((row) => {
          const columns = row.querySelectorAll('td');
          const date = columns[0].textContent.trim();
          const link = columns[4].querySelector('a.qa--subscription__button--download').href;

          return {
            date,
            link,
          };
        });
      });

      this.onSuccess('Collect invoice list complete', invoicesList);
      return invoicesList;
    } catch (error) {
      this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String}
   * @return {String}
   */
  getInvoiceId(link) {
    const match = link.match(/receipt_id=(in_\w+)/);
    return match ? match[1] : null;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: this.getInvoiceId(invoice.link),
      link: invoice.link,
      date: new Date(invoice.date),
    }));
  }

  /**
     * @private
     * @param {{ link: String }} link
     * @return {Promise<import('playwright-core').Download>}
     */
  async getInvoiceDownload(invoiceLink) {
    const ctx = this.page.context();
    const downloadPage = await ctx.newPage();
    try {
      const downloadPromise = downloadPage.waitForEvent('download');
      await downloadPage.evaluate(async (href) => {
        const link = await document.createElement('a');
        link.setAttribute('href', `${href}`);
        link.click();
      }, invoiceLink);

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

module.exports = LaterProvider;
