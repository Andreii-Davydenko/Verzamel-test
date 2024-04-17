const fs = require('fs/promises');
const Provider = require('./provider');

class WPMLProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'WPML';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://wpml.org/account/';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://wpml.org/account/view_order/';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  clientId = undefined;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(invoice.fileName, invoice.downloadURL);
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    const selectors = {
      username: '#username',
      password: '#user_pass',
      submitButton: '#Login',
      errorMessage: '.woocommerce-error',
      profileView: '#content',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        username,
        password,
        submitButton,
        errorMessage,
        profileView,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForSelector(profileView, { waitUntil: 'domcontentloaded' });
        this.onSuccess('Authentication complete');
        this.authDone = true;
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl, { timeout: 50000, waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
    const invoices = await this.page.evaluate(() => {
      const ordersArray = [];
      const rows = document.querySelectorAll('.row:not(.row-head)');
      rows.forEach((row) => {
        const OrderNumber = row.querySelector('.order-number a').innerText.trim();
        ordersArray.push({
          orderNumber: OrderNumber,
          date: row.querySelector('.order-number time').innerText.trim(),
          amount: row.querySelector('.amount').innerText.trim(),
          description: row.querySelector('.order-product').innerText.trim(),
          downloadURL: `https://wpml.org/account/view_order/?order=${OrderNumber}&printable-version=${OrderNumber}`,
        });
      });
      return ordersArray;
    });
    return invoices;
  }

  convertDateFormat(date) {
    const ParsedDate = new Date(new Date(date).getTime() + 5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const SplitedDate = ParsedDate.split('-');
    const day = SplitedDate[2];
    const month = SplitedDate[1];
    const year = SplitedDate[0];

    const newDateFormat = `${month}/${day}/${year}`;

    return newDateFormat;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.description,
      fileName: invoice.orderNumber,
      date: new Date(this.convertDateFormat(invoice.date)),
      downloadURL: invoice.downloadURL,
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    try {
      await this.page.goto(downloadURL, { timeout: 50000, waitUntil: 'domcontentloaded' });
      await this.page.locator('#print-icon a').click();
      await this.page.waitForTimeout(5000);
      const arrayBuffer = await this.page.pdf({ format: 'A4' });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (error) {
      this.onError(new Error(`'Error occurred:', ${error.message}`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = WPMLProvider;
