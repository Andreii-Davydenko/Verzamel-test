const fs = require('fs/promises');
const Provider = require('./provider');

class SpecialLeaseProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Special Lease';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://uwfactuuronline.speciallease.nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://uwfactuuronline.speciallease.nl/#/documents';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @private
   * @return {Promise<boolean>}
   */
  async authenticate() {
    await this.page.goto(this.authUrl);
    await this.page.type('input[id="username"]', this.ws.username);
    await this.page.type('input[id="password"]', this.ws.password);
    await this.page.click('input[type="submit"]');

    await new Promise((resolve) => { setTimeout(resolve, 6000); });

    return this.page.evaluate(() => document.location.href)
      .then((url) => url === 'https://uwfactuuronline.speciallease.nl/#/documents');
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{description:string,date:Date,link:string}[]>}
   */
  async getListOfInvoices() {
    await this.page.evaluate(() => document.querySelectorAll('span.ng-binding')
      .forEach((e) => {
        if (e.textContent === '50') {
          const parentButton = e.closest('button');
          if (parentButton) {
            parentButton.click();
          }
        }
      }));

    const list = [];

    let isLastPage = false;
    while (!isLastPage) {
      await new Promise((resolve) => { setTimeout(resolve, 5000); });

      const tableRows = await this.page.$$('table#documentsTable tbody tr');

      for (let i = 0; i < tableRows.length; i++) {
        const row = tableRows[i];
        const rowData = await row.$$eval('td', (cells) => cells.map((cell) => {
          if (cell.getAttribute('data-title') === '\'Download\'') {
            return cell.querySelector('a').href;
          }

          return cell.textContent.trim();
        }));
        list.push({
          description: rowData[2],
          date: this.parseDate(rowData[3]),
          link: rowData[8],
        });
      }

      isLastPage = await this.page.evaluate(() => {
        let isNextPageButtonDisabled = false;
        document.querySelectorAll('a.ng-scope').forEach((e) => {
          if (e.textContent === '»') {
            const parentButton = e.closest('li');
            if (parentButton) {
              if (parentButton.className === 'ng-scope disabled') {
                isNextPageButtonDisabled = true;
                return;
              }
              e.click();
            }
          }
        });
        return isNextPageButtonDisabled;
      });
    }
    return list;
  }

  /**
   * @public
   * @return {Promise<Awaited<{description: *, date: *, download: *, fileName: *}>[]>}
   */
  async fetch() {
    let isAuthenticated = false;
    if (!this.authDone) {
      try {
        isAuthenticated = await this.authenticate();
      } catch (err) {
        this.logger.error('error', err);
      }
    }
    if (!isAuthenticated) {
      throw new Error('authenticationFailed');
    }

    try {
      const invoiceList = await this.getListOfInvoices();
      const invoiceListFiltered = this.applyFilters(invoiceList);

      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);

        return {
          ...invoiceListFiltered,
          description: invoice.description,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
          wsName: this.ws.name,
        };
      }));
    } catch (err) {
      this.logger.error('Error: ', err.toString());
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    const parts = date.split('-');
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Object}
   */
  async getDownload(link) {
    const text = await this.page.evaluate(async (fileLink) => {
      const response = await fetch(fileLink, {
        method: 'GET',
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const len = bytes.byteLength;
        let binary = '';
        for (let i = 0; i < len; i += 1) {
          binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
      }
      throw new Error('failedToFetchInvoicesFromWebsite');
    }, link).catch((e) => {
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

module.exports = SpecialLeaseProvider;
