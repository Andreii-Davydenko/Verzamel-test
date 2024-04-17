const fs = require('fs/promises');
const { parse } = require('date-fns');
const Provider = require('./provider');

class ParkLineProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Park-line';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.park-line.nl/Epms/ClientPages/default.aspx';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijn.park-line.nl/Epms/ClientPages/client/client_invoices.aspx';

  /**
   * @private
   * @type {string}
   */
  downloadBaseUrl = 'https://mijn.park-line.nl/Epms/pdf/invoices/get.aspx?pdf=';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = true;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    try {
      await this.handle2FA(code);

      const invoiceList = await this.getInvoiceList();

      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      return await Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
        }
        currentDownloads += 1;

        const download = await this.getDownload(invoice.invoiceId);

        currentDownloads -= 1;

        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          description: invoice.invoiceId,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.invoiceId,
          wsName: this.ws.name,
        };
      }));
    } catch (err) {
      if (!this.authDone) throw err;
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('#otp_varification_table input[type="text"]').fill(code);

      const submitBtn = await this.page.locator('#ctl00_cphMain_UcUserLoginControl1_btnVerifyOtp');
      await this.page.evaluate(() => {
        document.querySelector('#ctl00_cphMain_UcUserLoginControl1_btnVerifyOtp').removeAttribute('disabled');
      });
      await submitBtn.click();

      await this.page.waitForLoadState('load');
      if (this.page.url() === this.authUrl) {
        throw new Error('2FA Verification Failed');
      }
      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: string, invoiceId: string}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl);

      const invoices = [];

      let hasNextPage = true;
      while (hasNextPage) {
        await this.page.waitForSelector('table.rgMasterTable');

        const thisPageInvoices = await this.page.evaluate(() => {
          const tableRows = Array.from(
            document.querySelectorAll('table.rgMasterTable tbody tr'),
          ).filter((row) => row.hasAttribute('id'));

          return tableRows.map((row) => {
            const columns = row.querySelectorAll('td');
            const date = columns[5].textContent.trim();
            const invoiceId = columns[1].querySelector('a.link').textContent.trim();

            return {
              invoiceId,
              date,
            };
          });
        });
        invoices.push(...thisPageInvoices);

        const nextPageButton = await this.page.$('input.rgPageNext');
        const onClickValue = await nextPageButton.getAttribute('onclick');
        if (onClickValue !== null) {
          hasNextPage = false;
          break;
        }
        await nextPageButton.click();
        await new Promise((resolve) => { setTimeout(resolve, 10000); });
      }
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      link: invoice.link,
      date: parse(invoice.date, 'd-M-yyyy', new Date()),
    }));
  }

  /**
   * @private
   * @param {{ href: String }} href
   * @return {Promise<import('playwright-core').Download>}
   */
  async getDownload(invoiceId) {
    const href = `${this.downloadBaseUrl}${invoiceId}`;

    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((url) => {
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.click();
      }, href);
      const download = await downloadPromise;
      const downloadPath = await download.path();

      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('input[type=text]').fill(this.ws.username);
      await this.page.locator('input[type=password]').fill(this.ws.password);
      await this.page.locator('input[type=button]').click();
      const invalid = await this.page.$('span#ctl00_cphMain_UcUserLoginControl1_lbErrorMessage');
      if (invalid) throw new Error('Auth failed');

      await this.page.locator('#otp_varification_table').isVisible();
      this.onSuccess('Verification code sent');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = ParkLineProvider;
