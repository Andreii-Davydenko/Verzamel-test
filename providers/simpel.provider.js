const fs = require('fs/promises');
const Provider = require('./provider');

class SimpelProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Simpel';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://mijn.simpel.nl/login';

  /**
   * @private
   * @type {string}.
   */
  invoiceUrl = 'https://mijn.simpel.nl/facturen?sid=SUBSCRIPTION_ID';

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
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(invoice.description);
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
      username: '#username',
      password: '#password',
      submitButton: 'button[name="login"]',
      errorMessage: 'div.o-alert.--error',
      cookieNotice: 'div#initial',
      rememberLogin: 'input#remember',
      rememberLoginSVG: 'div:nth-of-type(4) svg',
      recaptchaIFrame: "iframe[title='reCAPTCHA']",
      cookieNoticeButton: 'button.btn.cookie-popup__accept-button',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        username,
        password,
        submitButton,
        errorMessage,
        cookieNotice,
        cookieNoticeButton,
        rememberLogin,
        rememberLoginSVG,
        recaptchaIFrame,
      } = selectors;
      const cookieNoticeActive = await this.page.locator(cookieNotice).isVisible();
      if (cookieNoticeActive) await this.page.locator(cookieNoticeButton).click();
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      try {
        const captchaFrame = (await this.page.waitForSelector(recaptchaIFrame)).isVisible();
        if (captchaFrame) {
          const captchaSolved = await this.page.solveRecaptchas();
          if (captchaSolved.solved[0].isSolved === false) throw new Error('CAPTCHA not solved');
          this.onSuccess('CAPTCHA solved');
        }
      } catch (error) {
        if (!(!!error && !!error.message && error.message.includes('Timeout'))) {
          throw error;
        }
      }
      try {
        const rememberLoginSVGFrame = await this.page.waitForSelector(
          rememberLoginSVG,
          { visible: true, timeout: 1000 },
        );
        rememberLoginSVGFrame.click();
      } catch (error) {
        if (!(!!error && !!error.message && error.message.includes('Timeout'))) {
          throw error;
        }
      }
      await this.page.evaluate((theSelectorToClick) => {
        document.querySelector(theSelectorToClick).click();
      }, rememberLogin);
      await this.page.locator(submitButton).click();
      try {
        await this.page.waitForURL(
          'https://mijn.simpel.nl/overzicht-abonnementen?previous_route=selfcare/dashboard',
          { timeout: 50000, waitUntil: 'domcontentloaded' },
        );
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

  async getDataFromPage() {
    return this.page.evaluate(() => {
      const initialList = document.querySelectorAll(
        'div.facturen.nes-w-full > div > div.nes-border-panel.nes-my-3',
      );
      return Array.from(initialList).map((currentDiv) => {
        const [
          invoiceIdAndStatusContainer,
          dateContainer,
          amountContainer, ,
          downloadsContainer,
        ] = currentDiv.children;
        return {
          invoiceId: invoiceIdAndStatusContainer
            .querySelector('#factuurnr')
            .textContent.trim(),
          status: invoiceIdAndStatusContainer
            .querySelector('#status')
            .textContent.trim(),
          date: dateContainer.querySelector('#datum').textContent.trim(),
          amount: Number(amountContainer
            .querySelector('#credit-debet')
            .textContent.trim().match(/\b\d{1,3}(?:,\d{1,2})?\b/)[0].replace(',', '.')),
          downloadURL: downloadsContainer
            .querySelector('a.nes-flex.nes-items-center.nes-button.nes-button-secondary.nes-w-full-resp.nes-mr-3.nes-mb-5')
            ?.href,
        };
      });
    });
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    try {
      const expectedInvoiceURL = this.invoiceUrl.replace('SUBSCRIPTION_ID', this.ws.accountId);
      await this.page.goto(expectedInvoiceURL, { timeout: 50000 });
      // expectedInvoiceURL
      if (this.page.url() !== expectedInvoiceURL) {
        throw new Error('invalidSubscriptionId');
      }
      const simpelClientCorrelationIdContent = await this.page.evaluate(() => {
        const simpelClientCorrelationId = document.querySelector('meta[name="simpel:client-correlation-id"]');
        return (!!simpelClientCorrelationId
        && !!simpelClientCorrelationId.content)
          ? null
          : simpelClientCorrelationId.content;
      });
      const { cookie, pageURL, userAgent } = await this.getAuthAccess();
      const response = await fetch(
        `https://mijn.simpel.nl/api/invoice/latest?sid=${this.ws.accountId}`,
        {
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-client-correlation-id': simpelClientCorrelationIdContent,
            cookie,
            'user-agent': userAgent,
            Referer: pageURL,
            'Referrer-Policy': 'strict-origin-when-cross-origin',
          },
          body: null,
          method: 'GET',
        },
      );
      const responseText = await response.text();
      return JSON.parse(responseText);
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      if (error.message === 'invalidSubscriptionId') {
        throw new Error('invalidSubscriptionId');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  convertDateFormat(inputDate) {
    inputDate.setDate(1);
    return inputDate;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.number,
      fileName: invoice.number,
      date: this.convertDateFormat(new Date(invoice.invoiceDate)),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId) {
    const { cookie, pageURL, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(
        `https://mijn.simpel.nl/facturen/${invoiceId}/pdf?sid=${this.ws.accountId}`,
        {
          headers: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
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
        },
      );
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

module.exports = SimpelProvider;
