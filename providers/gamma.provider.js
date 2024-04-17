const { isAfter, startOfDay } = require('date-fns');
const fs = require('fs/promises');
const Provider = require('./provider');

class GammaProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Gamma';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.gamma.nl/inloggen';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijn.gamma.nl/mijn-aankopen/';

  /**
   * @private
   * @type {string}
   */
  downloadLinkPrefix = 'https://mijn.gamma.nl/api/receipts/pdf/';

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
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getDownload(invoice);
          this.updateFetchStatus(invoiceList.length);
          return {
            ...invoice,
            description: invoice.invoiceId,
            date: this.formatDate(invoice.date),
            download,
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
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      from = new Date(year - 1, month, day);
    } else {
      from = startOfDay(new Date(this.filters.from));
    }
    return isAfter(currentEarliestDate, from);
  }

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
    let invoiceList = [];
    let dates = [];
    try {
      while (dates.length === 0 || this.isLoadMore(dates[dates.length - 1])) {
        if (dates.length !== 0) {
          await this.page.click('.sc-dmXWDj.dbNmPz');
          await this.page.waitForTimeout(2000);
        }
        invoiceList = Array.from(await this.page.$$('a[data-testid="purchase-card"]'));
        dates = await Promise.all(invoiceList.map(async (invoice) => {
          const elements = await invoice.$$('div.font-primary');
          const date = await elements[0].textContent();
          return this.parseDate(date.trim());
        }));
      }
      const invoiceIds = await Promise.all(invoiceList.map(async (invoice) => {
        const hrefValue = await invoice.getAttribute('href');
        const id = hrefValue.split('/')[2];
        return id;
      }));
      return dates.map((date, index) => ({
        date,
        invoiceId: invoiceIds[index],
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
      await this.page.waitForURL(this.authUrl, { waitUntil: 'load' });
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
      email: 'input[type="email"]',
      password: 'input[type="password"]',
      nextButton: 'button[data-testid="login-next"]',
      submitButton: 'button[data-testid="login-submit"]',
    };

    try {
      await this.goToLogin();
      await this.page.waitForTimeout(5000);
      const {
        email,
        password,
        nextButton,
        submitButton,
      } = selectors;

      await this.page.fill(email, this.ws.username);
      try {
        await this.page.click(nextButton);
      } catch (error) {
        this.authError = true;
        throw new Error('authentificationFailed');
      }
      await this.page.waitForTimeout(1000);
      await this.page.fill(password, this.ws.password);
      await this.page.click(submitButton);
      await this.page.waitForLoadState('load');
      await this.page.waitForTimeout(5000);
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

  async getDownload(invoice) {
    const { invoiceId } = invoice;
    let link;
    if (invoiceId.length > 16) {
      link = this.downloadLinkPrefix + invoiceId;
    } else {
      link = `https://mijn.gamma.nl/api/orders/${invoiceId}/invoice`;
    }
    const ctx = this.page.context();
    const page = await ctx.newPage();
    const downloadPromise = page.waitForEvent('download');
    try {
      await page.goto(link);
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return download;
    } catch (err) {
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
  }
}

module.exports = GammaProvider;
