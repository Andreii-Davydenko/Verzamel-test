const fs = require('fs/promises');
const { parse } = require('date-fns');
const Provider = require('./provider');

class ChannableProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Channable';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://app.channable.com/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://app.channable.com/companies/STORE_ID/pricing';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @public
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    await this.authenticate();
    const invoiceList = await this.getInvoiceList();
    const invoiceListFiltered = this.applyFilters(invoiceList);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.href);
        this.updateFetchStatus(invoiceListFiltered.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          description: invoice.invoiceNumber,
          fileName: invoice.invoiceNumber,
          download,
          wsName: this.ws.name,
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
   * @return {Promise<{date: string, invoiceNumber: string, href: string}[]>}
   */
  async getInvoiceList() {
    try {
      const invoiceUrl = this.invoiceUrl.replace('STORE_ID', this.ws.accountId);
      await this.page.goto(invoiceUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForURL();
      await this.page.waitForLoadState('networkidle');
      const passwordFields = await this.page.$$('[type="password"]');
      if (passwordFields.length > 0) {
        // Redirect to login page
        this.onError(new Error('Wrong store id'));
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
      await this.page.waitForSelector('tbody');
      const tables = await this.page.$$('tbody');
      const invoiceHandles = await tables[1].$$('tr');
      const invoiceList = await Promise.all(invoiceHandles.map(async (invoiceHandle) => {
        const invoiceNumber = await invoiceHandle.$eval('td:nth-child(1)', (e) => e.textContent.trim());
        const date = await invoiceHandle.$eval('td:nth-child(2)', (e) => e.textContent.trim());
        const href = await invoiceHandle.$eval('td:nth-child(4) a', (e) => e.getAttribute('href'));
        return {
          date: this.parseDate(date),
          invoiceNumber,
          href: `https://app.channable.com${href}`,
        };
      }));
      this.onSuccess('Collect invoice list complete', invoiceList);
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl, { timeout: 50000, waitUntil: 'domcontentloaded' });
      await this.page.locator('[type="text"]').fill(this.ws.username);
      await this.page.locator('[type="password"]').fill(this.ws.password);

      let retries = 2;
      while (retries) {
        try {
          retries -= 1;
          await this.page.locator('[type="submit"]').click();
          await this.page.waitForTimeout(5000);
          await this.page.waitForURL();

          const incorrect = await this.page
            .getByText('Email and/or password invalid')
            .isVisible();
          const invalidEmailType = await this.page
            .getByText('Email:')
            .isVisible();
          const hasRecaptcha = await this.page.evaluate(() => {
            const recaptchaElements = document.querySelectorAll('iframe[title="reCAPTCHA"]');
            return recaptchaElements.length > 0;
          });

          if (incorrect) {
            this.onError(new Error('Wrong email or password'));
            throw new Error('authenticationFailed');
          } else if (invalidEmailType) {
            this.onError(new Error('Invalid Email Type'));
            throw new Error('authenticationFailed');
          }

          if (hasRecaptcha) {
            const captchaSolved = await this.page.solveRecaptchas();
            if (
              !!captchaSolved
              && !!captchaSolved.solved[0]
              && captchaSolved.solved[0].isSolved === false
            ) {
              throw new Error('CAPTCHA not solved');
            }
            this.onSuccess('CAPTCHA solved');
          } else {
            break;
          }
        } catch (err) {
          await this.onPageError(err, this.page);
          throw new Error('authenticationFailed');
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
   * @param {String} link
   * @return {Object}
   */
  async getDownload(link) {
    let arrayBuffer;
    try {
      const response = await fetch(link, {
        method: 'GET',
      });
      if (response.ok) {
        arrayBuffer = await response.arrayBuffer();
      }
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      this.onError(
        new Error(`${link} Request failed.`),
      );
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }
}

module.exports = ChannableProvider;
