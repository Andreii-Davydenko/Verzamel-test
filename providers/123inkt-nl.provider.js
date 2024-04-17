const fs = require('fs/promises');
const Provider = require('./provider');

class InktNl123Provider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = '123Inkt.nl';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.123inkt.nl/customer/login.html';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.123inkt.nl/customer/invoices.html';

  /**
 * @private
 * @type {string}
 */
  accountUrl = 'https://www.123inkt.nl/customer/myaccount.html';

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

      const invoiceData = await Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getInvoiceDownload(invoice.link, invoice.date);
        this.updateFetchStatus(invoiceList.length);

        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.invoiceId,
          download,
          fileName: invoice.invoiceId,
          wsName: this.ws.name,
        };
      }));
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) throw error;
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    } finally {
      await this.page.close();
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      acceptCookies: 'button[name="cookie-preferences"]',
      username: 'input[id="email_login"]',
      password: 'input[id="password"]',
      submitButton: 'input[id="btnLoginMid"]',
      errorMessages: 'div[data-role="login-errormessage"]',
      recaptchaIFrame: 'iframe[title="recaptcha challenge expires in two minutes"]',
    };

    try {
      await this.page.goto(this.authUrl);
      const {
        username,
        password,
        submitButton,
        acceptCookies,
        recaptchaIFrame,
      } = selectors;
      await this.page.waitForSelector(acceptCookies);
      if (acceptCookies) {
        await this.page.click(acceptCookies);
      }
      await this.page.locator(username);
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      try {
        await this.page.locator(submitButton).click();
        await this.page.waitForURL(
          this.accountUrl,
          { waitUntil: 'domcontentloaded' },
        );
      } catch (error) {
        const captchaFrame = await this.page.locator(recaptchaIFrame);
        const isCaptchaFrameVisible = await captchaFrame.isVisible();

        if (isCaptchaFrameVisible) {
          const captchaSolved = await this.page.solveRecaptchas();
          if (
            !!captchaSolved
            && !!captchaSolved.solved[0]
            && captchaSolved.solved[0].isSolved === false
          ) {
            throw new Error('CAPTCHA not solved');
          }
          this.onSuccess('CAPTCHA solved');

          await this.page.waitForURL(
            this.accountUrl,
            { waitUntil: 'domcontentloaded' },
          );
        } else throw error;
      }
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
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForURL(this.invoiceUrl, { waitUntil: 'load' });

      const list = [];
      let isLastPage = false;
      while (!isLastPage) {
        await this.page.waitForSelector('fieldset[data-test="account-paid-invoice"]');

        const thisPageInvoices = await this.page.evaluate(() => {
          const tableRows = Array.from(
            document.querySelectorAll('fieldset[data-test="account-paid-invoice"] table tbody tr.uaProdRow'),
          ).filter((row) => {
            const dataTestAttribute = row.getAttribute('data-test');
            return dataTestAttribute && /^account-invoice-\d+$/.test(dataTestAttribute);
          });

          return tableRows.map((row) => {
            const columns = row.querySelectorAll('td');
            const date = columns[0].textContent.trim();
            const invoiceId = columns[1].textContent.trim();
            const link = columns[5].querySelector('a[title="Bekijk factuur"]').href;

            return {
              invoiceId,
              date,
              link,
            };
          });
        });

        list.push(...thisPageInvoices);

        const prevYearButton = await this.page.$('input[data-test="account-invoice-previous-year-button"]:not([disabled])');
        if (prevYearButton) {
          await prevYearButton.click();
          await this.page.waitForLoadState('load');
        } else {
          isLastPage = true;
        }
      }
      this.onSuccess('Collect invoice list complete', list);
      return list;
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
  parseDateString(dateString) {
    const dateStringWithoutDot = dateString.replace('.', '');

    const monthMap = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      mei: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      okt: '10',
      nov: '11',
      dec: '12',
    };

    const [day, monthAbbr, year] = dateStringWithoutDot.split(' ');
    const month = monthMap[monthAbbr.toLowerCase()];

    const dateFormat = `${month}-${day}-${year}`;
    return dateFormat;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{invoiceId: String, link: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      link: invoice.link,
      date: new Date(this.parseDateString(invoice.date)),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(link) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto(link, { waitUntil: 'load' });
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
}

module.exports = InktNl123Provider;
