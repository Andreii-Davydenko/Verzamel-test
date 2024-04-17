const { parse } = require('date-fns');
const Provider = require('./provider');

class BolParticulierProvider extends Provider {
  /**
  * @private
  * @type {string}
  */
  name = 'Bol.com - Particulier';

  /**
    * @private
    * @type {string}
  */
  authUrl = 'https://login.bol.com/wsp/login';

  /**
    * @private
    * @type {string}
  */
  invoiceUrl = ' https://www.bol.com/nl/rnwy/account/facturen/betaald';

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
    if (!this.authDone) {
      await this.authenticate();
    }
    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);

      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.link);
        this.updateFetchStatus(invoiceListFiltered.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
        };
      }));
    } catch (err) {
      this.onError(new Error(err));
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
     * @return {Promise<Awaited<{date: *, download: *, website: *, description: *}>[]>}
     */
  // eslint-disable-next-line consistent-return
  async getInvoiceList() {
    await this.page.goto(this.invoiceUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('button#js-first-screen-accept-all-button', { visible: true });
    await this.page.waitForLoadState('networkidle');
    await this.page.$('button#js-first-screen-accept-all-button').then(async (button) => {
      if (button) {
        await button.click({ force: true });
      }
    });
    await this.page.waitForURL();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(7000);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const showMoreButton = await this.page.$('button[tabindex="0"]', { visible: true });
      if (!showMoreButton) {
        break;
      }
      await showMoreButton.click();
      await this.page.waitForTimeout(1000);
    }
    await this.page.waitForSelector('[data-testid="paid-invoices-content"]');
    const invoiceElements = await this.page.$$('[data-testid="paid-invoice-bundle"]');

    const invoices = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const element of invoiceElements) {
      const aTags = await element.$$('a');
      // eslint-disable-next-line no-restricted-syntax
      for (const aTag of aTags) {
        const url = await aTag.getAttribute('href');
        const description = url.match(/\/(\d+)$/)[1];
        const date = await this.getDate(description);
        invoices.push({
          description,
          date: this.parseDate(date),
          link: `https://www.bol.com/nl/rnwy/invoice/pdf?i=${description}`,
          wsName: this.ws.name,
        });
      }
    }
    return invoices;
  }

  async getDate(id) {
    try {
      const ctx = this.page.context();
      const page = await ctx.newPage();
      await page.goto(`https://www.bol.com/nl/rnwy/account/facturen/details/${id}`);
      await page.waitForSelector('div.c-timeline__date');

      const dateElement = await page.$('.c-timeline__item:has-text("Dank je wel")');
      const date = await dateElement.evaluate((element) => element.querySelector('span[data-testid="timeline-date"]').textContent.trim());

      await page.close();
      return date;
    } catch (err) {
      this.onError(new Error(err));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {String} link
   * @return {Promise<import('playwright-core').Download>}
   */
  async getDownload(link) {
    try {
      const ctx = this.page.context();
      const page = await ctx.newPage();
      await page.goto('https://techpreneur.nl/verzamelsysteem/fetching.html');
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate((href) => {
        const linkEl = document.createElement('a');
        linkEl.setAttribute('href', href);
        linkEl.setAttribute('id', 'my-invoice');
        linkEl.setAttribute('style', 'display:inline-block;width:1px;height:1px;');
        document.body.append(linkEl);
      }, link);
      await page.locator('#my-invoice').click({ modifiers: ['Alt'] });
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return download;
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
      await this.page.locator('input[name="j_username"]').fill(this.ws.username);
      await this.page.locator('input[name="j_password"]').fill(this.ws.password);
      await this.page.locator('button[type="SUBMIT"]').click();
      await this.page.waitForURL();
      await this.page.waitForLoadState('networkidle');
      if (this.page.url() === 'https://login.bol.com/wsp/login') {
        this.onError(new Error('Auth failed. Wrong Username/Email'));
        throw new Error('authenticationFailed');
      }
      this.authDone = true;

      this.onSuccess('Authentication complete');
    } catch (err) {
      await this.onPageError(err.message, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = BolParticulierProvider;
