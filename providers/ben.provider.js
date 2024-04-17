const fs = require('fs/promises');
const Provider = require('./provider');

class BenProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Ben';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.ben.nl/inloggen';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://fast.ben.nl/api/app/get-invoice/';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://fast.ben.nl/api/app/get-invoices/';

  /**
   * @private
   * @type {string}
   */
  sessionUrl = 'https://www.ben.nl/api/user/session';

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
   * @param {String} code
   * @return {Promise<Awaited<{date: *, download: *, fileName: *, description: *}>[]>}
   */
  async fetch() {
    await this.authenticate();
    const { token, subscriptionId } = await this.getAuthAccess();
    const invoiceList = await this.getInvoiceList(token, subscriptionId);
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice, i) => {
          const download = await this.getInvoiceDownload(
            invoice.description,
            token,
          );
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            fileName: invoiceListFiltered[i].description.toString(),
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (this.authError) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async resolveCaptcha() {
    try {
      const captchaResult = await this.page.solveRecaptchas();
      if (captchaResult.solved[0].isSolved === false) {
        throw new Error();
      }
      this.onSuccess('CAPTCHA solved');
      return true;
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('CAPTCHA not solved');
    }
  }

  /**
   * @public
   * @return {Promise<boolean>}
   */
  async authenticate() {
    const selectors = {
      cookieWall: 'div[class="cookie-wall"]',
      acceptCookies: 'button[type="button"]',
      username: 'input[name="name"]',
      password: 'input[name="pass"]',
      recaptcha: "iframe[title='reCAPTCHA']",
      submitButton: 'button[type="submit"]',
    };

    try {
      await this.page.goto(this.authUrl);
      const {
        username,
        password,
        recaptcha,
        submitButton,
        cookieWall,
        acceptCookies,
      } = selectors;
      const cookieWallFrame = await this.page.waitForSelector(cookieWall);
      const captchaFrame = await this.page.waitForSelector(recaptcha);
      if (cookieWallFrame.isVisible()) {
        await this.page.click(acceptCookies);
      }
      await this.page.type(username, this.ws.username);
      await this.page.type(password, this.ws.password);
      if (captchaFrame.isVisible()) {
        await this.resolveCaptcha();
      }
      await this.page.click(submitButton);
      const incorrect = await this.page
        .getByText('Onbekende gebruikersnaam of wachtwoord.')
        .isVisible();
      if (incorrect) {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }
      const currentUrl = await this.page.url();
      if (currentUrl === this.authUrl) {
        this.authError = true;
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      } else {
        this.onSuccess('Authentication complete');
      }
    } catch (error) {
      await this.onPageError(error, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getAuthCookies() {
    try {
      const sessionId = (await this.page.context().cookies()).filter(
        (cookie) => cookie.name === 'SSESS718ef3952b4688af2105cd4676803b2c',
      )[0].value;
      const drupalSso = (await this.page.context().cookies()).filter(
        (cookie) => cookie.name === 'Drupal_SSO',
      )[0].value;
      const cookies = `SSESS718ef3952b4688af2105cd4676803b2c=${sessionId}`
        + `;Drupal_SSO=${drupalSso}`;
      return cookies;
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {token: String, subscriptionId: String} }
   */
  async getAuthAccess() {
    const cookies = await this.getAuthCookies();
    let token = '';
    let subscriptionId = '';
    try {
      const response = await fetch(`${this.sessionUrl}`, {
        method: 'GET',
        headers: {
          Cookie: cookies,
        },
      });
      if (response.ok) {
        const data = await response.json();
        token = data?.access_token;
        subscriptionId = data?.active_subscription_id;
        this.onSuccess('Collect auth info complete', {
          token,
          subscriptionId,
        });
      }
      return { token, subscriptionId };
    } catch (error) {
      this.onError(new Error(`${this.sessionUrl} Request failed.`));
      await this.page.close();
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList(token, subscriptionId) {
    let invoices = [];
    try {
      const response = await fetch(`${this.invoiceListUrl}${subscriptionId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        invoices = data?.invoices || [];
        this.onSuccess('Collect invoice list complete', invoices);
      }
      return invoices;
    } catch (error) {
      this.onError(new Error(`${this.invoiceListUrl} Request failed.`));
      await this.page.close();
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.id,
      date: new Date(`${invoice.month}-01-${invoice.year}`),
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, token) {
    let arrayBuffer;
    try {
      const response = await fetch(`${this.invoiceUrl}${invoiceId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
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

module.exports = BenProvider;
