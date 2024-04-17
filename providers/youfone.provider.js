const Provider = require('./provider');

class YoufoneProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Youfone';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://my.youfone.nl/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://my.youfone.nl/facturen';

  /**
   * @private
   * @type {string}
   */
  downloadLinkPrefix = 'https://my.youfone.nl/facturen/';

  /**
   * @private
   * @type {boolean}
   */
  authError = false;

  /**
   * @private
   * @type {boolean}&
   */
  requires2FA = false;

  /**
   * @public
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);

      const invoiceData = [];

      /* eslint-disable no-restricted-syntax, no-await-in-loop */
      for (const invoice of invoiceListFiltered) {
        const downloadLink = this.downloadLinkPrefix + invoice.invoiceId;

        try {
          const download = await this.getDownload(downloadLink);
          this.updateFetchStatus(invoiceListFiltered.length);
          const invoiceDetails = {
            ...invoice,
            description: invoice.invoiceId,
            date: this.formatDate(invoice.date),
            download,
            fileName: invoice.invoiceId,
            wsName: this.ws.name,
          };
          invoiceData.push(invoiceDetails);
        } catch (error) {
          this.logger.error('Error: ', error.toString());
          throw new Error('failedToFetchInvoicesFromWebsite');
        }
      }
      return invoiceData;
    } catch (error) {
      if (this.authError) {
        throw new Error('authenticationFailed');
      }
      this.logger.error('Error: ', error.toString());
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  parseDate(dateString) {
    const months = {
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
    const [day, month, year] = dateString.split(' ');
    return new Date(year, months[month], day);
  }

  /**
   * @private
   * @return {Promise<Awaited<{invoiceId: *, date: *}>[]>}
   */
  async getInvoiceList() {
    await this.page.click('div[class="select__top"]');
    await this.page.waitForTimeout(1000);

    const selectionRows = Array.from(await this.page.$$('.select__options-item'));

    const selectionCriteria = await Promise.all(selectionRows.map(async (row) => {
      const elementContent = await row.textContent();
      return elementContent === this.ws.accountId;
    }));

    const accountSelected = selectionRows.filter((row, index) => selectionCriteria[index])[0];

    await accountSelected.click();
    await this.page.waitForLoadState('load');
    await this.page.waitForTimeout(5000);

    const invoiceList = Array.from(await this.page.$$('.data-value:not(:has(*)):not(:empty)'));
    const invoiceContentList = await Promise.all(invoiceList.map(async (invoice) => {
      const elementContent = await invoice.textContent();
      return elementContent;
    }));

    const dates = invoiceContentList
      .filter((_, index) => index % 3 === 1)
      .map((date) => this.parseDate(date));
    const invoiceIds = invoiceContentList.filter((_, index) => index % 3 === 2);

    return dates.map((date, index) => ({
      date,
      invoiceId: invoiceIds[index],
    }));
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async goToLogin() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForURL(this.authUrl, { waitUntil: 'load' });
      return true;
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      email: 'input[type="text"]',
      password: 'input[type="password"]',
      submitButton: 'button[type="submit"]',
      cookieButton: 'button[id="onetrust-accept-btn-handler"]',
      recaptchaCheckBox: 'span[class="recaptcha-checkbox"]',
    };

    try {
      await this.goToLogin();
      await this.page.waitForTimeout(5000);
      const {
        email,
        password,
        submitButton,
        cookieButton,
        recaptchaCheckBox,
      } = selectors;

      await this.page.click(cookieButton);
      await this.page.fill(email, this.ws.username);
      await this.page.fill(password, this.ws.password);
      await this.page.click(submitButton);

      await this.page.waitForLoadState('load');
      await this.page.waitForTimeout(5000);
      const currentUrl = this.page.url();

      if (currentUrl === this.authUrl) {
        await this.page.fill(email, this.ws.username);
        await this.page.fill(password, this.ws.password);
        await this.page.click(recaptchaCheckBox);
        await this.page.click(submitButton);

        await this.page.waitForTimeout(300);
        const finalUrl = await this.page.url();

        if (finalUrl === this.authUrl) {
          this.authError = true;
          await this.onPageError('Error: authenticationFailed', this.page);
          throw new Error();
        }
      }

      await this.page.goto(this.invoiceUrl);
      await this.page.waitForURL(this.invoiceUrl, { waitUntil: 'load' });
      this.onSuccess('Authentication complete');

      const cookies = await this.page.context().cookies();
      process.env.COOKIES = JSON.stringify(cookies);
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error(error);
    }
  }

  async getDownload(link) {
    try {
      await this.page.goto(link);
      await this.page.waitForTimeout(5000);

      const downloadPromise = this.page.waitForEvent('download');
      await this.page.waitForSelector('#download');
      await this.page.click('#download');
      const download = await downloadPromise;
      await download.path();
      this.onSuccess('PDF prefetch complete', link);
      return download;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = YoufoneProvider;
