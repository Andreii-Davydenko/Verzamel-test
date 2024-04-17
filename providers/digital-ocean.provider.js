const fs = require('fs/promises');
const Provider = require('./provider');

class DigitalOceanProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Digital Ocean';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://cloud.digitalocean.com/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://cloud.digitalocean.com/account/billing';

  /**
   * @private
   * @type {string}
   */
  cookies = '';

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
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch(code) {
    await this.handle2FA(code);
    try {
      this.cookies = await this.getAuthCookie();

      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
        }
        currentDownloads += 1;
        const download = await this.getDownload(invoice.invoiceUuid, invoice.type);
        currentDownloads -= 1;

        this.updateFetchStatus(invoiceListFiltered.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: `${invoice.invoiceId}`,
          wsName: this.ws.name,
        };
      }));
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} invoiceUuid
   * @param {String} invoiceType
   * @return {Promise<import('playwright-core').Download>}
   */
  async getDownload(invoiceUuid) {
    const body = JSON.stringify({
      operationName: 'getInvoicePDF',
      variables: {
        getInvoicePdfRequest: {
          invoice_uuid: invoiceUuid,
        },
      },
      query: 'query getInvoicePDF($getInvoicePdfRequest: GetInvoicePDFRequest) {\n  getInvoicePDF(GetInvoicePDFRequest: $getInvoicePdfRequest) {\n    content_type\n    filename\n    data\n    __typename\n  }\n}\n',
    });

    try {
      const response = await fetch('https://cloud.digitalocean.com/graphql', {
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.cookies,
        },

        body,

        method: 'POST',
      });
      const responseText = await response.text();
      if (!response.ok) {
        this.onError(`Failed to fetch invoices: ${responseText}`);
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      const { data } = JSON.parse(responseText);
      const pdfData = data.getInvoicePDF.data;
      this.onSuccess('PDF prefetch complete', { invoiceUuid });

      return {
        buffer: Buffer.from(pdfData, 'base64'),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await this.onPageError(err + invoiceUuid, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getAuthCookie() {
    try {
      return (await this.page.context().cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join(';') || '';
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {Promise<{ date: Date,
   * description: String, invoice_uuid: String, invoice_id: String }[]>}
   */
  async getInvoiceList() {
    const body = JSON.stringify({
      operationName: 'listBillingHistory',
      variables: {
        listBillingHistoryRequest: {
          page: 1,
          per_page: 1000,
        },
      },
      query: 'query listBillingHistory($listBillingHistoryRequest: ListBillingHistoryRequest) {\n  listBillingHistory(ListBillingHistoryRequest: $listBillingHistoryRequest) {\n    billing_history {\n      description\n      amount\n      invoice_id\n      invoice_uuid\n      date\n      type\n      memo_id\n      receipt_id\n      __typename\n    }\n    meta {\n      total\n      __typename\n    }\n    __typename\n  }\n}\n',
    });

    try {
      const invoicesResponse = await fetch('https://cloud.digitalocean.com/graphql', {
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.cookies,
        },

        body,

        method: 'POST',
      });
      const responseText = await invoicesResponse.text();
      if (!invoicesResponse.ok) {
        this.onError(`Failed to fetch invoices: ${responseText}`);
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      const { data } = JSON.parse(responseText);
      const invoices = data.listBillingHistory.billing_history || [];
      this.onSuccess('Collect unfiltered invoice list complete', invoices);
      const filteredInvoices = invoices.filter((invoice) => invoice.type === 'Invoice');
      this.onSuccess('Collect invoice list complete', filteredInvoices);
      return filteredInvoices;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, invoiceUuid: String, description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.invoice_id,
      invoiceUuid: invoice.invoice_uuid,
      description: invoice.description,
      date: new Date(invoice.date),
    }));
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('#code').fill(code);
      await this.page.getByRole('button', { name: 'Verify Code' }).click();
      const invalid = await this.page.getByText('Incorrect code').isVisible();
      if (invalid) throw new Error('Auth failed');
      await this.page.waitForURL('https://cloud.digitalocean.com/projects');
      this.onSuccess('2FA Complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  async waitForSelector(frameContext, selector, timeInMilliSeconds) {
    if (!frameContext || !(typeof frameContext.$$ === 'function')) {
      return false;
    }
    const numericTimeInMilliSeconds = Number(timeInMilliSeconds);
    const startTime = new Date();
    while (!(new Date() - startTime > (numericTimeInMilliSeconds || 60000))) {
      const targetOnFrame = await frameContext.$$(selector);
      if (!!targetOnFrame && targetOnFrame.length) {
        return true;
      }
    }
    return false;
  }

  /**
   * @public
   * @return {Promise<Function>}
   */
  async authenticate() {
    try {
      const responsePromise = this.page.waitForResponse(
        (response) => response.url()
          .startsWith(
            'https://consent-pref.trustarc.com/?type=digitalocean_v2&layout=gdpr&site=digitalocean.com',
          ),
      );
      await this.page.goto(this.authUrl);
      try {
        await responsePromise;
        const trustePopFrameSelector = 'iframe.truste_popframe';
        const trustePopFrame = this.page.locator(
          trustePopFrameSelector,
        );
        const trustePopFrameIsVisible = trustePopFrame
          ? await trustePopFrame.isVisible() : false;
        if (trustePopFrameIsVisible) {
          const iframe = await this.page.$(trustePopFrameSelector);
          // Switch to the iframe context
          const trustePopFrameContext = await iframe.contentFrame();
          // Perform actions within the iframe context
          await this.waitForSelector(trustePopFrameContext, 'a.acceptAllButtonLower', 10000);
          const trustePopFrameContextAcceptAllButtonLower = await trustePopFrameContext.$(
            'a.acceptAllButtonLower',
          );
          await trustePopFrameContextAcceptAllButtonLower.click();
          await this.waitForSelector(trustePopFrameContext, 'a.close', 10000);
          const trustePopFrameContextClose = await trustePopFrameContext.$(
            'a.close',
          );
          await trustePopFrameContextClose.click();
        }
      } catch (error) { /* empty */ }
      await this.page.locator('#email').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.getByRole('button', { name: 'Log In' }).click();
      const invalid = await this.page.getByText('Incorrect email or password').isVisible();
      if (invalid) throw new Error('Auth failed');
      await this.page.waitForSelector('#code');
      this.onSuccess('Authentication complete');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = DigitalOceanProvider;
