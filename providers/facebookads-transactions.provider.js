const fs = require('fs/promises');
const {
  parse,
  parseISO,
  subYears,
  addDays,
} = require('date-fns');
const Provider = require('./provider');

class FacebookAdsTransactionsProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Facebook ads - Transactions';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {boolean}
   */
  requires2FA = false;

  convertDate(date) {
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
  // Month names in Dutch and English
    const monthNames = {
      jan: 'January',
      Feb: 'February',
      Mrt: 'March',
      Apr: 'April',
      Mei: 'May',
      Jun: 'June',
      Jul: 'July',
      Aug: 'August',
      Sep: 'September',
      Okt: 'October',
      Nov: 'November',
      dec: 'December',
    };
    const dateComponents = date.split(' ');
    // Convert the month to English
    const englishMonth = monthNames[dateComponents[1]];
    const englishDateStr = `${dateComponents[0]} ${englishMonth} ${dateComponents[2]}`;
    return parse(englishDateStr, 'dd MMMM yyyy', new Date());
  }

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListFiltered = this.applyFilters(invoiceList.filter((item) => !['MisluktMislukt', 'FailedFailed'].includes(item.status)));
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getDownload(invoice.link);
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.close();
      return invoiceData;
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    try {
      await this.page.goto('https://facebook.com', { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle');
      try {
        const cookiesButton = await this.page.$eval('button[data-testid=cookie-policy-manage-dialog-decline-button]', (e) => !!e);
        if (cookiesButton) {
          const clickButon = this.page.locator('button[data-testid=cookie-policy-manage-dialog-decline-button]');
          await clickButon.click();
        }
      } catch (error) {
        // continue
      }
      await this.page.locator('input#email').fill(this.ws.username);
      await this.page.locator('input#pass').fill(this.ws.password);
      await this.page.locator('button[name=login]').click();
      await this.page.waitForURL('**/checkpoint/**');
      if (!['https://www.facebook.com/checkpoint/?next', 'https://web.facebook.com/checkpoint/?next'].includes(this.page.url())) {
        await this.onPageError('authenticationFailed', this.page);
        throw new Error('authenticationFailed');
      }
      let secondsElapsed = 0;
      const IntervalID = setInterval(() => {
        this.updateTimeoutStatus(35 - secondsElapsed);
        secondsElapsed += 1;
        if (secondsElapsed === 35) {
          clearInterval(IntervalID);
        }
      }, 1000);
      await this.page.waitForTimeout(35000);
      await this.page.waitForURL();
      if (['https://facebook.com/', 'https://www.facebook.com/', 'https://web.facebook.com/', 'https://www.facebook.com/?_rdc=1&_rdr'].includes(this.page.url())) {
        this.onSuccess('Authentication complete');
        this.authDone = true;
      } else {
        await this.onPageError('authenticationFailed', this.page);
        throw new Error('authenticationFailed');
      }
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const currentDate = new Date();
    const lastYearDate = Math.floor(subYears(currentDate, 1).getTime() / 1000);
    const currentYearDate = Math.floor(addDays(currentDate, 1).getTime() / 1000);
    // eslint-disable-next-line max-len
    const fromYear = this.filters?.from ? this.convertDate(parseISO(this.filters.from)) : lastYearDate;
    // eslint-disable-next-line max-len
    const toYear = this.filters?.from ? this.convertDate(addDays(parseISO(this.filters.to), 1)) : currentYearDate;
    try {
      await this.page.goto(`https://business.facebook.com/billing_hub/payment_activity?asset_id=${this.ws.accountId}&business_id=${this.ws.businessId}&date=${fromYear}_${toYear}`, { waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector('table tbody');
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const nextPageButton = await this.page.$('div[role="button"] > span > div > div:has-text("Meer weergeven")') || await this.page.$('div[role="button"] > span > div > div:has-text("See more")');
        if (!nextPageButton) {
          break;
        }
        await nextPageButton.click();
        await this.page.waitForTimeout(3000);
      }
      await this.page.waitForTimeout(4000);
      const invoiceTable = await this.page.$$('table tbody tr');
      return await Promise.all(invoiceTable.map(async (invoice) => {
        const tdElements = await invoice.$$('td');
        const imgElement = await invoice.$('td[aria-colindex="7"] a');
        const onclickAttributeValue = await imgElement?.getAttribute('href');
        const tdData = await Promise.all(tdElements.map(async (td) => {
          const textContent = await td.textContent();
          return textContent.trim();
        }));
        return {
          link: `https://business.facebook.com${onclickAttributeValue}`,
          fileName: tdData[0],
          // eslint-disable-next-line eqeqeq
          date: parse(tdData[1], 'dd MMM yyyy', new Date()) == 'Invalid Date' ? this.parseDate(tdData[1]) : parse(tdData[1], 'dd MMM yyyy', new Date()),
          wsName: this.ws.name,
          description: tdData[0],
          status: tdData[4],
        };
      }));
    } catch (err) {
      this.onPageError(err.message, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {object}
   */
  async getDownload(link) {
    const ctx = this.page.context();
    const page = await ctx.newPage();
    const downloadPromise = page.waitForEvent('download');
    try {
      await page.goto(link);
      const download = await downloadPromise;
      await download.path();
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return download;
    } catch (err) {
      const download = await downloadPromise;

      const downloadPath = await download.path();
      const arrayBuffer = await fs.readFile(downloadPath);
      await fs.unlink(downloadPath);
      await page.close();
      this.onSuccess('PDF prefetch complete', { link });
      return {
        buffer: Buffer.from(arrayBuffer),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
  }
}
module.exports = FacebookAdsTransactionsProvider;
