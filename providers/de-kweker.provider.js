/* eslint-disable no-restricted-syntax */
const fs = require('fs/promises');
const Provider = require('./provider');

class DeKwekerProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'De Kweker';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.dekweker.nl/login.html';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.dekweker.nl/mijn-account/facturen-pakbonnen.html';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

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
    if (!this.filters) {
      this.filters = {};
    }
    if (!this.filters.to && !this.filters.from) {
      this.filters.to = new Date();
      this.filters.from = new Date(
        this.filters.to.getFullYear(),
        this.filters.to.getMonth() - 3,
        this.filters.to.getDate(),
      );
    } else if (!this.filters.to) {
      this.filters.to = new Date(
        this.filters.from.getFullYear(),
        this.filters.from.getMonth() + 3,
        this.filters.from.getDate(),
      );
    } else if (!this.filters.from) {
      this.filters.from = new Date(
        this.filters.to.getFullYear(),
        this.filters.to.getMonth() - 3,
        this.filters.to.getDate(),
      );
    }

    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = [];
      for (const currentInvoice of invoiceListFiltered) {
        const download = await this.getInvoiceDownload(
          currentInvoice.description,
          currentInvoice.downloadURL,
        );
        this.updateFetchStatus(invoiceListFiltered.length);
        invoiceData.push({
          ...currentInvoice,
          date: this.formatDate(currentInvoice.date),
          download,
          wsName: this.ws.name,
        });
      }
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
      username: 'input[name="login-emailaddress"]',
      password: 'input[name="login__password"]',
      submitButton: 'input[name="cmp-login-form-submit"]',
      errorMessage: 'div.notification.notification--error',
      cookieNoticeButton: 'button.cmp-cookie__info--accept-all',
    };
    try {
      const whenDomContentLoaded = this.page.waitForLoadState('domcontentloaded');
      await this.page.goto(this.authUrl, { timeout: 50000 });
      await whenDomContentLoaded;
      const {
        username,
        password,
        submitButton,
        errorMessage,
        cookieNoticeButton,
      } = selectors;
      const cookieNoticeActive = await this.waitForSelector(
        this.page,
        cookieNoticeButton,
        60000,
      );
      if (cookieNoticeActive) {
        await this.page.locator(cookieNoticeButton).click();
      }
      await this.waitForSelector(this.page, username, 60000);
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      try {
        await this.page.locator(submitButton).click();
        await this.page.waitForURL('https://www.dekweker.nl/home.html', {
          waitUntil: 'domcontentloaded',
        });
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
   * @return { {cookie: String, pageURL: String, userAgent: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    const pageURL = await this.page.url();
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    return { cookie, pageURL, userAgent };
  }

  async getDataFromPage() {
    const dataScriptSelector = 'script[data-hypernova-key="SfgInvoices"]';
    await this.waitForSelector(this.page, dataScriptSelector, 60000);
    return this.page.evaluate(
      (scriptSelector) => JSON.parse(
        document
          .querySelector(scriptSelector)
          .textContent.replace('\x3C!--{', '{')
          .replace('}-->', '}'),
      ).propsData.responseInvoices,
      dataScriptSelector,
    );
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    await this.page.goto(this.invoiceUrl, { timeout: 50000 });
    await this.page.waitForURL(this.invoiceUrl, {
      timeout: 50000,
      waitUntil: 'domcontentloaded',
    });
    return (await this.getDataFromPage()) || [];
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceId,
      fileName: invoice.invoiceId,
      date: new Date(invoice.invoiceDate),
      downloadURL: `https://www.dekweker.nl/api/user/dekweker/invoices/document/${invoice.documentId}`,
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    const { cookie, pageURL, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(downloadURL, {
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua':
            '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          cookie,
          'user-agent': userAgent,
          'upgrade-insecure-requests': '1',
          Referer: pageURL,
          'Referrer-Policy': 'same-origin',
        },
        body: null,
        method: 'GET',
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

module.exports = DeKwekerProvider;
