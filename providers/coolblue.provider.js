const fs = require('fs/promises');
const Provider = require('./provider');

class CoolblueProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'Coolblue';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.coolblue.nl/inloggen';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.coolblue.nl/mijn-coolblue-account/orderoverzicht';

  /**
   * @private
   * @type {boolean}
   */
  authDone = false;

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
          const download = await this.getInvoiceDownload(
            invoice.description,
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
      username: 'input[name="emailaddress"]',
      password: 'input[name="password"]',
      submitButton:
        'div.section--5 > button.button.button--order.button--full-width',
      errorMessage: 'div.section--4 > div.notice.notice--critical',
      cookieNotice: 'button[name="accept_cookie"][value="1"]',
    };
    try {
      const {
        username, password, submitButton, errorMessage, cookieNotice,
      } = selectors;
      // Intercept network requests
      let specialCount = 0;
      await this.page.route('**/*', async (route, request) => {
        // Check if the request URL ends with "/tactics"
        if (
          request.url().endsWith('/challenge.js')
          || request.url().endsWith('/captcha.js')
        ) {
          route.abort();
          specialCount += 1;
        } else {
          // Allow other requests to proceed as usual
          route.continue();
        }
      });
      await this.page.goto(this.authUrl);
      await this.page.waitForLoadState('domcontentloaded');

      const gokuProps = await this.page.evaluate(() => window.gokuProps);
      if (
        !!gokuProps
        && !!gokuProps.key
        && !!gokuProps.context
        && !!gokuProps.iv
      ) {
        const solution = await this.solveAmazonCaptcha({
          websiteURL: this.authUrl,
          challengeScript:
            'https://f77da8442268.f70af3f4.eu-west-1.token.awswaf.com/f77da8442268/21ef78819f78/b2f9a0619450/challenge.js',
          captchaScript:
            'https://f77da8442268.f70af3f4.eu-west-1.captcha.awswaf.com/f77da8442268/21ef78819f78/b2f9a0619450/captcha.js',
          websiteKey: gokuProps.key,
          context: gokuProps.context,
          iv: gokuProps.iv,
        });
        if (!solution) throw new Error('CAPTCHA not solved');
        const voucherResponseJSONToken = await this.page.evaluate(
          async (providedSolution) => {
            let numberOfTries = 0;
            let canRetry = numberOfTries < 5;
            while (canRetry) {
              try {
                canRetry = false;
                numberOfTries += 1;
                const voucherResponse = await fetch(
                  'https://f77da8442268.f70af3f4.eu-west-1.token.awswaf.com/f77da8442268/21ef78819f78/b2f9a0619450/voucher',
                  {
                    headers: {
                      accept: '*/*',
                      'accept-language': 'en-US,en;q=0.9',
                      'cache-control': 'no-cache',
                      'content-type': 'text/plain;charset=UTF-8',
                      pragma: 'no-cache',
                      'sec-ch-ua':
                    '" Not A;Brand";v="99", "Chromium";v="120", "Google Chrome";v="120"',
                      'sec-ch-ua-mobile': '?0',
                      'sec-ch-ua-platform': '"Windows"',
                      'sec-fetch-dest': 'empty',
                      'sec-fetch-mode': 'cors',
                      'sec-fetch-site': 'cross-site',
                    },
                    referrer: 'https://www.coolblue.nl/',
                    referrerPolicy: 'strict-origin-when-cross-origin',
                    body: JSON.stringify({
                      captcha_voucher: providedSolution.captcha_voucher,
                      existing_token: providedSolution.existing_token,
                    }),
                    method: 'POST',
                    mode: 'cors',
                    credentials: 'omit',
                  },
                );
                const voucherResponseJSON = await voucherResponse.json();
                return voucherResponseJSON.token;
              } catch (error) {
                canRetry = numberOfTries < 5;
              }
            }
            return null;
          },
          solution,
        );
        if (!voucherResponseJSONToken) throw new Error('CAPTCHA not solved');
        this.onSuccess('CAPTCHA solved');
        await this.page.context().addCookies([
          {
            name: 'aws-waf-token',
            value: voucherResponseJSONToken,
            domain: '.www.coolblue.nl',
            path: '/',
            expires: Math.floor(Date.now() / 1000) + 5 * 60 * 60 * 24, // expires in 5 day
          },
        ]);
        // Reload the page to apply the new cookies
        const pageLoadPromise = this.page.waitForURL(this.authUrl, {
          timeout: 50000,
          waitUntil: 'domcontentloaded',
        });
        const responsePromise = this.page.waitForResponse(
          (response) => response.url() === this.authUrl,
          { timeout: 3000 },
        );
        await this.page.goto(this.authUrl);
        await this.page.waitForLoadState('domcontentloaded');
        await pageLoadPromise;
        await responsePromise;
        if (specialCount > 2) throw new Error('CAPTCHA solution not accepted');
      }

      await new Promise((resolve) => {
        const startTime = new Date();
        (async () => {
          while (new Date() - startTime < 60000) {
            const noticeShowing = await this.page.$$(cookieNotice);
            if (!!noticeShowing && noticeShowing.length) {
              return resolve();
            }
          }
          return resolve();
        })();
      });
      await this.page.locator(cookieNotice).click();
      await new Promise((resolve) => {
        const startTime = new Date();
        (async () => {
          while (new Date() - startTime < 60000) {
            const emailElementsAvailable = await this.page.$$(username);
            if (!!emailElementsAvailable && emailElementsAvailable.length) {
              return resolve();
            }
          }
          return resolve();
        })();
      });
      // Locate all elements matching the selector
      const emailElements = await this.page.$$(username);

      // Check if the second element exists and fill it
      if (emailElements.length >= 2) {
        await emailElements[1].fill(this.ws.username);
      } else {
        throw new Error('authenticationFailed');
      }
      // Locate all elements matching the selector
      const passwordElements = await this.page.$$(password);

      // Check if the second element exists and fill it
      if (passwordElements.length >= 1) {
        await passwordElements[1].fill(this.ws.password);
      } else {
        throw new Error('authenticationFailed');
      }

      // Locate all elements matching the selector
      const submitButtonElements = await this.page.$$(submitButton);

      // Check if the second element exists and fill it
      if (submitButtonElements.length >= 1) {
        await submitButtonElements[1].click();
      } else {
        throw new Error('authenticationFailed');
      }
      try {
        await this.page.waitForURL(
          'https://www.coolblue.nl/mijn-coolblue-account',
          { timeout: 50000, waitUntil: 'domcontentloaded' },
        );
      } catch (error) {
        const passwordErrorElements = await this.page.$$(errorMessage);
        if (passwordErrorElements.length >= 1) {
          throw new Error('authenticationFailed');
        } else {
          throw error;
        }
      }
      this.onSuccess('Authentication complete');
      this.authDone = true;
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
        'div.order-row.section--2 > a',
      );
      return Array.from(initialList).map((currentA) => currentA?.href);
    });
  }

  async getProductDetail() {
    return this.page.evaluate(() => [
      document.querySelector(
        'span.color--additional.mr--2 > span.color--default',
      )?.textContent,
      document.querySelector(
        'div.grid.gap-x--2.gap-y--4 '
          + 'div.col--7 div.section--2'
          + ' a.call-to-action.call-to-action__link',
      )?.href,
    ]);
  }

  /**
   * @private
   * @param {object}
   */
  async getInvoiceList() {
    const invoices = [];
    let pageLoadCount = 1;
    try {
      for (;;) {
        const theURLToFetchOn = `${this.invoiceUrl}?page=${pageLoadCount}`;
        await this.page.goto(theURLToFetchOn, { timeout: 50000 });
        await this.page.waitForURL(theURLToFetchOn, {
          timeout: 50000,
          waitUntil: 'domcontentloaded',
        });
        const currentPageData = await this.getDataFromPage();
        if (Array.isArray(currentPageData) && currentPageData.length) {
          const currentPageDataLength = currentPageData.length;
          for (let itemCount = 0; itemCount < currentPageDataLength;) {
            const currentPoppedItem = currentPageData.pop();
            // const productDetailURL = ``;
            await this.page.goto(currentPoppedItem, { timeout: 50000 });
            await this.page.waitForURL(currentPoppedItem, {
              timeout: 50000,
              waitUntil: 'domcontentloaded',
            });
            if (typeof currentPoppedItem === 'string') {
              const [date, downloadURL] = await this.getProductDetail();
              if (typeof date === 'string' && typeof downloadURL === 'string') {
                const currentPoppedItemSplittedWithSlash = currentPoppedItem.split('/');
                invoices.push({
                  invoiceId:
                    currentPoppedItemSplittedWithSlash[
                      currentPoppedItemSplittedWithSlash.length - 1
                    ],
                  date,
                  downloadURL,
                });
              }
            }
            itemCount += 1;
          }
        } else {
          break;
        }
        pageLoadCount += 1;
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

  convertDateFormat(inputDate) {
    // Split the input date string into day, month, and year
    const parts = inputDate.split(' ');
    // Create a new date string in the "MM/DD/YYYY" format
    const newDateFormat = `${
      {
        januari: '01',
        februari: '02',
        maart: '03',
        april: '04',
        mei: '05',
        juni: '06',
        juli: '07',
        augustus: '08',
        september: '09',
        oktober: '10',
        november: '11',
        december: '12',
      }[`${parts[1]}`.toLowerCase().split()]
    }/${parts[0]}/${parts[2]}`;

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
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'sec-ch-ua':
            '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
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

module.exports = CoolblueProvider;
