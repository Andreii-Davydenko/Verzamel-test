const { parse } = require('date-fns');
const fs = require('fs/promises');
const crypto = require('crypto');
const Provider = require('./provider');

class TransIpProvider extends Provider {
  /**
   * @private
   * @type {string}
   */
  name = 'TransIP';

  /**
   * @private
   * @type {string}
   */
  baseUrl = 'https://api.transip.nl/v6/invoices';

  /**
   * @public
   * @return {Promise<{date: *, download: *, website: *, description: *}[]>}
   */
  async fetch() {
    const token = await this.authenticate();
    const invoiceList = await this.getInvoiceList(token);
    const normalizedInvoiceList = this.normalizeInvoiceList(invoiceList);
    const invoiceListFiltered = this.applyFilters(normalizedInvoiceList);
    try {
      return Promise.all(invoiceListFiltered.map(async (invoice) => {
        const download = await this.getDownload(invoice.description, token);
        this.updateFetchStatus(invoiceList.length);
        return {
          ...invoice,
          date: this.formatDate(invoice.date),
          download,
          fileName: invoice.description,
        };
      }));
    } catch (err) {
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<{issuedAt: String, lines: {description: String}[], _links: {pdf: String} }[]>}
   */
  async getInvoiceList(token) {
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 429) {
      this.onError(new Error(`${this.baseUrl} Request failed. Status ${response.statusText}`));
      throw new Error('authenticationFailed');
    }
    if (response.ok) {
      const data = await response.json();
      const invoices = data?.invoices || [];
      this.onSuccess('Collect invoice list complete', invoices);
      return invoices;
    }
    this.onError(new Error(`${this.baseUrl} Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @param {{ issuedAt:String, _links: {pdf: {href: String}}}[]} invoiceList
   * @return {{description: String, date: Date, link: String, wsName: String}[]}
   */
  normalizeInvoiceList(invoiceList) {
    return invoiceList.map((invoice) => ({
      description: invoice.invoiceNumber,
      date: this.parseDate(invoice.creationDate),
      wsName: this.ws.name,
    }));
  }

  /**
   * @private
   * @param {String} date
   * @return {Date}
   */
  parseDate(date) {
    return parse(date, 'yyyy-MM-dd', new Date());
  }

  /**
   * @private
   * @param {String} invoiceNo
   * @return {Object}
   */
  async getDownload(invoiceNo, token) {
    const response = await fetch(`${this.baseUrl}/${invoiceNo}/pdf`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      this.onSuccess('PDF prefetch complete', `$${this.baseUrl}/${invoiceNo}/pdf`);
      return {
        buffer: Buffer.from(data.pdf, 'base64'),
        async saveAs(path) {
          await fs.writeFile(path, this.buffer);
        },
      };
    }
    this.onError(new Error(`${this.baseUrl}/${invoiceNo}/pdf Request failed. Status ${response.statusText}`));
    throw new Error('failedToFetchInvoicesFromWebsite');
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  formatKey(requestBody) {
    try {
      // Format the Private Key
      const sign = crypto.createSign('sha512');
      sign.write(JSON.stringify(requestBody));
      sign.end();

      const privateKey = this.ws.password.split(/\s/);
      const joinFirstThree = privateKey.slice(0, Math.min(3, privateKey.length)).join(' ');
      const joinLastThree = privateKey.slice(-3).join(' ');
      const newArray = [joinFirstThree, ...privateKey.slice(3)];
      const key = [...newArray.slice(0, -3), joinLastThree].join('\n');

      const signature = sign.sign(key, 'base64');
      return signature;
    } catch (err) {
      this.onError(new Error(`Private Key error: ${err.message}`));
      throw new Error('failedToFetchInvoicesFromWebsite');
    }
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  async authenticate() {
    try {
      const requestBody = {
        login: this.ws.username,
        nonce: Math.random().toString(6),
        read_only: false,
        expiration_time: '1 hour',
        label: new Date(),
        global_key: true,
      };

      const key = this.formatKey(requestBody);

      const header = {
        'Content-Type': 'application/json',
        Signature: key,
      };

      const response = await fetch('https://api.transip.nl/v6/auth', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: header,
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const responseJson = await response.json();
      return responseJson.token;
    } catch (error) {
      throw new Error(`Failed to perform the request: ${error}`);
    }
  }
}

module.exports = TransIpProvider;
