const { parse } = require('date-fns');
const fs = require('fs/promises');
const Provider = require('./provider');

class MijndomeinProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Mijndomein';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://auth.mijndomein.nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://mijnaccount.mijndomein.nl/facturen';

  /**
   * @private
   * @type {string}
   */
  downloadLinkPrefix = 'https://mijnaccount.mijndomein.nl/facturen/download?invoices[]=';

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

  /**
   * @public
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    const authSessionCookie = await this.authenticate();
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice, i) => {
          const download = await this.getInvoiceDownload(
            invoice.invoiceId,
            authSessionCookie,
          );
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            fileName: invoiceListFiltered[i].invoiceId.toString(),
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (this.authError) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<string>}
   */
  async authenticate() {
    const selectors = {
      username: 'input[name="_username"]',
      password: 'input[name="_password"]',
      submitButton: 'button[type="submit"]',
    };

    try {
      await this.page.goto(this.invoiceUrl);
      const { username, password, submitButton } = selectors;
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      await this.page.click(submitButton);
      const incorrect = await this.page
        .getByText('Je e-mail en/of wachtwoord is incorrect')
        .isVisible();
      if (incorrect) {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }
      const currentUrl = await this.page.url();
      if (currentUrl !== this.invoiceUrl) {
        this.authError = true;
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      } else {
        const cookies = await this.getCookie('PHPSESSID');
        this.onSuccess('Authentication complete');
        return cookies;
      }
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {String}
   */
  async getCookie(key) {
    const cookieValue = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === key)[0].value;
    return `${key}=${cookieValue};`;
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return parse(date, 'dd-MM-yyyy', new Date());
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.waitForSelector('ul#paid');

      const invoiceList = await this.page.evaluate(() => {
        const invoiceElements = Array.from(document.querySelectorAll('ul#paid li.invoice-list-item'));

        return invoiceElements.map((element) => ({
          description: element.querySelector('.invoice-name').textContent.trim(),
          invoiceId: element.querySelector('.invoice-number').textContent.trim(),
          date: element.querySelector('span[ng-bind="invoice.date | FormatDate"]').textContent.trim(),
        }));
      });

      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      description: invoice.description,
      link: `${this.downloadLinkPrefix}${invoice.invoiceId}`,
      date: this.parseDate(invoice.date),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, cookie) {
    let arrayBuffer;
    try {
      const response = await fetch(`${this.downloadLinkPrefix}${invoiceId}`, {
        method: 'GET',
        headers: {
          Cookie: cookie,
        },
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { invoiceId });
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

module.exports = MijndomeinProvider;
