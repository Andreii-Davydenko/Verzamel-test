const Provider = require('./provider');

class BolZakelijkProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Bol.com Zakelijk';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.bol.com/nl/rnwy/account/facturen/betaald';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = true;

  /**
   * @public
   * @param {String}
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch(code) {
    try {
      if (!this.authDone) await this.handle2FA(code);

      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          while (currentDownloads > maxDownloads) {
            await new Promise((resolve) => {
              setTimeout(resolve, 1000);
            });
          }
          currentDownloads += 1;

          const { download, invoiceId } = await this.getInvoiceDownload(invoice.link);
          this.updateFetchStatus(invoiceList.length);

          currentDownloads -= 1;
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            description: invoiceId,
            download,
            fileName: invoiceId,
            wsName: this.ws.name,
          };
        }),
      );
      // await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) throw error;
      await this.onPageError(error, this.page);
      // await this.page.close();
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      acceptCookies: 'button#onetrust-accept-btn-handler',
      username: 'input[name="j_username"]',
      password: 'input[name="j_password"]',
      submitButton: 'button[type="SUBMIT"]',
      recaptchaIFrame: 'iframe[title="reCAPTCHA"]',
    };

    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'domcontentloaded' });
      const {
        username, password, submitButton, acceptCookies, recaptchaIFrame,
      } = selectors;

      if (await this.page.locator(acceptCookies).isVisible()) {
        await this.page.click(acceptCookies);
      }
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);

      try {
        this.onSuccess('trying');
        const captchaFrame = await this.page.waitForSelector(recaptchaIFrame);
        if (await captchaFrame.isVisible()) {
          this.onSuccess('Solving CAPTCHA');
          const captchaSolved = await this.page.solveRecaptchas();
          if (
            !!captchaSolved
          && !!captchaSolved.solved[0]
          && captchaSolved.solved[0].isSolved === false
          ) {
            throw new Error('CAPTCHA not solved');
          }
          this.onSuccess('CAPTCHA solved');
        }
      } catch (error) { /* empty */ }
      await this.page.locator(submitButton).click();

      const verificationCode = this.page.locator('input[name="otp"]');
      if (await verificationCode.isVisible()) {
        this.onSuccess('Verification code sent');
      } else {
        await this.page.waitForURL(this.invoiceUrl, {
          waitUntil: 'domcontentloaded',
        });
        this.onSuccess('Authentication complete');
        this.authDone = true;
      }
      return this.fetch.bind(this);
    } catch (error) {
      await this.onPageError(error, this.page);
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('#otp_varification_table input[type="text"]').fill(code);

      const submitBtn = await this.page.locator('#ctl00_cphMain_UcUserLoginControl1_btnVerifyOtp');
      await this.page.evaluate(() => {
        document.querySelector('#ctl00_cphMain_UcUserLoginControl1_btnVerifyOtp').removeAttribute('disabled');
      });
      await submitBtn.click();

      await this.page.waitForLoadState('load');
      if (this.page.url() === this.authUrl) {
        throw new Error('2FA Verification Failed');
      }
      this.authDone = true;
      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const selectors = {
      cookieButton: 'button#js-first-screen-accept-all-button',
      acceptDsBtn: 'button#js-ds-accept-button',
    };

    const { cookieButton, acceptDsBtn } = selectors;
    try {
      if (await this.page.locator(cookieButton).isVisible()) {
        await this.page.waitForTimeout(5000);
        await this.page.locator(cookieButton).click();
      }

      await this.page.waitForLoadState('domcontentloaded');

      if (await this.page.locator(acceptDsBtn).isVisible()) {
        await this.page.waitForTimeout(10000);
        await this.page.locator(acceptDsBtn).click();
      }
      await this.page.waitForLoadState('domcontentloaded');

      /**
       *
       * @param {string} link
       * @returns {Promise<{date: string, link: string}>}
       */
      const getDetails = async (link) => {
        try {
          const ctx = this.page.context();
          const page = await ctx.newPage();
          await page.goto(`https://www.bol.com${link}`);

          const details = await page.evaluate(() => {
            const date = document.querySelector('div[data-testid="invoice-details-content"] a').textContent.trim();
            const downloadLink = document.querySelector('a[data-testid="download-invoice-button"]').getAttribute('href');
            return {
              date,
              downloadLink,
            };
          });
          await page.close();
          return details;
        } catch (err) {
          this.onError(new Error(err));
          throw new Error('failedToFetchInvoicesFromWebsite');
        }
      };

      /**
       *
       * @param {string} text
       * @returns {Promise<{void}>}
       */
      const showAllInvoices = async (text) => {
        const moreBtn = this.page.getByText(text);
        let hasMoreInvoices = await moreBtn.isVisible();
        while (hasMoreInvoices) {
          await moreBtn.click();
          await new Promise((resolve) => {
            setTimeout(resolve, 5000);
          });
          hasMoreInvoices = await this.page.getByText(text).isVisible();
        }
      };

      const invoicesList = [];

      if (await this.page.locator('div[data-testid="paid-invoice-bundle"]').isVisible()) {
        await showAllInvoices('Toon meer');
        const betaaldInvoices = await this.page.$$eval('a[data-testid="open-invoice-link"]', (invoices) => invoices.map((invoice) => invoice.getAttribute('href')));
        for (let i = 0; i < betaaldInvoices.length; i += 1) {
          const details = await getDetails(betaaldInvoices[i]);
          invoicesList.push(details);
        }
      }

      await this.page.goto('https://www.bol.com/nl/rnwy/account/facturen/openstaand');

      if (await this.page.locator('div[data-testid="paid-invoice-bundle"]').isVisible()) {
        await showAllInvoices('Toon meer');
        const openstaandInvoices = await this.page.$$eval('a[data-testid="open-invoice-link"]', (invoices) => invoices.map((invoice) => invoice.getAttribute('href')));
        for (let i = 0; i < openstaandInvoices.length; i += 1) {
          const details = await getDetails(openstaandInvoices[i]);
          invoicesList.push(details);
        }
      }

      this.onSuccess('Collect invoice list complete', invoicesList);
      return invoicesList;
    } catch (error) {
      this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String}
   * @return {Date}
   */
  parseDate(dateString) {
    const monthMap = {
      januari: 0,
      februari: 1,
      maart: 2,
      april: 3,
      mei: 4,
      juni: 5,
      juli: 6,
      augustus: 7,
      september: 8,
      oktober: 9,
      november: 10,
      december: 11,
    };

    const [day, monthString, year] = dateString.split(' ');
    const month = monthMap[monthString.toLowerCase()];
    const date = new Date(year, month, day);
    return date;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.downloadLink.split('=')[1],
      link: invoice.downloadLink,
      date: this.parseDate(invoice.date),
    }));
  }

  /**
   * @private
   * @param {string} invoiceHref
   * @return {Promise<{download: import('playwright-core').Artifact, invoiceId: string}>}
   */
  async getInvoiceDownload(invoiceHref) {
    const invoiceLink = `https://www.bol.com${invoiceHref}`;
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.setAttribute('href', `${href}`);
        link.click();
      }, invoiceLink);
      const download = await downloadPromise;
      await download.path();
      const invoiceId = download.suggestedFilename().split('.pdf')[0];
      await page.close();
      this.onSuccess('PDF prefetch complete', { invoiceId });
      return { download, invoiceId };
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = BolZakelijkProvider;
