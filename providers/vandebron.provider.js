const { isAfter, startOfDay } = require('date-fns');
const Provider = require('./provider');

class VandebronProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Vandebron';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.vandebron.nl/thuis/financieel';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijn.vandebron.nl/thuis/financieel';

  /**
   * @private
   * @type {string}
   */
  downloadLinkPrefix = 'https://mijn.vandebron.nl/api/v1/organizations/ec8baa08-1373-45a1-9696-a79d0139a7f1/invoices/8adadf60-005e-4c39-b9b3-b1300051da02/download';

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

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
    try {
      await this.authenticate();
      await this.page.waitForSelector(
        'div.BoxShadow-module__box-shadow > table',
      );
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          this.updateFetchStatus(invoiceList.length);
          return {
            ...invoice,
            description: invoice.invoiceId,
            date: this.formatDate(invoice.date),
            download: invoice.download,
            fileName: invoice.invoiceId,
            wsName: this.ws.name,
          };
        }),
      );
      return invoiceData;
    } catch (error) {
      if (this.authError) {
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      await this.page.close();
    }
  }

  /**
   * @protected
   * @param {Date} currentEarliestDate
   * @return {Boolean}
   */
  isLoadMore(currentEarliestDate) {
    let from;
    if (!this.filters?.from) {
      const currentDate = new Date();
      const day = currentDate.getDate();
      const month = currentDate.getMonth();
      const year = currentDate.getFullYear();
      from = new Date(Date.UTC(year - 1, month, day));
    } else {
      from = startOfDay(new Date(this.filters.from));
    }
    return isAfter(currentEarliestDate, from);
  }

  parseDate(dateString) {
    const dateObj = new Date(dateString);
    if (Number.isNaN(dateObj.getTime())) {
      return null;
    }
    const year = dateObj.getUTCFullYear();
    const month = dateObj.getUTCMonth();
    const day = dateObj.getUTCDate();
    return new Date(Date.UTC(year, month, day));
  }

  /**
   * @private
   * @return {Promise<Awaited<{invoiceId: *, date: *}>[]>}
   */
  async getInvoiceList() {
    let invoiceIds = [];
    let invoiceList = [];
    let dates = [];
    const downloads = [];
    try {
      while (dates.length === 0 || this.isLoadMore(dates[dates.length - 1])) {
        if (dates.length !== 0) {
          await this.page.click(
            'div.Pagination-module__pagination.Pagination-module__small > button:last-child',
          );
          await this.page.waitForTimeout(2000);
        }
        invoiceList = Array.from(
          await this.page.$$(
            'div.BoxShadow-module__box-shadow > table > tbody > tr',
          ),
        );

        dates = dates.concat(
          await Promise.all(
            invoiceList.map(async (invoice) => {
              const element = await invoice.$$('td:nth-child(3)');
              const date = await element[0].textContent();
              return this.parseDate(date.trim());
            }),
          ),
        );
        invoiceIds = invoiceIds.concat(
          await Promise.all(
            invoiceList.map(async (invoice) => {
              const element = await invoice.$$('td:nth-child(1)');
              const id = await element[0].textContent();
              return id;
            }),
          ),
        );
        /* eslint-disable no-loop-func */
        invoiceIds = invoiceIds.filter((_, index) => dates[index] !== null);
        dates = dates.filter((date) => date !== null);
        const buttons = await this.page.$$('div.BoxShadow-module__box-shadow > table > tbody > tr > td:nth-child(7) > button');
        /* eslint-disable no-restricted-syntax */
        for (const button of buttons) {
          const downloadPromise = this.page.waitForEvent('download', { timeout: 60000 });
          await button.click();
          const download = await downloadPromise;
          await download.path();
          this.onSuccess('PDF prefetch complete');
          downloads.push(download);
        }
      }
      return dates.map((date, index) => ({
        date,
        invoiceId: invoiceIds[index],
        download: downloads[index],
      }));
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async goToLogin() {
    try {
      await this.page.goto(this.authUrl);
      return true;
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      email: 'input[id="username"]',
      password: '#password',
      submitButton: '#login',
    };

    try {
      await this.goToLogin();
      await this.page.waitForTimeout(5000);
      const { email, password, submitButton } = selectors;
      await this.page.fill(email, this.ws.username);
      await this.page.fill(password, this.ws.password);
      try {
        await this.page.click(submitButton);
      } catch (error) {
        this.authError = true;
        throw new Error('authentificationFailed');
      }

      const currentUrl = this.page.url();

      if (currentUrl === this.authUrl) {
        this.authError = true;
        throw new Error('authentificationFailed');
      }

      this.onSuccess('Authentication complete');
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForURL(this.invoiceUrl, { waitUntil: 'load' });
      await this.page.waitForTimeout(7000);
    } catch (error) {
      this.authError = true;
      await this.onPageError(error, this.page);
      throw new Error(error);
    }
  }
}

module.exports = VandebronProvider;
