const fs = require('fs/promises');
const Provider = require('./provider');

class QParkProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Q-Park';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.q-park.nl/nl-nl/login/my-q-park/';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://www.q-park.nl/nl-nl/myqpark/myaccount/myinvoices/';

  /**
   * @private
   * @type {string}
   */
  downloadURL = 'https://www.q-park.nl/api/myqpark/DownloadInvoice?';

  /**
   * @private
   * @type {string}
   */
  invoiceURL = 'https://www.q-park.nl/api/myqpark/LoadInvoices?';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  count = 0;

  /**
   * @public
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    await this.authenticate();
    const token = await this.getToken();
    const invoiceList = await this.getInvoiceList(token);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

    try {
      return Promise.all(invoiceListFiltered.map(async (invoice, i) => {
        const download = await this.getDownload(invoice.link, token);
        this.updateFetchStatus(invoiceListFiltered.length);
        await this.page.close();
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoiceListFiltered[i].description.toString(),
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  async getToken() {
    try {
      let token;
      await this.page.goto(this.baseUrl);
      const tokenBtn = await this.page.locator('#btnFilter');
      await tokenBtn.click();
      try {
        const requestPromise = this.page.waitForEvent('request', {
          predicate: (req) => req.url().includes(this.invoiceURL),
        });
        await tokenBtn.click();

        const headers = await (await requestPromise).headersArray();
        token = headers.find((header) => header.name === 'Cookie').value;
      } catch (err) {
        throw new Error('failedToFetchToken');
      }
      return token;
    } catch (err) {
      throw new Error('failedToFetchToken');
    }
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]>}
   */
  async getInvoiceList(token) {
    try {
      const todayDate = new Date().getDate();
      const todayMonth = new Date().getMonth();
      const todayYear = new Date().getFullYear();

      const response = await fetch(
        `${this.invoiceURL}starDateTime=1-1-0001&endDateTime=${
          todayDate
        }-${
          todayMonth
        }-${
          todayYear}`,
        {
          method: 'GET',
          headers: { Cookie: token },
        },
      );
      if (response.ok) {
        const data = await response.json();
        const invoices = data?.Invoices || [];
        this.onSuccess('Collect invoice list complete', invoices);
        return invoices;
      }
    } catch (err) {
      this.onError(
        new Error(
          `${this.invoiceURL} Request failed.`,
        ),
      );
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.DocumentNumber,
      date: new Date(invoice.DocumentDate),
      link: `${this.downloadURL}attachmentname=${invoice.DocumentName}&fileid=${invoice.DocumentId}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Object}
   */
  async getDownload(link, token) {
    const response = await fetch(link, {
      method: 'GET',
      headers: { Cookie: token },
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
    this.onError(
      new Error(`${link} Request failed. Status ${response.statusText}`),
    );
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.getByText('Alles accepteren').click();

      await this.page
        .locator('input[type="email"]')
        .locator('visible=true')
        .fill(this.ws.username);
      await this.page
        .locator('input[type="password"]')
        .locator('visible=true')
        .fill(this.ws.password);
      await this.page
        .locator('button[type=submit]')
        .locator('visible=true')
        .click();
      const incorrect = await this.page
        .getByText('Uw wachtwoord en/of gebruikersnaam is niet correct.')
        .isVisible();
      if (incorrect) {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }

      if (
        this.page.url()
        === 'https://www.q-park.nl/nl-nl/myqpark/myaccount/myseasontickets/'
      ) {
        this.authDone = true;
        this.onSuccess('Authentication complete');
        return true;
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = QParkProvider;