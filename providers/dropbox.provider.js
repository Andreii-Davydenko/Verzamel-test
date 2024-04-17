const { parse } = require('date-fns');
const fs = require('fs/promises');
const Provider = require('./provider');

class DropboxProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Dropbox';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.dropbox.com/login';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.dropbox.com/manage/billing';

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
      await this.handle2FA(code);
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListFiltered = this.applyFilters(invoiceList);
    try {
      return this.runSequentially(invoiceListFiltered.map((invoice) => async () => {
        const download = await this.getDownload(invoice.href);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: this.getFileName(invoice.href),
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} href
   * @return {String}
   */
  getFileName(href) {
    const regex = /bill_id=(.*)&/;
    const matches = href.match(regex);
    return `${matches && matches[1]}.pdf`;
  }

  /**
   * @private
   * @param {String} href
   * @return {Object}
   */
  async getDownload(href) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    try {
      await page.goto(`https://www.dropbox.com${href}`);
      await page.evaluate(() => {
        const banner = document.getElementById('ccpa_consent_banner');
        const btn = document.querySelector('.financial-button');
        if (banner) {
          banner.style.display = 'none';
        }
        if (btn) {
          btn.style.display = 'none';
        }
      });
      const buffer = await page.pdf();
      await page.close();
      this.onSuccess('PDF prefetch complete', { href });
      return {
        buffer,
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    } catch (err) {
      await this.onPageError(err, page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return parse(date, 'dd-MM-yyyy', new Date());
  }

  /**
   * @private
   * @return {Promise<Awaited<{date: *, description: *, href: *, wsName: *}>[]>}
   */
  async getInvoiceList() {
    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForSelector('div[role="table"]');
      const invoiceHandles = await this.page.$$('div.dig-Table-row:not(.dig-Table-row--header)');
      const invoiceList = this.runSequentially(invoiceHandles.map((invoiceHandle) => async () => {
        const description = await this.getDescription(invoiceHandle);
        const date = await this.getDate(invoiceHandle);
        const href = await this.getHref(invoiceHandle);
        return {
          description, href, date: this.parseDate(date), wsName: this.ws.name,
        };
      }));
      this.onSuccess('Collect invoice list complete', { invoiceList });
      return invoiceList;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDate(invoiceHandle) {
    const dateHandle = await invoiceHandle.$('div[role="cell"]:nth-of-type(1)');
    return dateHandle && dateHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getDescription(invoiceHandle) {
    const descriptionHandle = await invoiceHandle.$('div[role="cell"]:nth-of-type(2)');
    return descriptionHandle && descriptionHandle.innerText();
  }

  /**
   * @private
   * @param {import('playwright-core').ElementHandle} invoiceHandle
   * @return {Promise<string>}
   */
  async getHref(invoiceHandle) {
    const btnHandle = await invoiceHandle.$('button');
    if (!btnHandle) return null;
    await btnHandle.click();
    await this.page.waitForSelector('a[data-trackingid="click_billing_invoice"]');
    const linkHandle = await this.page.$('a[data-trackingid="click_billing_invoice"]');
    if (!linkHandle) return null;
    const href = await linkHandle.getAttribute('href');
    await this.page.evaluate(() => {
      document.querySelector('h1').click();
    });
    await linkHandle.waitForElementState('hidden');
    return href;
  }

  /**
   * @private
   * @param {String} value
   * @param {import('playwright-core').Locator} input
   * @param {import('playwright-core').Locator} submitBtn
   * @return {Promise<void>}
   */
  async fillInCred(value, input, submitBtn) {
    await input.fill(value);
    await submitBtn.click();
    const invalid = await this.page.locator('.login-form .error-message').isVisible();
    if (invalid) throw new Error('Auth failed');
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      const codeInput = await this.page.locator('.two-factor-form input[name="code"]');
      const submitBtn = await this.page.locator('.two-factor-form button[type="submit"]');
      await this.fillInCred(code, codeInput, submitBtn);
      await this.page.waitForURL('https://www.dropbox.com/home');
      this.onSuccess('2FA Complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async getLoginResponse() {
    await this.page.waitForResponse(async (response) => {
      if (response.url() !== 'https://www.dropbox.com/ajax_login') return false;
      let responseText = await response.text();
      if (responseText.startsWith('err:')) {
        responseText = responseText.replace('err:', '');
      }
      const responseObj = JSON.parse(responseText);
      if (responseObj.funcaptcha_response) return false;
      if (responseObj.login_email?.message_text === 'Invalid email or password') {
        throw new Error('Auth failed');
      }
      if (responseObj.status === 'OK') {
        this.authDone = true;
      }
      return true;
    });
  }

  /**
   * @public
   * @return {Promise<Function>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.authUrl);

      await this.page.locator('input[type="email"]').fill(this.ws.username);
      this.page.locator('button.email-submit-button').click();

      await new Promise((resolve) => { setTimeout(resolve, 3000); });

      await this.page.locator('input[name="login_password"]').type(this.ws.password);
      this.page.locator('button[data-uxa-log="login_form_submit_button"]').click();

      await this.getLoginResponse();
      if (this.authDone) return this.fetch.bind(this);
      const codeInput = await this.page.locator('.two-factor-form input[name="code"]');
      await codeInput.waitFor({ state: 'visible' });
      this.onSuccess('Authentication complete');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = DropboxProvider;
