const fs = require('fs/promises');
const Provider = require('./provider');

class EBoekhoudenNLProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'e-Boekhouden.nl';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://secure.e-boekhouden.nl/bh/inloggen.asp';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://secure20.e-boekhouden.nl/beheer/uwgegevens';

  /**
   * @private
   * @type {string}
   */
  invoiceListUrl = 'https://secure20.e-boekhouden.nl/v1/api/skillsource/factuur/recent/gridtable';

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

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[] | { error: String }>}
   */
  async fetch() {
    if (!this.authDone) {
      await this.authenticate();
    }
    const invoiceList = await this.getInvoiceList();
    const invoiceListFiltered = this.applyFilters(invoiceList);
    try {
      const invoiceData = await Promise.all(
        invoiceListFiltered.map(async (invoice) => {
          const download = await this.getInvoiceDownload(
            invoice.fileName,
            invoice.downloadURL,
          );
          this.updateFetchStatus(invoiceListFiltered.length);
          return {
            ...invoice,
            date: this.formatDate(invoice.date),
            download,
            wsName: this.ws.name,
          };
        }),
      );
      await this.page.goto('https://secure.e-boekhouden.nl/bh/uitloggen.asp?params=%5Bobject%20Object%5D');
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
      username: 'input#txtEmail',
      password: 'input#txtWachtwoord',
      submitButton: 'input#submit1',
      errorMessage: 'span#ERR_MSG',
    };
    try {
      await this.page.goto(this.authUrl, { timeout: 400000 });
      const {
        username, password, submitButton, errorMessage,
      } = selectors;
      const mainFrame = this.page
        .frames()
        .find(({ _url }) => _url.startsWith('https://secure.e-boekhouden.nl/bh/inloggen.asp'));
      await mainFrame.fill(username, this.ws.username);
      await mainFrame.fill(password, this.ws.password);
      const responsePromise = this.page.waitForResponse(
        (response) => response.url() === 'https://secure20.e-boekhouden.nl/v1/api/auth'
          && response.request().method() === 'POST',
      );
      await mainFrame.locator(submitButton).click();
      try {
        await responsePromise;
      } catch (error) {
        const passwordError = await mainFrame.locator(errorMessage).isVisible();
        if (passwordError) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
      return this.authDone;
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
      const thisPageURL = this.page.url();
      return (await this.page.context().cookies())
        .filter(
          ({ value, domain }) => !!value
            && thisPageURL.split('://')[1].split('/')[0].endsWith(domain),
        )
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ');
    } catch (error) {
      this.onError(new Error('authenticationFailed'));
      throw new Error('authenticationFailed');
    }
  }

  /**
   * @private
   * @return { {cookie: String, userAgent: String} }
   */
  async getAuthAccess() {
    const cookie = await this.getAuthCookie();
    const userAgent = await this.page.evaluate(() => navigator.userAgent);
    return { cookie, userAgent };
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const invoices = [];
    // Create a promise to resolve when the response is received
    // ?offset=NaN&limit=undefined&orderBy=&sortDirection=1
    try {
      const invoiceListResponsePromise = this
        .page
        .waitForResponse((response) => response
          .url()
          .startsWith(this.invoiceListUrl));
      // Navigate to a web page
      await this.page.goto(this.invoiceUrl);
      // Wait for the response to the specific request
      const invoiceListResponse = await invoiceListResponsePromise;
      if (invoiceListResponse) {
        const data = await invoiceListResponse.json();
        // data
        // invoices
        data.data.forEach(([documentId, date, fileName] = []) => {
          invoices.push({
            description: fileName,
            fileName,
            date: new Date(date),
            downloadURL: `https://secure20.e-boekhouden.nl/v1/api/SkillSource/factuur/recent/pdf/${documentId}`,
          });
        });
      }
    } catch (error) {
      this.onPageError(error, this.page);
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
    return invoices;
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceDownload(invoiceId, downloadURL) {
    const { cookie, userAgent } = await this.getAuthAccess();
    let arrayBuffer;
    try {
      const response = await fetch(downloadURL, {
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'sec-ch-ua':
            '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          cookie,
          Referer: this.page.url(),
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'user-agent': userAgent,
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

module.exports = EBoekhoudenNLProvider;
