/* eslint-disable max-len */
const fs = require('fs/promises');
const Provider = require('./provider');

class ZapierProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Zapier';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://zapier.com/app/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://zapier.com/app/settings/billing';

  /**
   * @private
   * @type {boolean}
   */
  accountId = '';

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    await this.authenticate();
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        const invoiceName = this.getInvoice(invoice.link);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoiceName,
          fileName: invoiceName,
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{status:string, date:string, wsName:string, wsName:string, href:string }[]} invoiceList
   * @return {{ status:string, date:Date, wsName:string, wsName:string, href:string }[]}
   */
  normalizeInvoiceList(invoiceList) {
    // Ignore status 'Upcoming'
    const invoicesFiltered = invoiceList.filter((invoiceHandle) => invoiceHandle.status !== 'Upcoming');

    return invoicesFiltered.map((invoice) => ({
      status: invoice.status,
      date: new Date(invoice.date),
      link: `https://zapier.com${invoice.href}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @return {Promise<{status:string, date:string, wsName:string, wsName:string, href:string }[]>}}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForSelector('h2:text("Invoices")');
      const invoiceHandles = await this.page.$$('tbody tr');
      const invoiceList = Promise.all(invoiceHandles.map(async (invoiceHandle) => {
        const status = await this.getStatus(invoiceHandle);
        const date = await this.getDate(invoiceHandle);
        const href = await this.getHref(invoiceHandle);

        return {
          status, date, wsName: this.ws.name, href,
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
  async getStatus(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('td span.css-1josw2y-Text--paragraph3--neutral800');
    return descriptionHandle && descriptionHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getHref(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('a.css-16tlt0w-Link');
    return descriptionHandle && descriptionHandle.getAttribute('href');
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDate(invoiceHandle) {
    const dateHandle = await invoiceHandle.$('time');
    return dateHandle && dateHandle.getAttribute('datetime');
  }

  /**
   * @private
   * @param {String} link
   * @return {string}
   */
  getInvoice(link) {
    const invoiceSplited = link.split('/').slice(6, 7);
    return invoiceSplited.pop();
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto(link, { waitUntil: 'load' });
      await page.waitForSelector('.container');
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: 'A4',
        displayHeaderFooter: false,
        margin: {
          top: '10px',
          bottom: '10px',
          left: '10px',
          right: '10px',
        },
      });
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(pdf),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await page.close();
      this.onError(
        new Error(`${link} Request failed.`),
      );
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
      await this.page.locator('#login-email').fill(this.ws.username);
      await this.page.locator('#login-submit').click();
      const invalidEmail = await this.page.getByText("That Zapier account doesn't exist.").isVisible();
      if (invalidEmail) throw new Error('Invalid Email Address');

      await this.page.waitForURL();
      await this.page.locator('#login-password').fill(this.ws.password);
      await this.page.locator('#login-submit').click();
      const invalidPassword = await this.page.getByText('Password is incorrect.').isVisible();
      if (invalidPassword) throw new Error('Invalid Email Address');

      await this.page.waitForTimeout(6000);

      // Get account ID
      await this.page.goto('https://zapier.com/app/settings/profile');
      const url = this.page.url();
      const urlSplit = url.split('/');

      if (urlSplit.length === 7) {
        this.accountId = urlSplit.slice(5, 6);
        this.invoiceUrl = `https://zapier.com/app/settings/${urlSplit.slice(5, 6)}/billing`;
        this.onSuccess('Authentication complete');
      } else {
        throw new Error('Undefined Account ID');
      }

      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = ZapierProvider;
