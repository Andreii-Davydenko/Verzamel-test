/* eslint-disable linebreak-style */
/* eslint-disable max-len */
/* eslint-disable no-constant-condition */
const fs = require('fs/promises');
const Provider = require('./provider');

class Microsoft365PersonalProvider extends Provider {
  /**
  * @private
  * @type {string}
  */
  name = 'Microsoft 365 - Personal';

  /**
    * @private
    * @type {string}
    */
  baseUrl = 'https://account.microsoft.com/billing/orders';

  /**
    * @private
    * @type {string}
    */
  invoiceUrl = 'https://account.microsoft.com/billing/orders/list';

  /**
    * @private
    * @type {boolean}
    */
  authDone = false;

  /**
    * @private
    * @type {string | null}
    */
  sessionToken = null;

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
      const normalizedInvoiceList = await this.normalizeInvoiceList(invoiceList);
      const filteredInvoiceList = await this.filterInvoiceList(normalizedInvoiceList);
      const invoiceListFiltered = this.applyFilters(filteredInvoiceList.filter((value) => {
        if (value.href !== undefined) {
          return true;
        }
        return false;
      }));
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.href);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
        };
      }));
    } catch (err) {
      this.onError(new Error(err.message));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param invoiceList
   * @return {Promsise<Awaited<{description: String, date: Date, href: String, wsName: String}>[]>}
   */
  async filterInvoiceList(invoiceList) {
    if (this.filters?.to || this.filters?.from) return invoiceList;
    const currentDate = new Date();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    return invoiceList.filter((item) => {
      const itemDate = item.date;
      return itemDate >= twelveMonthsAgo && itemDate <= currentDate;
    });
  }

  /**
     * @private
     * @param {String} date
     * @return {Date}
     */
  /* eslint-disable object-property-newline */
  /* eslint-disable quote-props */
  parseDate(date) {
    const monthMappings = {
      'jan': 0, 'feb': 1, 'mrt': 2, 'mar': 2, 'apr': 3, 'mei': 4, 'may': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'okt': 9, 'oct': 9, 'nov': 10, 'dec': 11,
    };
    const [day, monthAbbrev, year] = date.split('-');
    const monthIndex = monthMappings[monthAbbrev.toLowerCase()];
    const fullYear = year.length === 2 ? `20${year}` : year;

    return new Date(fullYear, monthIndex, day);
  }

  /**
     * @private
     * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
     */
  async getInvoiceList() {
    const invoices = [];
    await this.page.goto('https://account.microsoft.com/billing/orders?period=AllTime&type=All', { waitUntil: 'domcontentloaded' });
    while (true) {
      try {
        const res = await this.page.waitForResponse((response) => response.url().startsWith(this.invoiceUrl), { timeout: 6000 });
        const data = await res.json();
        /* eslint-disable no-restricted-syntax */
        for (const invoice of data.orders) {
          invoices.push(invoice);
        }
      } catch (err) {
        // this.onSuccess('Collect invoice list complete', invoices);
        break;
      }
    }
    return invoices;
  }

  /**
   * @private
   * @param invoiceList
   * @return {Promsise<Awaited<{description: String, date: Date, href: String, wsName: String}>[]>}
   */
  async normalizeInvoiceList(invoiceList) {
    return Promise.all(invoiceList.map((invoice) => ({
      description: invoice.orderId,
      date: this.parseDate(invoice.localSubmittedDate),
      href: invoice.taxDocumentUrls[0],
      wsName: this.ws.name,
    })));
  }

  /**
     * @private
     * @param {{ link: String }} invoice
     * @return {Promise<import('playwright-core').Download>}
     */
  // eslint-disable-next-line consistent-return
  async getDownload(invoice) {
    const ctx = this.page.context();
    const page = await ctx.newPage();// Set a custom User-Agent header
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
      // eslint-disable-next-line quote-props
      'Referer': 'https://account.microsoft.com',
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 0 });
    try {
      await page.goto(invoice);
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', invoice);
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', invoice);
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async checkLogin() {
    try {
      await this.page.waitForLoadState('domcontentloaded');
      const selectors = [
        'input[data-report-event=Signin_Submit]',
        'a[id=iCancel]',
        'button[text=Continue]',
        'input[id=iLooksGood]',
      ];
      while (true) {
      // eslint-disable-next-line no-restricted-syntax
        for (const selector of selectors) {
          const pagec = this.page.locator(selector);
          if (pagec) {
            await pagec.click();
            break;
          }
        }
        await this.page.waitForTimeout(10000);
        const url = this.page.url();
        if (url.indexOf(this.baseUrl) !== -1) {
          await this.page.waitForLoadState('networkidle');
          break;
        }
      }
    } catch (err) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
    return true;
  }

  /**
   * @private
   * @param {{ link: String }} attr
   * @return {Promise<void>}
   */
  // eslint-disable-next-line consistent-return
  async checkIncorrectParam(attr) {
    try {
      const invalidParam = await this.page.waitForSelector(attr, { timeout: 15000 });
      if (await invalidParam.isVisible()) return true;
    } catch (err) {
      return false;
    }
  }

    /**
     * @private
     * @return {Promise<void>}
    */
  async authenticate() {
    try {
      await this.page.goto(this.baseUrl);
      await this.page.waitForURL();
      await this.page.locator('input[name=loginfmt]').fill(this.ws.username);
      await this.page.locator('input[data-report-event=Signin_Submit]').click();
      const invalidUsername = await this.checkIncorrectParam('div#usernameError');
      if (invalidUsername) throw new Error('Invalid Username/Email');

      await this.page.waitForURL('https://login.live.com/**');

      await this.page.locator('input[type=password]').fill(this.ws.password);
      await this.page.locator('input[data-report-event=Signin_Submit]').click();
      const invalidPassword = await this.checkIncorrectParam('div#passwordError');
      if (invalidPassword) throw new Error('Invalid Password');

      await this.page.waitForURL();
      await this.checkLogin();

      this.onSuccess('Authentication complete');
    } catch (err) {
      this.onPageError(err.message, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = Microsoft365PersonalProvider;