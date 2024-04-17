const Provider = require('./provider');

class CloudwaysProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Cloudways';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://platform.cloudways.com/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://platform.cloudways.com/account/invoice';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }

    try {
      const cookies = await this.getAuthCookie();
      const invoiceList = await this.getInvoiceList(cookies);
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
        }
        currentDownloads += 1;
        const download = await this.getDownload(invoice.invoiceId);
        this.updateFetchStatus(invoiceListFiltered.length);

        currentDownloads -= 1;
        return {
          ...invoice,
          description: invoice.invoiceId,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.invoiceId,
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
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList(cookies) {
    try {
      const invoicesResponse = await fetch('https://platform.cloudways.com/api/v1/account/invoice', {
        headers: {
          accept: 'application/json, text/plain, */*',
          Cookie: cookies,
        },
        method: 'GET',
      });
      if (!invoicesResponse.ok) {
        this.onError('Failed to fetch invoices from website');
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      const responseText = await invoicesResponse.text();
      const { invoices } = JSON.parse(responseText);
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.id_invoice,
      date: new Date(invoice.invoice_date),
    }));
  }

  /**
   * @private
   * @param { link: String }
   * @return {Promise<import('playwright-core').Download>}
   */
  async getDownload(invoiceId) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.setAttribute('href', `https://platform.cloudways.com/api/v1/account/download_invoice/${href}`);
        link.click();
      }, invoiceId);
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return download;
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    await this.page.goto(this.authUrl, { waitUntil: 'domcontentloaded' });
    try {
      const trustePopFrameSelector = 'iframe.truste_popframe';
      const trustePopFrame = this.page.locator(
        trustePopFrameSelector,
      );
      try {
        const trustePopFrameIsVisible = trustePopFrame
          ? await trustePopFrame.isVisible() : false;
        if (trustePopFrameIsVisible) {
          const acceptAll = await this.page.waitForSelector('a.acceptAllButtonLower');
          await acceptAll.click();

          const closePopup = await this.page.waitForSelector('a.close');
          await closePopup.click();
        }
      } catch (error) { /* empty */ }
      await this.page.getByRole('textbox', { name: 'email' }).fill(this.ws.username);
      await this.page.getByRole('textbox', { name: 'password' }).fill(this.ws.password);
      await this.page.getByText('LOGIN NOW').click();
      const invalid = await this.page.getByText('Invalid email or password').isVisible();
      if (invalid) throw new Error('Auth failed');
      await this.page.waitForURL('https://platform.cloudways.com/server');
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = CloudwaysProvider;
