const fs = require('fs/promises');
const Provider = require('./provider');

class MoneybirdPortalProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Moneybird - Portal';

  /**
   * @private
   * @type {string}
   */
  authUrl = this.ws.username;

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = this.ws.username;

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
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('input[name="view_code"]');
      await this.page.evaluate((code) => {
        document.getElementById('view_code').value = code;
      }, this.ws.password);
      await this.page.click('button[type="submit"]');

      await new Promise((resolve) => { setTimeout(resolve, 3000); });

      const invalid = await this.page.getByText('De toegangscode is onjuist.').isVisible();

      if (invalid) {
        this.authDone = false;
        throw new Error('invalidCode');
      }
      this.authDone = true;
      this.onSuccess('Authentication Complete');
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{description:string,date:Date,link:string}[]>}
   */
  async getListOfInvoices() {
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    await this.page.evaluate(() => document.querySelectorAll('a.invoice-nav-el')
      .forEach((e) => {
        if (e.textContent.trim() === 'Alle facturen') {
          e.click();
        }
      }));

    await new Promise((resolve) => { setTimeout(resolve, 2000); });
    const tableRows = await this.page.$$('tbody.table__group tr.table__row');
    const promises = tableRows.map(async (row) => {
      const cells = await row.$$('td.table__cell');
      return {
        description: await (await cells[0].$('a')).innerText(),
        date: this.parseDate(await cells[2].innerText()),
        link: await (await cells[5].$('a')).getAttribute('href'),
      };
    });

    const list = await Promise.all(promises);
    return list;
  }

  /**
   * @public
   * @return {Promise<Awaited<{description: *, date: *, download: *, fileName: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();
      const invoiceList = await this.getListOfInvoices();
      const invoiceListFiltered = this.applyFilters(invoiceList);

      let currentDownloads = 1;
      const maxDownloads = 15;
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 300); });
        }
        currentDownloads += 1;
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);

        currentDownloads -= 1;

        return {
          ...invoiceListFiltered,
          description: invoice.description,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
          wsName: this.ws.name,
        };
      }));
    } catch (error) {
      if (!this.authDone) throw error;
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      await this.page.close();
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
   * @return {String}
   */
  async getCookie(key) {
    const cookieValue = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === key)[0].value;
    return `${key}=${cookieValue};`;
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Object}
   */
  async getDownload(link) {
    try {
      let cookies = await this.getCookie('_moneybird_session');
      cookies += (await this.getCookie('mb_online_view_authorization'));

      const myHeaders = new Headers();
      myHeaders.append('cookie', cookies);
      myHeaders.append('accept', '*/*');
      myHeaders.append('Access-Control-Allow-Origin', '*');
      const requestOptions = {
        method: 'GET',
        headers: myHeaders,
        redirect: 'follow',
        mode: 'cors',
      };
      const response = await fetch(`https://moneybird.com${link}`, requestOptions);
      if (!response.ok) {
        throw new Error(`${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      this.onError(new Error(`${link} Request failed. Status ${err}`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = MoneybirdPortalProvider;
