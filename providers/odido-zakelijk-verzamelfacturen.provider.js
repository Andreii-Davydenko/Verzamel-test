const {
  subYears, isBefore, isEqual, isAfter,
} = require('date-fns');
const Provider = require('./provider');

class OdidoZakelijkVerzamelfacturenProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Odido Zakelijk - Verzamelfacturen';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.odido.nl/zakelijk/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.odido.nl/zakelijk/my/verzamelfacturen';

  /**
 * @private
 * @type {string}
 */
  downloadBaseUrl = 'https://www.odido.nl/zakelijk/my/verzamelfacturen?action=Download&id=';

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
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    if (!this.authDone) {
      await this.handle2FA(code);
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const preFilteredInvoiceList = this.getInvoicesFromLast12Months(invoiceListNormalized);
    const invoiceListFiltered = this.applyFilters(preFilteredInvoiceList);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(invoice.href);
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            fileName: `${invoice.description}`,
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
   * @public
   * @return {Promise<void>}
   */
  async authenticate() {
    const {
      cookieButton,
      modalCloseButton,
      username,
      password,
      loginButton,
      emailError,
      passwordError,
      loginError,
    } = {
      cookieButton: '#Row1_Column1_Cell1_CookieSettings_AdvancedSaveAccept',
      modalCloseButton: '.modal-close-button',
      username: '#Section1_Row1_Column1_Cell1_Login_Username',
      password: '#Section1_Row1_Column1_Cell1_Login_Password',
      loginButton: '#Section1_Row1_Column1_Cell1_Login_LoginButton',
      emailError: '#Section1_Row1_Column1_Cell1_Login_Username-error',
      passwordError: '#Section1_Row1_Column1_Cell1_Login_Password-error',
      loginError: '.callout-danger',
    };

    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForLoadState('domcontentloaded');

      if (await this.page.locator(cookieButton).isVisible()) {
        await this.page.locator(cookieButton).click();
      }

      const isModalPresent = await this.page.locator(modalCloseButton).isVisible();
      if (isModalPresent) {
        await this.page.locator(modalCloseButton).click();
      }

      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);

      await this.page.locator(loginButton).click();

      if (await this.page.locator(emailError).isVisible()
          || await this.page.locator(passwordError).isVisible()
          || await this.page.locator(loginError).isVisible()) {
        throw new Error('authenticationFailed');
      }

      await this.page.waitForLoadState('domcontentloaded');
      const is2faForm = await this.page.locator('[data-interaction-id="verify-2fa-Pincode"]');
      if (await is2faForm.isVisible()) {
        this.onSuccess('2FA sent successfully');
      } else {
        this.onSuccess('Authentication complete');
        this.authDone = true;
      }
      return this.fetch.bind(this);
    } catch (error) {
      await this.onPageError(error, this.page);
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
      const [c0, c1, c2, c3] = code.split('');
      await this.page.locator('[name="verification-code"]').nth(0).type(c0);
      await this.page.waitForTimeout(800);
      await this.page.locator('[name="verification-code"]').nth(1).type(c1);
      await this.page.waitForTimeout(800);
      await this.page.locator('[name="verification-code"]').nth(2).type(c2);
      await this.page.waitForTimeout(800);
      await this.page.locator('[name="verification-code"]').nth(3).type(c3);
      const invalidCode = this.page.getByText('De code klopt niet. Probeer je het nog een keer?');
      if (await invalidCode.isVisible()) throw new Error('authenticationFailed');
      await this.page.waitForURL(this.invoiceUrl);
      this.onSuccess('2FA complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * Parses a Dutch date string and returns a Date object.
   * @param {string} dutchDateStr - Date string in Dutch format (e.g., 'januari 2023').
   * @return {Date}
   */
  dateParser(dutchDateStr) {
    const monthNames = {
      januari: '01',
      februari: '02',
      maart: '03',
      april: '04',
      mei: '05',
      juni: '06',
      juli: '07',
      augustus: '08',
      september: '09',
      oktober: '10',
      november: '11',
      december: '12',
    };

    const [month, year] = dutchDateStr.split(' ');
    const monthNumber = monthNames[month.toLowerCase()];
    return new Date(`${monthNumber}-01-${year}`);
  }

  // use the logic of filtering to get the invoices from the last 12 months : wrte the method

  /**
   * @private
   * @param {{date: *, download: *, website: *, description: *}[]} invoiceList
   * @return {{date: *, download: *, website: *, description: *}[]}
   */
  getInvoicesFromLast12Months(invoiceList) {
    if (this.filters?.to && this.filters?.from) { return invoiceList; }

    const to = this.filters?.to ? new Date(this.filters.to) : new Date();
    const from = this.filters?.from ? new Date(this.filters.from) : subYears(to, 1);

    const invoiceListFiltered = invoiceList
      .filter((invoice) => (isAfter(invoice.date, from) && isBefore(invoice.date, to))
    || isEqual(invoice.date, from) || isEqual(invoice.date, to));

    return invoiceListFiltered;
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.waitForSelector('#Section1_Row2_Column1_Cell2_CompanyInvoices_Container');

      const invoiceList = await this.page.evaluate(() => {
        const invoiceElements = Array.from(document.querySelectorAll('#Section1_Row2_Column1_Cell2_CompanyInvoices_Container ul.list-group-inset > li '))
          .filter((el) => el.textContent.includes('Totaal excl. BTW')
          && !el.hasAttribute('data-toggle-id'));
        return invoiceElements.map((element) => {
          const monthYear = element.querySelector('.text-weight-bold').textContent.trim();
          const number = element.querySelector('.text-muted.text-italic').textContent.trim().split(' ')[1];
          const downloadId = element.querySelector('a[href*="/zakelijk/my/verzamelfacturen?action=Download"]').getAttribute('href').split('id=')[1];

          return {
            date: monthYear,
            number,
            downloadId,
          };
        });
      });

      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date, href: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      date: this.dateParser(invoice.date),
      description: invoice.number,
      href: `${this.downloadBaseUrl}${invoice.downloadId}`,
    }));
  }

  /**
     * @private
     * @param {{ link: String }} link
     * @return {Promise<import('playwright-core').Download>}
     */
  async getInvoiceDownload(invoiceLink) {
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
}

module.exports = OdidoZakelijkVerzamelfacturenProvider;
