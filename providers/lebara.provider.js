const Provider = require('./provider');

class LebaraProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Lebara';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.lebara.nl/nl/mylebara/postpaid-bills.html';

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
  requires2FA = false;

  /**
   * @public
   * @param {String}
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    try {
      await this.authenticate();

      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      const invoiceData = await Promise.all(invoiceListFiltered.map(async (invoice) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
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
      }));
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) throw error;
      await this.onPageError(error, this.page);
      await this.page.close();
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
      username: 'input#email',
      password: 'input#password',
      submitButton: 'button[data-testid="login-btn"]',
      errorMessages: 'div[data-role="login-errormessage"]',
      recaptchaIFrame: 'iframe[title="reCAPTCHA"]',
    };

    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'domcontentloaded' });
      const {
        username,
        password,
        submitButton,
        acceptCookies,
        recaptchaIFrame,
      } = selectors;
      await this.page.waitForSelector(acceptCookies, { timeout: 200000 });
      if (acceptCookies) {
        await this.page.click(acceptCookies);
      }
      await this.page.locator(username);
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      const isCaptchaFrameVisible = this.page.locator(recaptchaIFrame).first();

      if (isCaptchaFrameVisible.isVisible()) {
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
      await this.page.locator(submitButton).click();
      await this.page.waitForURL(this.invoiceUrl, { waitUntil: 'domcontentloaded' });
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (error) {
      await this.onPageError(error, this.page);
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    try {
      await this.page.waitForSelector('.css-1ia1aj');

      const moreBtnEl = 'Meer bekijken';
      const moreBtn = this.page.getByText(moreBtnEl);
      let hasMoreInvoices = moreBtn.isVisible();
      while (hasMoreInvoices) {
        await moreBtn.click();
        await new Promise((resolve) => { setTimeout(resolve, 1000); });
        hasMoreInvoices = await this.page.getByText(moreBtnEl).isVisible();
      }

      const invoices = await this.page.evaluate(() => {
        const tableRows = Array.from(
          document.querySelectorAll('.css-1ia1aj'),
        );
        const inv = tableRows.map((row) => {
          const date = row.querySelector('p.chakra-text.css-z7nf62').textContent.trim();
          const { ...values } = row;
          const reactFiberKey = Object.keys(values).find((key) => key.startsWith('__reactFiber$'));
          const reactFiber = values[reactFiberKey];
          const link = reactFiber.return.key;

          return {
            date,
            link,
          };
        });
        return inv;
      });

      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
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
    const datePart = dateString.split(': ')[1];
    const [day, month, year] = datePart.split('.').map(Number);
    return new Date(year, month - 1, day);
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      link: invoice.link,
      date: this.parseDate(invoice.date),
    }));
  }

  /**
   * @private
   * @param {string} invoiceLink
   * @return {Promise<{download: import('playwright-core').Artifact, invoiceId: string}>}
   */
  async getInvoiceDownload(invoiceLink) {
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

module.exports = LebaraProvider;
