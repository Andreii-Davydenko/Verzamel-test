const fs = require('fs/promises');
const Provider = require('./provider');

class VoysProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Voys';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://freedom.voys.nl/user/login/';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://freedom.voys.nl/client/CLIENT_ID/twinfield/invoices/';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

  /**
   * @private
   * @type {number}
   */
  clientId = undefined;

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListNormalized = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(invoiceListNormalized);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(invoice.description, invoice.downloadURL);
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
    const selectors = {
      username: '#id_auth-username',
      password: '#id_auth-password',
      submitButton: 'button[type=\'submit\']',
      errorMessage: 'div.vg-alert.vg-alert-error',
    };
    try {
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');
      const {
        username,
        password,
        submitButton,
        errorMessage,
      } = selectors;
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      await this.page.locator(submitButton).click();
      const regex = /^https:\/\/freedom\.voys\.nl\/client\/(\d+)\/dashboard\/$/;
      try {
        await this.page.waitForURL(
          regex,
          { timeout: 50000, waitUntil: 'domcontentloaded' },
        );
      } catch (error) {
        const passwordError = await this.page.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
      const [, clientId] = this.page.url().match(regex) || [];
      this.clientId = clientId;
    } catch (err) {
      await this.onPageError(err, this.page);
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return {string}
   */
  async getAuthCookie() {
    try {
      return (await this.page.context().cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join(';');
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {cookie: String, pageURL: String, userAgent: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    const pageURL = await this.page.url();
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    return { cookie, pageURL, userAgent };
  }

  async getDataFromPage() {
    return this.page.evaluate(() => {
      const initialList = document.querySelectorAll(
        'table > tbody > tr',
      );
      return Array.from(initialList).map((currentDiv) => {
        const [
          invoiceNumberTD,, // periodTD
          dateTD,
          invoiceAmountTD,
          statusTD,, // emptyTD
          actionTD,
        ] = currentDiv.children;
        return {
          invoiceId: invoiceNumberTD.textContent.trim(),
          status: statusTD.textContent.trim(),
          date: dateTD.textContent.trim(),
          amount: Number(invoiceAmountTD.textContent.trim().match(/\b\d{1,3}(?:,\d{1,2})?\b/)[0].replace(',', '.')),
          downloadURL: actionTD
            .querySelector('a.vg-table-iconlink')
            ?.href,
        };
      });
    });
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const invoices = [];
    try {
      await this.page.goto(this.invoiceUrl.replace('CLIENT_ID', this.clientId), { timeout: 50000 });
      await this.page.locator('#pagesize').selectOption('100');
      await this.page.waitForURL(`https://freedom.voys.nl/client/${
        this.clientId
      }/twinfield/invoices/?invoicenumber=&period=&order=-date&page=1`, {
        timeout: 50000, waitUntil: 'domcontentloaded',
      });
      const currentPagePaginationLength = await this.page.evaluate(() => {
        const paginationList = document.querySelectorAll('li.vg-pagination-item a.vg-pagination-link.js-pagination-page');
        return Array.from(paginationList).length + 1;
      });
      for (let pagesCount = 0; pagesCount < currentPagePaginationLength;) {
        if (pagesCount !== 0) {
          await this.page.goto(`https://freedom.voys.nl/client/${
            this.clientId
          }/twinfield/invoices/?invoicenumber=&period=&order=-date&page=${
            pagesCount + 1
          }`, {
            timeout: 50000,
            waitUntil: 'domcontentloaded',
          });
        }
        const currentPageData = await this.getDataFromPage();
        const currentPageDataLength = currentPageData.length;
        for (let itemCount = 0; itemCount < currentPageDataLength;) {
          const currentPoppedItem = currentPageData.pop();
          invoices.push(currentPoppedItem);
          itemCount += 1;
        }
        pagesCount += 1;
      }
    } catch (error) {
      if (!this.authDone) {
        await this.onPageError(new Error('authenticationFailed'), this.page);
        throw new Error('authenticationFailed');
      }
      await this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }

    return invoices;
  }

  convertDateFormat(dateString) {
    const months = {
      Jan: '01',
      Feb: '02',
      Mrt: '03',
      Apr: '04',
      Mei: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Okt: '10',
      Nov: '11',
      Dec: '12',
    };
    const parts = dateString.split(' ');
    const day = parseInt(parts[0], 10);
    const month = months[parts[1]];
    const year = parseInt(parts[2], 10);

    // Create a new date string in the "MM/DD/YYYY" format
    const newDateFormat = `${month}/${day}/${year}`;

    return newDateFormat;
  }

  /**
   * @private
   * @param {{object}[]} invoiceList
   * @return {{description: String, date: Date}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceId,
      fileName: invoice.invoiceId,
      date: new Date(this.convertDateFormat(invoice.date)),
      downloadURL: invoice.downloadURL,
    }));
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    const { cookie, pageURL, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(downloadURL, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          cookie,
          'user-agent': userAgent,
          'upgrade-insecure-requests': '1',
          Referer: pageURL,
          'Referrer-Policy': 'same-origin',
        },
        body: null,
        method: 'GET',
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

module.exports = VoysProvider;