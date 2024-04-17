const fs = require('fs/promises');
const Provider = require('./provider');

class NSZakelijkProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'NS Zakelijk';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.ns.nl/mijnnszakelijk/login#/inloggen/contactpersoon';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.ns.nl/mijnnszakelijk/facturen';

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

  async waitForSelector(frameContext, selector, timeInMilliSeconds) {
    if (!frameContext || !(typeof frameContext.$$ === 'function')) {
      return false;
    }
    const numericTimeInMilliSeconds = Number(timeInMilliSeconds);
    const startTime = new Date();
    while (!(new Date() - startTime > (numericTimeInMilliSeconds || 60000))) {
      const targetOnFrame = await frameContext.$$(selector);
      if (!!targetOnFrame && targetOnFrame.length) {
        return true;
      }
    }
    return false;
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async authenticate() {
    const selectors = {
      username: '#credential',
      password: '#password',
      submitButton: 'nes-button.nes-widthAuto.hydrated',
      errorMessage: '#message',
      cookieNotice: 'div.cookie-notice__popup',
      recaptchaIFrame: "iframe[title='reCAPTCHA']",
      cookieNoticeButton: 'button.cookie-notice__btn-accept.hide-in-settings',
    };
    try {
      const whenDomContentLoaded = this.page.waitForLoadState('domcontentloaded');
      await this.page.goto(this.authUrl, { timeout: 50000 });
      await whenDomContentLoaded;
      const {
        username,
        password,
        submitButton,
        errorMessage,
        cookieNotice,
        cookieNoticeButton,
        recaptchaIFrame,
      } = selectors;
      const cookieNoticeActive = await this.waitForSelector(this.page, cookieNotice, 60000);
      if (cookieNoticeActive) await this.page.locator(cookieNoticeButton).click();
      await this.waitForSelector(this.page, username, 60000);
      await this.page.locator(username).fill(this.ws.username);
      await this.page.locator(password).fill(this.ws.password);
      const MAX_RETRIES = 2;
      let tryCount = 0;
      let shouldTry = tryCount < MAX_RETRIES;
      while (shouldTry) {
        shouldTry = false;
        tryCount += 1;
        try {
          await this.page.locator(submitButton).click();
          await this.page.waitForURL(
            'https://www.ns.nl/mijnnszakelijk/home?0&taal=nl',
            { waitUntil: 'domcontentloaded' },
          );
        } catch (error) {
          const regex = /timeout/i;
          const passwordError = await this.page.locator(errorMessage).isVisible();
          if (passwordError) {
            throw new Error('authenticationFailed');
          } else if (typeof error.message === 'string' && regex.test(error.message)
          ) {
            shouldTry = tryCount < MAX_RETRIES;
            if (!shouldTry) {
              throw error;
            }
            const captchaFrame = (await this.page.waitForSelector(recaptchaIFrame)).isVisible();
            if (captchaFrame) {
              const captchaSolved = await this.page.solveRecaptchas();
              if (!!captchaSolved && !!captchaSolved.solved[0] && captchaSolved.solved[0].isSolved === false) throw new Error('CAPTCHA not solved');
              this.onSuccess('CAPTCHA solved');
            }
          } else {
            shouldTry = false;
            throw error;
          }
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
        'div.facturen.nes-w-full > div > div.nes-border-panel.nes-my-3',
      );
      return Array.from(initialList).map((currentDiv) => {
        const [
          invoiceIdAndStatusContainer,
          dateContainer,
          amountContainer, ,
          downloadsContainer,
        ] = currentDiv.children;
        return {
          invoiceId: invoiceIdAndStatusContainer
            .querySelector('#factuurnr')
            .textContent.trim(),
          status: invoiceIdAndStatusContainer
            .querySelector('#status')
            .textContent.trim(),
          date: dateContainer.querySelector('#datum').textContent.trim(),
          amount: Number(amountContainer
            .querySelector('#credit-debet')
            .textContent.trim().match(/\b\d{1,3}(?:,\d{1,2})?\b/)[0].replace(',', '.')),
          downloadURL: downloadsContainer
            .querySelector('a.nes-flex.nes-items-center.nes-button.nes-button-secondary.nes-w-full-resp.nes-mr-3.nes-mb-5')
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
    // Pagination
    // document.querySelectorAll(`.pages.nes-flex.nes-justify-center > span`)
    let pageLoadCount = 0;
    try {
      await this.page.goto(this.invoiceUrl, { timeout: 50000 });
      pageLoadCount += 1;
      await this.page.waitForURL(`https://www.ns.nl/mijnnszakelijk/facturen?${pageLoadCount}`, {
        timeout: 50000, waitUntil: 'domcontentloaded',
      });

      await this.page.locator('#departmentChoice').selectOption('');
      await this.page.locator('div.nes-w-container span').click();
      pageLoadCount += 1;
      await this.page.waitForURL(`https://www.ns.nl/mijnnszakelijk/facturen?${pageLoadCount}`, {
        timeout: 50000, waitUntil: 'domcontentloaded',
      });
      await this.page.waitForResponse((response) => response.url().includes('https://www.ns.nl/mijnnszakelijk/facturen?2-2.IBehaviorListener.0-resultPanel&_='));
      const currentPagePagination = await this.page.evaluate(() => {
        const paginationList = document.querySelectorAll('.pages.nes-flex.nes-justify-center > span > a');
        return Array.from(paginationList)
          .map((currentATag) => currentATag?.href?.trim())
          .filter((currentATagHref) => !!currentATagHref);
      });
      const currentPagePaginationLength = currentPagePagination.length + 1;
      for (let pagesCount = 0; pagesCount < currentPagePaginationLength;) {
        if (pagesCount !== 0) {
          await this.page.goto(`https://www.ns.nl/mijnnszakelijk/facturen?${pageLoadCount}-${pagesCount + 1}.ILinkListener-resultPanel-content-pager-navigation-${pagesCount}-pageLink`, { timeout: 50000 });
          pageLoadCount += 1;
          await this.page.waitForURL(`https://www.ns.nl/mijnnszakelijk/facturen?${pageLoadCount}`, {
            timeout: 50000, waitUntil: 'domcontentloaded',
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

  convertDateFormat(inputDate) {
    // Split the input date string into day, month, and year
    const parts = inputDate.split('-');

    // Create a new date string in the "MM/DD/YYYY" format
    const newDateFormat = `${parts[1]}/${parts[0]}/${parts[2]}`;

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

module.exports = NSZakelijkProvider;
