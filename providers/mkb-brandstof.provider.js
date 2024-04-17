const fs = require('fs/promises');
const Provider = require('./provider');

class MKBBrandstofProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'MKB Brandstof';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.mkb-brandstof.nl';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijn.mkb-brandstof.nl';

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
      const invoiceListFiltered = this.applyFilters(invoiceList);
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.href);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.invoiceNumber,
          fileName: invoice.invoiceNumber,
          download,
        };
      }));
    } catch (err) {
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
    const [day, month, year] = date.split('-');
    const parsedDate = new Date(`${month}-${day}-${year}`);
    return parsedDate;
  }

  /**
   * @private
   * @return {Promise<{
   *  status: string,
   *  date: string,
   *  wsName: string,
   *  href: string,
   *  invoiceNumber: string
   * }[]>}
   */
  async getInvoiceList() {
    try {
      const invoiceList = [];
      await this.page.waitForSelector('#PegaGadgetIfr', { timeout: 50000 });
      const iframe = await this.page.$('#PegaGadgetIfr');
      const iframeContent = await iframe.contentFrame();
      await iframeContent.waitForSelector('[data-role="tablist"]', { timeout: 50000 });
      await iframeContent.locator('h3:has-text("Facturen en betalingen")').click();
      await iframeContent.waitForSelector('select');
      const timeFilter = await iframeContent.$$('select option');
      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const time of timeFilter) {
        const timeValue = await time.evaluate((e) => e.textContent.trim());
        if (!timeValue.includes('maanden')) {
          await iframeContent.click('select');
          await iframeContent.selectOption('select', timeValue);
          await iframeContent.waitForFunction(
            () => document
              .querySelectorAll('[node_name="InvoiceOverviewItem"]').length === 0,
          );
          try {
            await iframeContent.waitForSelector(
              '[node_name="InvoiceOverviewItem"]',
              { timeout: 6000 },
            );
            await iframeContent.waitForTimeout(3000);
          } catch (error) {
            break;
          }
          const invoiceTables = await iframeContent.$$('[node_name="InvoiceOverviewItem"]');
          for (const table of invoiceTables) {
            await table.$eval('td:nth-child(7) a', (e) => e.click());
            await iframeContent.waitForTimeout(3000);
            await iframeContent.waitForSelector('#modaldialog_con iframe');
            const date = await iframeContent.$eval(
              '#modaldialog_con .item-2 .dataValueRead',
              (e) => e.textContent.trim(),
            );
            const status = await iframeContent.$eval(
              '#modaldialog_con .item-3 .dataValueRead',
              (e) => e.textContent.trim(),
            );
            const href = await iframeContent.$eval(
              '#modaldialog_con iframe',
              (e) => e.getAttribute('src'),
            );
            const invoiceNumber = await iframeContent.$eval(
              '#modaldialog_con .item-1 .dataValueRead',
              (e) => e.textContent.trim(),
            );
            invoiceList.push({
              date: this.parseDate(date),
              status,
              wsName: this.ws.name,
              href,
              invoiceNumber,
            });
            iframeContent.waitForTimeout(200);
            await iframeContent.$eval('#container_close', (e) => e.click());
            iframeContent.waitForTimeout(200);
          }
        }
      }
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
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
      await this.page.waitForSelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection');
      await this.page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection').click();
      await this.page.waitForSelector('#PegaGadgetIfr');
      const iframe = await this.page.$('#PegaGadgetIfr');
      const iframeContent = await iframe.contentFrame();
      await iframeContent.waitForSelector('.auth0-lock-widget');
      await iframeContent.locator('[name="username"]').fill(this.ws.username);
      await iframeContent.locator('[name="password"]').fill(this.ws.password);
      await iframeContent.locator('[name="submit"]').click();
      const invalidEmailType = await iframeContent
        .$eval('[name="username"]', (e) => e.getAttribute('aria-invalid'));
      if (invalidEmailType === 'true') {
        this.onError(new Error('Invalid Email Type'));
        throw new Error('authenticationFailed');
      }
      await iframeContent.waitForTimeout(10000);
      const incorrect = await iframeContent
        .locator('.auth0-global-message')
        .isVisible();
      if (incorrect) {
        this.onError(new Error('Wrong email or password'));
        throw new Error('authenticationFailed');
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    let arrayBuffer;
    try {
      const response = await fetch(link, {
        method: 'GET',
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      this.onError(
        new Error(`${link} Request failed.`),
      );
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = MKBBrandstofProvider;
