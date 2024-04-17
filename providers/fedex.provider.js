const fs = require('fs/promises');
const {
  parse, subYears, parseISO, format,
} = require('date-fns');
const Provider = require('./provider');

class FedExProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'FedEx';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.fedex.com/secure-login/#/login-credentials';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.fedex.com/fedexbillingonline/pages/accountsummary/accountSummaryFBO.xhtml';

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
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch(code) {
    if (!this.authDone) {
      await this.handle2FA(code);
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getDownload(`https://fedex.com${invoice.link}`);
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
      await this.page.goto(this.authUrl, { waitUntil: 'domcontentloaded' });
      await this.page.locator('input#userId').fill(this.ws.username);
      await this.page.locator('input#password').fill(this.ws.password);
      await this.page.locator('button#login-btn').click();
      const data = await this.page.waitForResponse('https://auth.fedex.com/am/json/realms/root/realms/alpha/**');
      const response = await data.json();
      if (response.description && response.description === 'LOGIN.UNSUCCESSFUL') throw new Error('authenticationFailed');
      await this.page.waitForTimeout(5000);
      await this.page.waitForURL();
      const newUrl = this.page.url();
      if (newUrl === 'https://www.fedex.com/secure-login/#/authenticate') {
        this.onSuccess('Authentication complete');
        return this.fetch.bind(this);
      }

      const cancelBtn = this.page.locator('button#cancelBtn');
      if (cancelBtn) await cancelBtn.click();
      await this.page.waitForURL('**/logged-in-home.html');
      this.onSuccess('Authentication complete');
      this.authDone = true;
      return this.fetch.bind(this);
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
  async handle2FA(code) {
    try {
      const [i1, i2, i3, i4, i5, i6] = code.split('');
      await this.page.locator('input[id=input1]').fill(i1);
      await this.page.locator('input[id=input2]').fill(i2);
      await this.page.locator('input[id=input3]').fill(i3);
      await this.page.locator('input[id=input4]').fill(i4);
      await this.page.locator('input[id=input5]').fill(i5);
      await this.page.locator('input[id=input6]').fill(i6);
      await this.page.locator('button#submit-btn').click();
      const data = await this.page.waitForResponse('https://auth.fedex.com/am/json/realms/root/realms/alpha/**');
      const response = await data.json();
      if (response.description && response.description === 'USER.PIN.INVALIDOREXPIRED') throw new Error('authenticationFailed');
      const cancelBtn = this.page.locator('button#cancelBtn');
      if (cancelBtn) await cancelBtn.click();
      await this.page.waitForURL('**/logged-in-home.html');
      this.onSuccess('2FA Complete');
      this.authDone = true;
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
    const lastYearDate = subYears(currentDate, 1);

    const formattedDate = format(lastYearDate, 'MM/dd/yyyy');
    const fromYear = this.filters?.from ? format(parseISO(this.filters?.from), 'MM/dd/yyyy') : formattedDate;
    try {
      await this.page.goto(this.invoiceUrl, { waitUntil: 'networkidle' });
      await this.page.locator('li#searchDownload').click();
      await this.page.selectOption('#mainContentId\\:advTempl', 'Facturen');
      await this.page.locator('#mainContentId\\:fromDate').fill(fromYear);
      await this.page.waitForTimeout(3000);
      await this.page.locator('#mainContentId\\:newSerchCheckBox').click();
      await this.page.waitForTimeout(3000);
      await this.page.locator('#mainContentId\\:advancedSearchwldDataNewSrch').click();
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForSelector('table#mainContentId\\:invAdvSrchRsltTable');
      const invoiceTable = await this.page.$$('table#mainContentId\\:invAdvSrchRsltTable tbody tr');
      return await Promise.all(invoiceTable.map(async (invoice) => {
        const tdElements = await invoice.$$('td');
        const imgElement = await invoice.$('td img');
        const onclickAttributeValue = await imgElement?.getAttribute('onclick');
        const tdData = await Promise.all(tdElements.map(async (td) => {
          const textContent = await td.textContent();
          return textContent.trim();
        }));
        return {
          link: onclickAttributeValue,
          fileName: tdData[2],
          date: tdData[5],
          wsName: this.ws.name,
          description: tdData[2],
        };
      }));
    } catch (err) {
      this.onPageError(err.message, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.filter((item) => item.link !== undefined).map((item) => ({
      link: item.link.slice(9, -12),
      fileName: item.fileName,
      date: parse(item.date, 'dd-MMM-yyyy', new Date()),
      wsName: item.wsName,
      description: item.description,
    }));
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
module.exports = FedExProvider;
