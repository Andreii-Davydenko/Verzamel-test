const fs = require('fs/promises');
const Provider = require('./provider');

class WHMCSProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'WHMCS';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.whmcs.com/members/clientarea.php';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.whmcs.com/members/clientarea.php?action=invoices';

  /**
   * @private
   * @type {string}
   */
  downloadLinkPrefix = 'https://www.whmcs.com/members/dl.php?type=i&id=';

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
          const downloadLink = this.downloadLinkPrefix + invoice.invoiceId;
          const download = await this.getDownload(downloadLink);
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
      this.logger.error('Error: ', error.toString());
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<Awaited<{invoiceId: *, date: *}>[]>}
   */
  async getInvoiceList() {
    await this.page.selectOption(
      'select[name="tableInvoicesList_length"]',
      '-1',
    );
    await this.page.waitForTimeout(1000);
    await this.page.waitForSelector('table#tableInvoicesList tbody tr');

    return this.page.evaluate(() => {
      const tableRows = Array.from(
        document.querySelectorAll('table#tableInvoicesList tbody tr'),
      );

      return tableRows.map((row) => {
        const columns = row.querySelectorAll('td');
        const invoiceId = columns[0].textContent.trim();
        const date = columns[1].querySelector('span.hidden').textContent.trim();
        const formattedDate = new Date(date);

        return {
          invoiceId,
          date: formattedDate,
        };
      });
    });
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
      submitButton: 'input[type="submit"]',
    };

    try {
      await this.goToLogin();
      const { email, password, submitButton } = selectors;
      await this.page.type(email, this.ws.username);
      await this.page.type(password, this.ws.password);
      await this.page.click(submitButton);

      await this.page.waitForLoadState('load');
      const currentUrl = await this.page.url();
      const urlParams = this.getURLParams(currentUrl);

      if (urlParams && urlParams.incorrect === 'true') {
        this.authError = true;
        await this.onPageError('Error: authenticationFailed', this.page);
        throw new Error();
      }
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForURL(this.invoiceUrl, { waitUntil: 'load' });
      this.onSuccess('Authentication complete');
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error(error);
    }
  }

  getURLParams(url) {
    const params = {};
    const searchParams = new URLSearchParams(new URL(url).search);

    Array.from(searchParams.entries()).forEach(([key, value]) => {
      params[key] = value;
    });

    return params;
  }

  async getDownload(link) {
    const text = await this.page
      .evaluate(async (fileLink) => {
        const response = await fetch(fileLink, {
          method: 'GET',
        });
        if (!response.ok) {
          throw new Error('failedToFetchInvoicesFromWebsite');
        }

        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const binary = String.fromCharCode(...bytes);
        return window.btoa(binary);
      }, link)
      .catch((e) => {
        throw e;
      });

    this.onSuccess('PDF prefetch complete', { link });
    return {
      buffer: Buffer.from(text, 'base64'),
      async saveAs(path) {
        await fs.writeFile(path, this.buffer);
      },
    };
  }
}

module.exports = WHMCSProvider;
