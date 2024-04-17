const fs = require('fs/promises');
const Provider = require('./provider');

class SendcloudProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Sendcloud';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://account.sendcloud.com/login/';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://eu-central-1-0.app.sendcloud.com/xhr/invoice';

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    await this.authenticate();
    const sessionId = await this.getSessionId();
    const invoiceList = await this.getInvoiceList(sessionId);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link, sessionId);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {string} sessionId
   * @return {Promise<{ id: number, ref: string, date: string }[]>}
   */
  async getInvoiceList(sessionId) {
    let next = this.baseUrl;
    const invoiceList = [];
    do {
      const response = await fetch(next, {
        method: 'GET',
        headers: { Cookie: `sessionid=${sessionId};` },
      });
      if (response.ok) {
        const data = await response.json();
        next = data?.next;
        if (data?.results?.length) {
          invoiceList.push(...data.results);
        }
      } else {
        this.onError(new Error(`${next} Request failed. Status ${response.statusText}`));
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
    } while (next);
    return invoiceList;
  }

  /**
   * @private
   * @param {{ id: number, ref: string, date: string }[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String, fileName: string}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.ref,
      date: new Date(invoice.date),
      link: `${this.baseUrl}/${invoice.ref}/pdf`,
      wsName: this.ws.name,
      fileName: invoice.ref,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @param {String} sessionId
   * @return {Promise<Object>}
   */
  async getDownload(link, sessionId) {
    const response = await fetch(link, {
      method: 'GET',
      headers: { Accept: '*/*', Cookie: `sessionid=${sessionId}` },
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
    this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  async getSessionId() {
    try {
      const ctx = this.page.context();
      const cookies = await ctx.cookies();
      const sessionCookie = cookies
        .find((item) => item.name === 'sessionid' && item.domain === '.app.sendcloud.com');
      return sessionCookie.value;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('#login_form button[type="submit"]').click();
      await this.page.waitForResponse((res) => {
        const requirements = [
          res.url().includes('/users/me'),
          res.request().method() === 'GET',
          res.status() === 200,
          res.request().headers()['x-csrftoken'],
        ];
        if (requirements.every((requirement) => !!requirement)) {
          this.onSuccess('Authentication complete');
          this.authDone = true;
          return true;
        }
        return false;
      }, { timeout: 3000 });
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = SendcloudProvider;
