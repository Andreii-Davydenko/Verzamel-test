const fs = require('fs/promises');
const Provider = require('./provider');

class MakroProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Makro';

  /**
   * @private
   * @type {string}
   */
  authUrl = ' https://docs.makro.nl/';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = ' https://docs.makro.nl/';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://docs.makro.nl/mriapi/v1/customer/invoices';

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

  authorization = '';

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(
            invoice.description,
            invoice.downloadURL,
          );
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
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
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    const selectors = {
      username: '#user_id',
      password: '#password',
      submitButton: '#submit',
      errorMessage: '#toast-container div.toast-message',
      cookieNoticeShowdowRootContainer: 'cms-cookie-disclaimer',
      cookieNoticeButton: 'button.field-accept-button-name',
    };

    try {
      await this.page.goto(this.authUrl);
      const {
        username,
        password,
        submitButton,
        errorMessage,
        cookieNoticeShowdowRootContainer,
        cookieNoticeButton,
      } = selectors;
      try {
        await this.page.waitForSelector(cookieNoticeShowdowRootContainer);
      } catch (error) {
        // Nothing special
      }
      try {
        const theCookieNoticeShowdowRootContainer = await this.page.$(
          cookieNoticeShowdowRootContainer,
        );
        const thecookieNoticeShowdowRoot = await theCookieNoticeShowdowRootContainer
          .evaluateHandle((element) => element.shadowRoot);
        const showdowRootButton = await thecookieNoticeShowdowRoot.$(cookieNoticeButton);
        showdowRootButton.click();
        while (await thecookieNoticeShowdowRoot.$(cookieNoticeButton)) {
          // nothing just wait
        }
      } catch (error) {
        // Nothing special
      }
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL(this.authUrl);
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
      return this.authDone;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getAuthCookie() {
    try {
      const thisPageURL = this.page.url();
      return (await this.page.context().cookies())
        .filter(
          ({ value, domain }) => !!value
            && thisPageURL.split('://')[1].split('/')[0].endsWith(domain),
        )
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ');
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {cookie: String, userAgent: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    return { cookie, userAgent };
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const invoices = [];
    let hasExtractedInfoFromHeader = false;
    // Intercept network requests
    await this.page.route('**/*', (route) => {
      if (!hasExtractedInfoFromHeader) {
        const url = route.request().url();
        const method = route.request().method();
        const headers = route.request().headers();
        if (
          url.startsWith(this.invoiceListUrl)
          && method === 'GET'
        ) {
          this.authorization = headers.authorization;
          hasExtractedInfoFromHeader = true;
        }
      }
      // Continue with the request
      route.continue();
    });
    // Create a promise to resolve when the response is received
    const invoiceListResponsePromise = this.page.waitForResponse(
      (response) => response.url().startsWith(this.invoiceListUrl),
    );
    // Navigate to a web page
    await this.page.goto(this.invoiceUrl);
    // Wait for the response to the specific request
    let nextPageLink = '';
    const invoiceListResponse = await invoiceListResponsePromise;
    if (invoiceListResponse) {
      const data = await invoiceListResponse.json();
      if (
        !!data
        && !Number.isNaN(data.limit)
        && !Number.isNaN(data.numFound)
        && data.limit >= data.numFound
        && data._embedded
        && Array.isArray(data._embedded.customerInvoices)
      ) {
        data._embedded.customerInvoices.forEach(
          ({
            invoiceNumber,
            invoiceDate,
            _links: {
              download: {
                href: downloadURL,
              },
            },
          }) => {
            const fileName = invoiceNumber.split('/').join('-');
            invoices.push({
              description: fileName,
              fileName,
              date: new Date(invoiceDate),
              downloadURL,
            });
          },
        );
      } else if (data.numFound > 0) {
        nextPageLink = data
          ._links
          .self
          .href
          .replace(/limit=[\d]{1,}/, 'limit=100')
          .replace('mriapi.minvas.metronom.com', 'docs.makro.nl/mriapi');
      }
    }

    while (nextPageLink) {
      const { cookie, userAgent } = await this.getAuthAccess();
      const currentPageInvoiceListResponse = await fetch(nextPageLink, {
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          authorization: this.authorization,
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          cookie,
          'Referrer-Policy': 'no-referrer',
          'user-agent': userAgent,
        },
        body: null,
        method: 'GET',
      });
      nextPageLink = '';
      if (currentPageInvoiceListResponse) {
        const data = await currentPageInvoiceListResponse.json();
        if (
          !!data
        && data._embedded
        && Array.isArray(data._embedded.customerInvoices)
        ) {
          nextPageLink = (data
            ._links
            .next || '')
            .replace('mriapi.minvas.metronom.com', 'docs.makro.nl/mriapi');
          data._embedded.customerInvoices.forEach(
            ({
              invoiceNumber,
              invoiceDate,
              _links: {
                download: {
                  href: downloadURL,
                },
              },
            }) => {
              const fileName = invoiceNumber.split('/').join('-');
              invoices.push({
                description: fileName,
                fileName,
                date: new Date(invoiceDate),
                downloadURL,
              });
            },
          );
        }
      }
    }
    return invoices;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList = (invoiceList) => invoiceList.map((invoice) => invoice);

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    const { cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(downloadURL.replace('mriapi.minvas.metronom.com', 'docs.makro.nl/mriapi'), {
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          authorization: this.authorization,
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          cookie,
          'Referrer-Policy': 'no-referrer',
          'user-agent': userAgent,
        },
        body: null,
        method: 'GET',
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return {
        buffer: Buffer.from(arrayBuffer || []),
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

module.exports = MakroProvider;
