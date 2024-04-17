const fs = require('fs/promises');
const Provider = require('./provider');

class OrderchampProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Orderchamp';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.orderchamp.com/nl/supplier_invoices';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.orderchamp.com/nl/supplier_invoices';

  /**
   * @private
   * @type {string}
   */
  apiUrl = 'https://api.orderchamp.com/v1/graphql';

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
   * @public
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    let isAuthenticated = false;
    if (!this.authDone) {
      try {
        isAuthenticated = await this.authenticate();
      } catch (err) {
        this.logger.error('error', err.toString());
      }
    }
    if (!isAuthenticated) {
      throw new Error('authenticationFailed');
    }

    try {
      const invoicDateMapping = await this.getExportButtonInvoiceList();
      const invoiceList = await this.getInvoiceList();
      invoiceList.forEach((invoice) => {
        invoice.date = invoicDateMapping[invoice.description];
      });
      const invoiceListFiltered = this.applyFilters(invoiceList);

      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.url);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
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

  async getExportButtonInvoiceList() {
    await this.page.waitForSelector('table.table-card');

    const monthsMap = {
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

    const url = await this.page.evaluate(() => {
      const cardHeader = document.querySelector('div.card-header');
      const exportLink = cardHeader.querySelector('a.btn.btn-sm'); // CSS selector for the export link

      return exportLink.getAttribute('href').trim();
    });

    const download = await this.getDownload(url);
    const fileContents = download.buffer.toString();
    const lines = fileContents.split('\n');
    const output = {};

    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i] !== '') {
        const vals = lines[i].split(',');
        // eslint-disable-next-line prefer-destructuring
        const dateComps = vals[9].substring(1, vals[9].length - 1).split(' ');
        const date = new Date(dateComps[2], monthsMap[dateComps[1]], dateComps[0]);
        output[vals[0]] = date;
      }
    }
    return output;
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    await this.page.waitForSelector('table.table-card');

    return this.page.evaluate(() => {
      const table = document.querySelector('table.table-card');
      const tableRows = Array.from(table.querySelectorAll('tbody tr'));

      return tableRows.map((row) => {
        const columns = row.querySelectorAll('td');
        return {
          // orderNo: columns[0].querySelector('a').textContent.trim(),
          description: columns[1].querySelector('a').textContent.trim(),
          // bedrag: columns[2].textContent.trim(),
          // status: columns[3].querySelector('span').textContent.trim(),
          url: columns[4].querySelector('a').getAttribute('href').trim(),
        };
      });
    });
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    await this.page.goto(this.authUrl);
    await this.page.type('input[type="email"]', this.ws.username); // Replace 'your_email@example.com' with the desired email address
    await this.page.type('input[type="password"]', this.ws.password); // Replace 'your_password' with the desired password
    await this.page.click('button[type="submit"]');

    await new Promise((resolve) => { setTimeout(resolve, 5000); });

    return this.page.evaluate(() => document.location.href)
      .then((url) => url === 'https://www.orderchamp.com/nl/supplier_invoices');
  }

  async getDownload(link) {
    const text = await this.page.evaluate(async (fileLink) => {
      const response = await fetch(fileLink, {
        method: 'GET',
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        // return Buffer.from(arrayBuffer).toString('base64');
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

module.exports = OrderchampProvider;
