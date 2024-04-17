/* eslint-disable no-constant-condition */
const { parse } = require('date-fns');
const Provider = require('./provider');

class AmazonNlProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Amazon NL';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.amazon.nl/gp/css/order-history';

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
    if (this.authDone === false) await this.handle2FA(code);
    try {
      const invoiceList = await this.getInvoiceList();
      const invoiceListFiltered = this.applyFilters(invoiceList);
      return await Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = invoice.href;
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
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
   * @return {{ date: Date, description: String, invoice_uuid: String }[]}
   */
  async getInvoiceList() {
    try {
      const invoiceList = [];
      let amazonYear = 2011;
      const currentYear = new Date().getFullYear();

      while (true) {
        await this.page.goto(`${this.invoiceUrl}?orderFilter=year-${amazonYear}`, { waitUntil: 'domcontentloaded' });
        await this.page.waitForSelector('div#ordersContainer');
        while (true) {
          // Get all order elements
          const orders = await this.page.$$('div.a-box-group');
          // eslint-disable-next-line no-restricted-syntax
          for (const invoiceHandle of orders) {
            const description = await invoiceHandle.$eval('div.yohtmlc-order-id span.value', (e) => e.textContent.trim());
            const date = await invoiceHandle.$eval('div.a-span3 span.value', (e) => e.textContent.trim());
            const invoiceLink = await invoiceHandle.$eval('div.yohtmlc-order-level-connections ul span.hide-if-no-js span', (e) => e.getAttribute('data-a-popover'));
            const requestLink = JSON.parse(invoiceLink);
            const pdfLink = `https://www.amazon.nl${requestLink.url}`;
            const ctx = this.page.context();
            const page = await ctx.newPage();
            await page.goto(pdfLink, { waitUntil: 'domcontentloaded' });
            const invoices = await page.$$('.invoice-list li a[href*="invoice.pdf"]');
            // eslint-disable-next-line no-restricted-syntax
            for (const [index, invoice] of invoices.entries()) {
              const downloadPromise = page.waitForEvent('download');
              await invoice.click({ modifiers: ['Alt'] });
              const download = await downloadPromise;
              await download.path();
              const href = await invoice.getAttribute('href');
              this.onSuccess('PDF prefetch complete', `https://www.amazon.nl/${href}`);
              if (invoices.legnth > 1) page.goBack();
              invoiceList.push({
                description: `${description} #Invoice${index + 1}`, href: download, date: this.parseDate(date), wsName: this.ws.name,
              });
            }
            page.close();
          }
          const nextPageButton = await this.page.$('ul.a-pagination li.a-last a');
          if (!nextPageButton) {
            break;
          }
          await nextPageButton.click();
          await this.page.waitForURL('https://www.amazon.nl/**', { waitUntil: 'domcontentloaded' });
        }
        amazonYear += 1;
        if (currentYear >= amazonYear) {
          const noContent = this.page.getByText('You have not placed any orders in');
          if (!noContent) {
            break;
          }
        } else {
          break;
        }
      }
      this.onSuccess('Collect invoice list complete');
      return invoiceList;
    } catch (error) {
      this.onError(new Error(`'Error occurred:', ${error.message}`));
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
      await this.page.locator('input[id=input-box-otp]').fill(code);
      await this.page.getByRole('button', { name: 'Code indienen' }).click();
      const invalid = await this.page.getByText('De ingevoerde code is ongeldig. Controleer de code en probeer het opnieuw').isVisible();
      if (invalid) this.onError(new Error('Invalid Verification Code'));
      await this.page.waitForURL();
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
  async handleRecaptcha() {
    try {
      const locator = await this.page.waitForSelector('input#captchacharacters', { timeout: 10000 });
      if (await locator.isVisible() && await locator.isEditable()) {
        const imageElement = await this.page.$('img[src^="https://images-na.ssl-images-amazon.com/captcha/"]');
        const imageURL = await imageElement.getAttribute('src');

        const response = await fetch(imageURL);
        const arrayBuffer = await response.arrayBuffer();
        const captchaImage = Buffer.from(arrayBuffer).toString('base64');
        const captcha = await this.handle2Captcha(captchaImage);

        await this.page.locator('input#captchacharacters').fill(captcha);
        const clickButon = this.page.getByRole('button', { name: 'Doorgaan met winkelen' });
        await clickButon.click();
      }
    } catch (err) {
      // do nothing
    }
  }

  /**
   * @public
   * @return {Promise<Function>}
   */
  async authenticate() {
    try {
      await this.page.goto(this.invoiceUrl);
      await this.page.waitForURL();
      await this.handleRecaptcha();

      await this.page.waitForURL();
      await this.page.locator('#ap_email').fill(this.ws.username);
      await this.page.locator('input[id=continue]').click();
      const invalidEmail = await this.page.getByText('We kunnen geen account vinden met dat e-mailadres').isVisible();
      if (invalidEmail) this.onError(new Error('Invalid Email Address'));

      await this.page.waitForURL();
      await this.page.locator('input[name=password]').fill(this.ws.password);
      await this.page.locator('input[id=signInSubmit]').click();
      const invalidPassword = await this.page.getByText('Je wachtwoord is onjuist').isVisible();
      if (invalidPassword) this.onError(new Error('Invalid Password'));

      await this.page.waitForTimeout(6000);

      await this.page.waitForURL();
      const url = this.page.url();
      if (url.indexOf(this.invoiceUrl) !== -1) {
        this.authDone = true;
        this.onSuccess('Authentication complete');
        return this.fetch.bind(this);
      }
      await this.page.waitForSelector('input[id=input-box-otp]');
      this.onSuccess('Authentication complete');
      return this.fetch.bind(this);
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }
}

module.exports = AmazonNlProvider;
