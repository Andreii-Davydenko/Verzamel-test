const fs = require('fs/promises');
const Provider = require('./provider');

class UpworkFreelancerProvider extends Provider {
  /**
  * @private
  * @type {string}
  */
  name = 'Upwork - Freelancer';

  /**
    * @private
    * @type {string}
    */
  authUrl = 'https://www.upwork.com/ab/account-security/login';

  /**
    * @private
    * @type {string}
    */
  invoiceUrl = 'https://www.upwork.com/nx/payments/reports/transaction-history';

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
    * @private
    * @type {boolean}
    */
  requiresSecurityQuestion = false;

  /**
    * @private
    * @type {string}
    */
  securityQuestion = '';

  /**
    * @private
    * @type {string | null}
    */
  sessionToken = null;

  /**
    * @private
    * @type {number}
    */
  fetchCount = 0;

  /**
    * @public
    * @param {String} code
    * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
    */
  async fetch(code) {
    if (!this.authDone) {
      if (this.requiresSecurityQuestion) {
        await this.handleSecurityQuestion(code);
      } else {
        await this.handle2FA(code);
      }
    }
    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList.filter((value) => {
        if (value.type !== 'VAT' && value.type !== 'Withdrawal Fee' && value.type !== 'Withdrawal') {
          return true;
        }
        return false;
      }));

      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice);
        this.updateFetchStatus(invoiceListFiltered.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.id,
        };
      }));
    } catch (err) {
      this.onError(new Error(err.message));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
     * @private
     * @param {String} date
     * @return {Date}
     */
  parseDate(date) {
    const d = new Date(date.toLocaleString('en-US', { timeZone: 'GMT' }));
    return d;
  }

  /**
     * @private
     * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
     */
  // eslint-disable-next-line consistent-return
  async getInvoiceList() {
    try {
      // Set a custom User-Agent header
      await this.page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        // eslint-disable-next-line quote-props
        'Referer': 'https://www.upwork.com',
      });
      if (this.filters === null) {
        const currentDate = new Date();
        // eslint-disable-next-line max-len
        const sixMonthsAgo = new Date(currentDate.getFullYear(), currentDate.getMonth() - 6, currentDate.getDate());
        await this.page.goto(`${this.invoiceUrl}?startDate=${sixMonthsAgo}&endDate=${currentDate}&trxTypes=ALL&clients=ALL`);
      } else {
        await this.page.goto(`${this.invoiceUrl}?startDate=${this.filters.from}&endDate=${this.filters.to}&trxTypes=ALL&clients=ALL`);
      }
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await this.page.waitForResponse('https://www.upwork.com/api/graphql/v1');
        const session = await data.json();
        if (session.data.transactionHistory) {
          // eslint-disable-next-line max-len
          if (session.data.transactionHistory.transactionDetail.transactionHistoryRow.length !== 0) {
          // eslint-disable-next-line max-len
            return session.data.transactionHistory.transactionDetail.transactionHistoryRow.map((e) => ({
              id: e.recordId,
              href: `https://www.upwork.com/ab/payments/statements/T${e.recordId}.pdf`,
              description: e.descriptionUI,
              date: this.parseDate(e.transactionCreationDate),
              type: e.accountingSubtype,
              wsName: this.ws.name,
            }));
          }
          this.onError(new Error('No Invoice Found'));
          return [];
        }
      }
    } catch (err) {
      const url = this.page.url();
      if (url.indexOf(this.authUrl) === -1) {
        await this.reAuthenticate();
        await this.getInvoiceList();
      } else {
        this.onPageError(new Error(err.message), this.page);
        throw new Error('failedToFetchInvoicesFromWebsite');
      }
    }
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.locator('#deviceAuthOtp_otp').fill(code);
      await this.page.locator('#next_continue').click();
      try {
        await this.page.waitForURL('https://www.upwork.com/nx/find-work/');
        this.authDone = true;
      } catch (e) {
        this.onError(new Error('Wrong Code'));
        throw new Error('authenticationFailed');
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
     * @private
     * @param {String} code
     * @return {Promise<void>}
     */
  async handleSecurityQuestion(code) {
    try {
      await this.page.locator('#login_answer').fill(code);
      await this.page.locator('#login_control_continue').click();
      try {
        await this.page.waitForURL('https://www.upwork.com/nx/find-work/');
        this.authDone = true;
        this.requiresSecurityQuestion = false;
        this.onSuccess('Security Question Complete');
      } catch (e) {
        this.onError(new Error('Security Question Failed'));
        throw new Error('authenticationFailed');
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
     * @private
     * @param {{ link: String }} invoice
     * @return {Promise<import('playwright-core').Download>}
     */
  async getDownload(invoice) {
    await this.page.waitForTimeout(5000);
    const ctx = this.page.context();
    const page = await ctx.newPage();

    // Set a custom User-Agent header
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
      // eslint-disable-next-line quote-props
      'Referer': 'https://www.upwork.com',
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    try {
      await page.goto(invoice.href);
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', invoice.href);
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', invoice.href);
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async checkLogin(page, num) {
    const data = await page.waitForResponse('https://www.upwork.com/ab/account-security/login', { timeout: 50000 });
    const session = await data.json();
    if (session.eventCode === 'wrongPassword' && num === 1) {
      this.onError(new Error('Auth failed. Wrong Username/Email'));
      throw new Error('authenticationFailed');
    } else if (session.eventCode === 'wrongPassword' && num === 2) {
      this.onError(new Error('Auth failed. Wrong Password'));
      throw new Error('authenticationFailed');
    }
  }

  /**
     * @private
     * @return {Promise<void>}
     */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl, { timeout: 50000, waitUntil: 'domcontentloaded' });
      await this.page.locator('#login_username').fill(this.ws.username);
      await this.page.locator('#login_password_continue').click();

      await this.checkLogin(this.page, 1);

      await this.page.locator('#login_password').fill(this.ws.password);
      await this.page.locator('#login_control_continue').click();

      await this.checkLogin(this.page, 2);
      await this.page.waitForTimeout(5000);

      await this.page.waitForURL();
      await this.page.waitForLoadState('domcontentloaded');
      const url = this.page.url();
      if (url.indexOf('https://www.upwork.com/nx/find-work/') !== -1) {
        this.authDone = true;
      }

      if (!this.authDone) {
        try {
          await this.page.waitForSelector('#login_answer', { state: 'visible' });
          this.securityQuestion = await this.page.$eval('label[for="login_answer"]', (e) => e.textContent.trim());
          this.requiresSecurityQuestion = true;
        } catch (err) {
          const checkButton = await this.page.$eval('button[target-form=deviceAuthSendOtp]', (e) => !!e);
          if (checkButton) {
            const clickButon = this.page.getByRole('button', { name: 'Send' });
            await clickButon.click();
          }
          this.requiresSecurityQuestion = false;
        }
      }

      this.onSuccess('Authentication complete');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err.message, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = UpworkFreelancerProvider;
