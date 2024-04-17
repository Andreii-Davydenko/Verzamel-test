const Provider = require('./provider');

class ShopifyProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Shopify';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://accounts.shopify.com/store-login';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://admin.shopify.com';

  /**
   * @public
   * @return {Promise<Object[]}
   */
  async fetch() {
    await this.authenticate();
    await this.validateStoreId();
    const sessionCreds = await this.getSessionCreds();
    const invoiceList = await this.getInvoiceList(this.ws.accountId, sessionCreds);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList, this.ws.accountId);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const jobId = await this.triggerDownload(invoice.id, this.ws.accountId, sessionCreds);
        await this.waitForDocument(jobId, this.ws.accountId, sessionCreds);
        await this.page.waitForTimeout(1000);
        const download = await this.getDownload(invoice.link, sessionCreds);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          fileName: this.getInvoiceNumber(invoice.id),
          download,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async validateStoreId() {
    try {
      if (!this.ws.accountId) {
        throw new Error('storeIdIsRequired');
      }
      this.page.goto(`${this.baseUrl}/store/${this.ws.accountId}`);
      await this.page.waitForResponse(async (res) => {
        const url = res.url();
        if (url.includes('operation=RequestDetails')) {
          const { error, errors } = await res.json();
          if (error || errors) {
            throw new Error('invalidShopifyStore');
          }
          return true;
        }
        if (url.includes('operation=HomeData')) {
          const { data } = await res.json();
          return !!data;
        }
        return false;
      });
    } catch (err) {
      this.onError(new Error('Invalid Shopify Store ID'));
      throw new Error('invalidShopifyStore');
    }
  }

  /**
   * @private
   * @param {string} invoiceId
   * @param {string} storeId
   * @param {Object} sessionCreds
   * @return {Promise<string>}
   */
  async triggerDownload(invoiceId, storeId, sessionCreds) {
    const response = await fetch(`${this.baseUrl}/api/shopify/${storeId}?operation=BillingDocumentDownload&type=mutation`, {
      method: 'POST',
      headers: {
        Cookie: `koa.sid=${sessionCreds.koaSid};koa.sid.sig=${sessionCreds.koaSidSig};`,
        'X-Csrf-Token': sessionCreds.csrfToken,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationName: 'BillingDocumentDownload',
        variables: {
          id: invoiceId,
          documentType: 'INVOICE',
        },
        query: 'mutation BillingDocumentDownload($id: ID!, $documentType: BillingDocumentType) { billingDocumentDownload(id: $id, documentType: $documentType) { job { id } userErrors { field message }}}',
      }),
    });
    if (response.ok) {
      const { data } = await response.json();
      const jobId = data?.billingDocumentDownload?.job?.id;
      this.onSuccess('PDF download triggered', { invoiceId, jobId });
      return jobId;
    }
    this.onError(new Error(`Failed to trigger download ${invoiceId}. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {string} jobId
   * @param {string} storeId
   * @param {Object} sessionCreds
   * @return {Promise<boolean>}
   */
  async waitForDocument(jobId, storeId, sessionCreds) {
    let done = false;
    let tries = 5;
    do {
      await this.page.waitForTimeout(500);
      const response = await fetch(`${this.baseUrl}/api/shopify/${storeId}?operation=JobPoller&type=query`, {
        method: 'POST',
        headers: {
          Cookie: `koa.sid=${sessionCreds.koaSid};koa.sid.sig=${sessionCreds.koaSidSig};`,
          'X-Csrf-Token': sessionCreds.csrfToken,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationName: 'JobPoller',
          variables: {
            id: jobId,
          },
          query: 'query JobPoller($id: ID!) { job(id: $id) { id done }}',
        }),
      });
      if (response.ok) {
        const { data } = await response.json();
        done = !!data?.job?.done;
        this.onSuccess('PDF download confirmed', { jobId });
        return jobId;
      }
      if (!done) {
        tries -= 1;
      }
    } while (tries > 0 || !done);
    if (!done) {
      this.onError(new Error(`Failed to confirm ${jobId}.`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
    return done;
  }

  /**
   * @private
   * @return {Promise<{ csrfToken: string, koaSid: string, koaSidSig: string }>}
   */
  async getSessionCreds() {
    const ctx = this.page.context();
    const cookies = await ctx.cookies();
    const koaSidCookie = cookies.find((item) => item.name === 'koa.sid');
    const koaSidSigCookie = cookies.find((item) => item.name === 'koa.sid.sig');
    const koaSid = koaSidCookie?.value || '';
    const koaSidSig = koaSidSigCookie?.value || '';
    let csrfToken = '';
    await this.page.waitForRequest(async (req) => {
      csrfToken = await req.headerValue('x-csrf-token');
      return !!csrfToken;
    });
    return { csrfToken, koaSid, koaSidSig };
  }

  /**
   * @private
   * @param {Object[]} invoiceList
   * @param {string} storeId
   * @return {Promise<Object>}
   */
  normalizeInvoiceList(invoiceList, storeId) {
    return invoiceList.map((invoice) => ({
      id: invoice.id,
      description: invoice.description || `Bill #${this.getInvoiceNumber(invoice.id)}`,
      date: new Date(invoice.createdAt),
      link: `${this.baseUrl}/store/${storeId}/invoices/${this.getInvoiceNumber(invoice.id)}/pdf_download.pdf?document_type=INVOICE`,
      wsName: this.ws.name,
    }));
  }

  /**
     * @private
     * @param {{ link: String }} link
     * @return {Promise<import('playwright-core').Download>}
     */
  async getDownload(invoiceLink) {
    const ctx = this.page.context();
    const downloadPage = await ctx.newPage();
    try {
      const downloadPromise = downloadPage.waitForEvent('download');
      await downloadPage.evaluate(async (href) => {
        const link = await document.createElement('a');
        link.setAttribute('href', `${href}`);
        link.click();
      }, invoiceLink);

      const download = await downloadPromise;
      await download.path();
      await downloadPage.close();

      this.onSuccess('Download complete', invoiceLink);
      return download;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} storeId
   * @param {Object} sessionCreds
   * @return {Promise<Object[]>}
   */
  async getInvoiceList(storeId, sessionCreds) {
    const invoiceList = [];
    let hasNextPage = false;
    let cursor = null;
    try {
      do {
        const invoices = await this.getInvoiceListPage(storeId, sessionCreds, cursor);
        if (invoices?.edges?.length) {
          invoiceList.push(...invoices.edges.map((item) => item.node));
          cursor = invoices.edges[invoices.edges.length - 1].cursor;
          hasNextPage = invoices?.pageInfo?.hasNextPage || false;
        }
      } while (hasNextPage);
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      this.onError(new Error(`Failed to fetch invoice list: ${err.message}.`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} storeId
   * @param {Object} sessionCreds
   * @param {String} cursorAfter
   * @return {Promise<Object>}
   */
  async getInvoiceListPage(storeId, sessionCreds, cursorAfter = null) {
    const response = await fetch(`${this.baseUrl}/api/shopify/${storeId}?operation=BillingHistory&type=query`, {
      method: 'POST',
      headers: {
        Cookie: `koa.sid=${sessionCreds.koaSid};koa.sid.sig=${sessionCreds.koaSidSig};`,
        'X-Csrf-Token': sessionCreds.csrfToken,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationName: 'BillingHistory',
        variables: {
          firstAmount: 10,
          filters: {
            status: [
              'PENDING',
              'SUCCESS',
              'REQUESTING',
              'FAILED',
            ],
          },
          ...(cursorAfter && { cursorAfter }),
        },
        query: 'query BillingHistory($cursorAfter: String, $cursorBefore: String, $filters: BillingInvoiceFiltersInput, $firstAmount: Int, $lastAmount: Int, $reverse: Boolean) { billingAccount { invoices( first: $firstAmount last: $lastAmount after: $cursorAfter before: $cursorBefore reverse: $reverse filters: $filters ) { pageInfo { hasNextPage hasPreviousPage } edges { cursor node { id createdAt description }}}}}',
      }),
    });
    if (response.ok) {
      const { data } = await response.json();
      return data?.billingAccount?.invoices || {};
    }
    throw new Error(response.statusText);
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  async getStoreId() {
    await this.page.waitForSelector('#AppFrame');
    return this.page.url().substring(this.page.url().lastIndexOf('/') + 1);
  }

  /**
   * @private
   * @param {string} invoiceId
   * @return {string}
   */
  getInvoiceNumber(invoiceId) {
    if (!invoiceId) return '';
    return invoiceId.substring(invoiceId.lastIndexOf('/') + 1);
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async handleUsername() {
    const locator = this.page.locator('input#account_email');
    if (await locator.isVisible() && await locator.isEditable()) {
      await locator.fill(this.ws.username);
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async handlePassword() {
    const locator = this.page.locator('input#account_password');
    if (await locator.isVisible() && await locator.isEditable()) {
      await locator.fill(this.ws.password);
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async checkAuthState() {
    await this.page.waitForResponse(async (res) => {
      if (res.url().includes('confirm_security_settings')) {
        await this.page.waitForSelector('a.remind-me-later-link');
        this.page.locator('a.remind-me-later-link').click();
        return true;
      }
      if (res.url().includes('https://newassets.hcaptcha.com')) {
        return true;
      }
      if (res.url().includes(this.baseUrl)) {
        this.onSuccess('Authentication complete');
        this.authDone = true;
        return true;
      }
      return false;
    });
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      do {
        await this.page.waitForSelector('form:visible');
        await this.handleCaptcha('#h-captcha');
        await this.handleUsername();
        await this.handlePassword();
        await this.page.locator('form:visible button[type="submit"]').click();
        await this.checkAuthState();
      } while (!this.authDone);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = ShopifyProvider;
