const fs = require('fs/promises');
const Provider = require('./provider');

class VimexxProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Vimexx';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.vimexx.nl/inloggen';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://my.vimexx.nl/order';

  /**
   * @private
   * @type {string}
   */
  dashboardUrl = 'https://my.vimexx.nl/dashboard';

  /**
   * @private
   * @type {string}
   */
  apiUrl = 'https://my.vimexx.nl/webapi/v1/orders?order%5Bname%5D=created_at&order%5Bsort%5D=DESC&page=1&limit=15';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  clientId = undefined;

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
          const download = await this.getInvoiceDownload(invoice.description, invoice.downloadURL);
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

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    const selectors = {
      cookiebutton: '#cookie-dialog-bar button',
      username: 'input[type=\'email\']',
      password: '#form-login input[type=\'password\']',
      submitButton: '#form-login button[type=\'submit\']',
      recaptcha: '#form-login iframe[title="reCAPTCHA"]',
      errorMessages: '#messages',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        cookiebutton,
        username,
        password,
        submitButton,
        recaptcha,
        errorMessages,
      } = selectors;
      const loginFrame = await this.page.waitForSelector(username);
      await this.page.locator(cookiebutton).click();
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      try {
        await this.page.locator(submitButton).click();
        await this.page.waitForURL(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
      } catch (error) {
        const loginError = await this.page.locator(errorMessages);
        if (loginError?.isVisible()) {
          await this.onPageError(new Error('Invalid credentials'), this.page);
          throw new Error('authenticationFailed');
        }
        const captchaFrame = await this.page.waitForSelector(recaptcha, { timeout: 5000 });
        if (captchaFrame.isVisible()) {
          const captchaSolved = await this.page.solveRecaptchas();
          if (
            !!captchaSolved
            && !!captchaSolved.solved[0]
            && captchaSolved.solved[0].isSolved === false
          ) {
            await this.onPageError(new Error('Invalid credentials'), this.page);
            throw new Error('CAPTCHA not solved');
          }
          this.onSuccess('CAPTCHA solved');
          if (loginFrame) {
            try {
              await this.page.type(username, this.ws.username);
              await this.page.type(password, this.ws.password);
              await this.page.locator(submitButton).click();
              await this.page.waitForURL(
                this.dashboardUrl,
                { waitUntil: 'domcontentloaded' },
              );
            } catch (err) {
              await this.onPageError(err, this.page);
              throw new Error('authenticationFailed');
            }
          }
        }
      }
      this.onSuccess('Authentication complete');
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
      return (await this.page.context().cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join(';');
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

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl, { timeout: 50000 });
      await this.page.waitForURL(this.invoiceUrl, {
        timeout: 50000, waitUntil: 'domcontentloaded',
      });
      const { cookie, pageURL, userAgent } = await this.getAuthAccess();
      let results;
      try {
        await fetch(this.apiUrl, {
          headers: {
            authority: 'my.vimexx.nl',
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            cookie,
            Referer: pageURL,
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': userAgent,
          },
          body: null,
          method: 'GET',
        }).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        }).then((jsonResponse) => {
          results = jsonResponse.data.map((item) => ({
            invoiceId: item.id,
            invoiceName: item.invoice.name,
            date: new Date(item.created_at),
          }));
        }).catch((error) => {
          this.onError(new Error(`'Error occurred:', ${error.message}`));
          throw new Error('failedToFetchInvoicesFromWebsite');
        });
        return results;
      } catch (error) {
        this.onError(new Error(`'Error occurred:', ${error.message}`));
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  convertDateFormat(date) {
    const ParsedDate = new Date(new Date(date).getTime() + 5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const SplitedDate = ParsedDate.split('-');
    const day = SplitedDate[2];
    const month = SplitedDate[1];
    const year = SplitedDate[0];

    // Create a new date string in the "MM/DD/YYYY" format
    const newDateFormat = `${month}/${day}/${year}`;

    return newDateFormat;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceName,
      fileName: invoice.invoiceName,
      date: new Date(this.convertDateFormat(invoice.date)),
      downloadURL: `https://my.vimexx.nl/webapi/v1/order/${invoice.invoiceId}/downloadPdf`,
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
          authority: 'my.vimexx.nl',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          cookie,
          Referer: pageURL,
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
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

module.exports = VimexxProvider;
