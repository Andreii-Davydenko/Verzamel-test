/* eslint-disable max-len */
const fs = require('fs/promises');
const Provider = require('./provider');

class SpotifyProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Spotify';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://accounts.spotify.com/nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.spotify.com/nl/account/order-history/subscription/';

  /**
    * @private
    * @type {boolean}
    */
   authDone = false;

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const { download, invoiceNumber } = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.description,
          fileName: invoiceNumber,
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{status:string, date:string, description:string, wsName:string, href:string }[]} invoiceList
   * @return {{ status:string, date:Date, description:string, wsName:string, href:string }[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => {
      const [day, month, year] = invoice.date.split('-');
      return {
        status: invoice.status,
        date: new Date(`${month}-${day}-${year}`),
        description: invoice.description,
        link: `https://www.spotify.com/${invoice.href}`,
        wsName: this.ws.name,
      };
    });
  }

  /**
   * @private
   * @return {Promise<{status:string, date:string, description:string, wsName:string, href:string }[]>}}
   */
  async getInvoiceList() {
    try {
      const invoiceList = [];
      await this.page.goto(this.invoiceUrl);
      while (true) {
        await this.page.waitForSelector('[data-encore-id="buttonTertiary"]');
        const invoiceHandles = await this.page.$$('tbody tr');
        await Promise.all(invoiceHandles.map(async (invoiceHandle) => {
          const date = await invoiceHandle.$eval('td:nth-child(1) span', (e) => e.textContent.trim());
          const status = await invoiceHandle.$eval('td:nth-child(4) span', (e) => e.textContent.trim());
          const description = await invoiceHandle.$eval('td:nth-child(2) span', (e) => e.textContent.trim());
          const href = await invoiceHandle.$eval('td:nth-child(5) a', (e) => e.getAttribute('href'));
          invoiceList.push({
            date,
            status,
            description,
            wsName: this.ws.name,
            href,
          });
        }));
        const nextPageButton = await this.page.$('[data-encore-id="buttonTertiary"]:nth-child(2)');
        const isDisabled = await nextPageButton.getAttribute('disabled');
        if (isDisabled !== null) {
          break;
        }
        await nextPageButton.click();
      }
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.page.close();
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
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
      await page.waitForSelector('div div div .encore-dark-theme');
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
      const invoiceNumber = await page.$eval('tr:nth-child(2) td', (e) => e.textContent.trim());
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        download: {
          buffer: Buffer.from(pdf),
          async saveAs(path) {
            await fs.writeFile(path, this.buffer);
          },
        },
        invoiceNumber,
      };
    } catch (err) {
      await page.close();
      this.onError(
        new Error(`${link} Request failed. xxx`),
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
      await this.page.locator('#login-username').fill(this.ws.username);
      await this.page.locator('#login-password').fill(this.ws.password);
      await this.page.locator('#login-button').click();
      await this.page.waitForURL();
      await this.page.waitForLoadState('networkidle');
      if (this.page.url() !== 'https://accounts.spotify.com/nl/status') {
        this.onError(new Error('Auth failed. Wrong Username/Email'));
        throw new Error('authenticationFailed');
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = SpotifyProvider;
