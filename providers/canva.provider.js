const fs = require('fs/promises');
const { parse } = require('date-fns');
const Provider = require('./provider');

class CanvaProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Canva';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.canva.com/nl_nl/login/';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.canva.com/settings/purchase-history';

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
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch(code) {
    if (this.requires2FA) {
      await this.handle2FA(code);
    }
    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.href);
        this.updateFetchStatus(invoiceListFiltered.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.invoiceNumber,
          fileName: invoice.invoiceNumber,
          download,
        };
      }));
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    // Month names in Dutch and English
    const monthNames = {
      januari: 'January',
      februari: 'February',
      maart: 'March',
      april: 'April',
      mei: 'May',
      juni: 'June',
      juli: 'July',
      augustus: 'August',
      september: 'September',
      oktober: 'October',
      november: 'November',
      december: 'December',
    };
    const dateComponents = date.split(' ');
    // Convert the month to English
    const englishMonth = monthNames[dateComponents[1]];
    const englishDateStr = `${dateComponents[0]} ${englishMonth} ${dateComponents[2]}`;

    return parse(englishDateStr, 'dd MMMM yyyy', new Date());
  }

  /**
   * @private
   * @return {Promise<{
   *  status: string,
   *  date: string,
   *  wsName: string,
   *  href: string,
   *  invoiceNumber: string
   * }[]>}
   */
  async getInvoiceList() {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.setViewportSize({ width: 1600, height: 1200 });
      await page.goto(this.invoiceUrl, { waitUntil: 'networkidle' });
      await page.waitForSelector('td span, td p');
      const invoiceHandles = await page.$$('tbody tr');
      const invoiceList = await Promise.all(invoiceHandles.map(async (invoiceHandle) => {
        const status = await invoiceHandle.$eval('td:nth-child(4)', (e) => e.textContent.trim());
        const date = await invoiceHandle.$eval('td:nth-child(3)', (e) => e.textContent.trim());
        const href = await invoiceHandle.$eval('td:nth-child(6) a', (e) => e.getAttribute('href'));
        const invoiceNumber = href.split('/').pop();
        return {
          status,
          date: this.parseDate(date),
          wsName: this.ws.name,
          href,
          invoiceNumber,
        };
      }));
      this.onSuccess('Collect invoice list complete', invoiceList);
      await page.close();
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto(link, { waitUntil: 'load' });
      await page.waitForSelector('main');
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: 'A4',
        displayHeaderFooter: false,
        margin: {
          top: '10px',
          bottom: '10px',
          left: '10px',
          right: '10px',
        },
      });
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(pdf),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await page.close();
      this.onError(
        new Error(`${link} Request failed.`),
      );
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('[inputmode="numeric"]').fill(code);
      await this.page.waitForTimeout(7000);
      await this.page.waitForLoadState('domcontentloaded');
      if (this.page.url() === this.authUrl) {
        this.onError(new Error('Invalid Verification Code'));
        throw new Error('authenticationFailed');
      }
      await this.page.waitForURL('https://www.canva.com');
      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @public
   * @return {Promise<Function>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);
      await this.page.locator('//button[.//span[contains(text(), "e-mailadres")]]').click();
      await this.page.locator('[inputmode="email"]').fill(this.ws.username);
      await this.page.locator('[type="submit"]').click();
      const invalidEmailType = await this.page
        .locator('form p')
        .isVisible();
      if (invalidEmailType) {
        this.onError(new Error('Invalid Email Type'));
        throw new Error('authenticationFailed');
      }
      await this.page.waitForResponse('https://www.canva.com/_ajax/profile/authentication/options');
      const invalidEmailAddress = await this.page
        .locator('[autocomplete="name"]')
        .isVisible();
      if (invalidEmailAddress) {
        this.onError(new Error('Invalid Email Address'));
        throw new Error('authenticationFailed');
      }
      const hasPasswordField = await this.page
        .locator('[type="password"]')
        .isVisible();
      if (hasPasswordField) {
        this.requires2FA = false;
        await this.page.locator('[type="password"]').fill(this.ws.password);
        await this.page.locator('//button[.//span[contains(text(), "Inloggen")]]').click();
        await this.page.waitForResponse('https://www.canva.com/_ajax/login2');
        const invalidPassword = await this.page
          .locator('[role="alert"]')
          .isVisible();
        if (invalidPassword) {
          this.onError(new Error('Invalid Password'));
          throw new Error('authenticationFailed');
        }
        this.onSuccess('Authentication complete');
        this.authDone = true;
        return this.fetch.bind(this);
      }
      this.onSuccess('Verification code has been sent');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = CanvaProvider;
