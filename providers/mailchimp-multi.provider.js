const fs = require('fs/promises');
const Provider = require('./provider');

class MailchimpMultiProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Mailchimp - Multi Account';

  /**
   * @private
   * @type {string}
   */
  server = '';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://us7.admin.mailchimp.com';

  /**
   * @private
   * @type {string}
   */
  invoicePath = '/i/account/billing-history/';

  /**
   * @private
   * @type {string}
   */
  downloadPath = '/i';

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
  count = 0;

  /**
   * @public
   * @param {String} code
   * @return {Promise<{ download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    try {
      await this.handle2FA(code);
      let inv = [];
      const invoiceList = await this.getInvoiceList();
      const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
      const invoiceListFiltered = this.applyFilters(invoiceListNormalized);

      let currentDownloads = 1;
      const maxDownloads = 10;
      inv = Promise.all(invoiceListFiltered.map(async (invoice, i) => {
        while (currentDownloads > maxDownloads) {
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
        }
        currentDownloads += 1;
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);

        currentDownloads -= 1;
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoiceListFiltered[i].description.toString(),
          wsName: this.ws.name,
        };
      }));
      await this.page.close();
      return inv;
    } catch (err) {
      if (!this.authDone) throw err;
      await this.onPageError(err, this.page);
      await this.page.close();
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<Promise<*>[]>}
   */
  async getInvoiceList() {
    let links;
    let invoiceNos;
    let dates;
    try {
      const contentBtn = await this.page.locator('.dijitButtonContents');
      if (contentBtn.isVisible()) {
        await contentBtn.click();
        await this.page.locator('#dijit_MenuItem_3_text').click();
      }
      if (
        await this.page
          .locator('h4[class="!padding--lv0"] > a')
          .first()
          .isVisible()
      ) {
        links = await this.page.locator('h4[class="!padding--lv0"] > a').all();
        invoiceNos = await this.page
          .locator('h4[class="!padding--lv0"] > a')
          .allInnerTexts();
        dates = await this.page
          .locator('p[class="!padding--lv0 small-meta"]')
          .allInnerTexts();
        return Promise.all(
          links.map(async (link, index) => {
            const x = await link.getAttribute('href');
            return {
              ...link,
              link: x,
              date: dates[index],
              invoiceNo: invoiceNos[index],
            };
          }),
        );
      }
      this.onSuccess('noInvoicesFound');
      return [];
    } catch (err) {
      this.onPageError(err, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {Array} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    const downloadBaseUrl = this.getUrl(this.downloadPath);
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceNo,
      date: new Date(invoice.date),
      link: downloadBaseUrl + invoice.link,
    }));
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
      await page.waitForSelector('#dijit_form_ComboButton_0_label');
      await page.evaluate(() => {
        document.getElementById('fallback-back-container').remove();
      });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: 'A4',
        displayHeaderFooter: false,
        scale: 0.97,
        margin: {
          top: '0px',
          bottom: '0px',
          left: '0px',
          right: '0px',
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
   * @param {string} path
   * @return {string}
   */
  getUrl(path) {
    return `${this.baseUrl.replace('us7', this.server)}${path}`;
  }

  /**
     * @private
     * @param {string} url
     * @return {string | null}
     */
  extractServerName(url) {
    const regex = /https:\/\/([^.]+)\.admin/;
    const match = url.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  /**
   * @private
   * @param {string} code
   * @return {Promise<void>}
   */
  async handle2FA(code) {
    try {
      const pageUrl = this.page.url();
      this.server = this.extractServerName(pageUrl);
      const invoiceUrl = this.getUrl(this.invoicePath);

      await this.page.locator('#email_code').fill(code);
      await this.page.locator('.submit-verification-button').click();

      await this.page.waitForLoadState('load');
      if (this.page.url() === pageUrl) {
        this.onError('2FA failed');
        this.authDone = false;
        throw new Error('authenticationFailed');
      }
      await this.page.goto(invoiceUrl);

      this.onSuccess('Authentication complete');
      this.authDone = true;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @public
   */
  async authenticate() {
    try {
      await this.page.goto(this.baseUrl);
      await this.page.locator('#username').fill(this.ws.username);
      await this.page.locator('#password').fill(this.ws.password);
      await this.page.locator('#submit-btn').click();
      const incorrect = await this.page.locator('.error').isVisible();
      if (incorrect) {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      }
      await this.page.waitForURL(/(.)post(.)/, { timeout: 50000 })
        .then(async () => {
          await this.page
            .locator(`[data-account-name=${this.ws.accountId}]`)
            .click();
          this.onSuccess('Account selected');
        });
      // see if 2fa is required
      await this.page.waitForURL(/(.)verify(.)/, { timeout: 50000 }).then(async () => {
        if (await this.page.locator('.send-email-code-button', { timeout: 3000 }).isVisible()) {
          await this.page.locator('.send-email-code-button').click();
        }
        this.onSuccess('2FA Code Sent');
      }).catch(() => {
        this.onError(new Error('authenticationFailed'));
        throw new Error('authenticationFailed');
      });
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = MailchimpMultiProvider;
