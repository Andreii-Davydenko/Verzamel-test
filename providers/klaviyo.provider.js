/* eslint-disable no-constant-condition */
const fs = require('fs/promises');
const Provider = require('./provider');

class KlaviyoProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Klaviyo';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.klaviyo.com/login';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://www.klaviyo.com/settings/billing/payment-history';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.klaviyo.com/settings/billing/payment-history';

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
    await this.handle2FA(code);
    try {
      const token = await this.getToken();
      const invoiceList = await this.getInvoiceList(token);
      const NomalizedList = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(NomalizedList);
      return await Promise.all(invoiceListFiltered.map(async (invoice) => {
        const { fileName, download } = await this.getDownload(invoice.link, token);
        this.updateFetchStatus(invoiceList.length);
        await this.page.close();
        return {
          ...invoice,
          description: fileName.slice(8),
          date: this.formatDate(invoice.date),
          download,
          fileName: fileName.slice(8),
        };
      }));
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getToken() {
    const klCSRF = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === 'kl_csrftoken')[0].value;
    const klSESS = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === 'kl_sessionid')[0].value;
    const klaID = (await this.page.context()
      .cookies()).filter((cookie) => cookie.name === '__kla_id')[0].value;
    return (
      `kl_csrftoken=${klCSRF}`
      + `;kl_sessionid=${klSESS}`
      + `;__kla_id=${klaID}`
    );
  }

  /**
   * @private
   * @param {string} token
   * @return {Promise<{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]>}
   */
  async getInvoiceList(token) {
    const response = await fetch('https://www.klaviyo.com/ajax/billing/invoice-history?page_size=100&time_range=all_time', {
      method: 'GET',
      headers: { Cookie: token },
    });
    if (response.ok) {
      const data = await response.json();
      const invoices = data?.items || [];
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    }
    this.onError(new Error(`https://www.klaviyo.com/ajax/billing/invoice-history?page_size=100&time_range=all_time Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{invoiceId:string,generationDate:string,documentUrl:string,title:string}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.id.slice(8),
      date: new Date(invoice.invoice_date),
      link: `${invoice.invoice_pdf_url}`,
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} link
   * @param {String} token
   * @return {Object}
   */
  async getDownload(link, token) {
    const response = await fetch(link, {
      method: 'GET',
      headers: { Cookie: token },
    });
    if (response.ok) {
      const fileName = response.headers.get('content-disposition').split('filename=')[1].split(';')[0].replace(/"/g, '').slice(0, -4);
      const arrayBuffer = await response.arrayBuffer();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        fileName,
        download: {
          buffer: Buffer.from(arrayBuffer),
          async saveAs(path) {
            await fs.writeFile(path, this.buffer);
          },
        },
      };
    }
    this.onError(new Error(`${link} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {String} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      await this.page.getByTestId('verification-code').fill(code);
      await this.page.getByRole('button', { name: 'Log In' }).click();
      await this.page.waitForTimeout(3000);
      const invalid = await this.page.getByTestId('verification-code-TextInput-Field-error').isVisible();
      if (invalid) {
        await this.page.close();
        this.onError(new Error('authenticationFailed'));
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.page.waitForURL(
        'https://www.klaviyo.com/dashboard',
      );
      await this.page.goto(this.baseUrl);
      this.authDone = true;
      return true;
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
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.getByTestId('email').fill(this.ws.username);
      await this.page.getByTestId('password-PasswordInput').fill(this.ws.password);
      const captchaFrame = (await this.page.waitForSelector("iframe[title='reCAPTCHA']")).isVisible();
      if (captchaFrame) {
        const captchaSolved = await this.page.solveRecaptchas();
        if (captchaSolved.solved[0].isSolved === false) throw new Error('CAPTCHA not solved');
        this.onSuccess('CAPTCHA solved');
      }
      await this.page.getByTestId('login').click();
      await this.page.waitForTimeout(3000);
      let invalid = false;
      try {
        invalid = await this.page.getByText('Your username and password don\'t match. Please try again.')
          .isVisible();
      } catch (e) {
        invalid = false;
      }
      if (invalid) {
        throw new Error('authenticationFailed');
      }
      if (!await this.page.getByPlaceholder('6-digit code').isVisible()) {
        return this.fetch.bind(this);
      }
      return this.fetch.bind(this);
    } catch (err) {
      // console.log(err);
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = KlaviyoProvider;