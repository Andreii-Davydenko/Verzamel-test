const WooCommerceProvider = require('./woocommerce.provider');

class TransactieSysteemProvider extends WooCommerceProvider {
  /**
   * @private
   * @type {string}
   */
  name = 'TransactieSysteem';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://transactiesysteem.nl/mijn-account';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://transactiesysteem.nl/mijn-account/orders/';

  /**
   * @protected
   * @type {string}
   */
  usernameSelector = '#username:visible';

  /**
   * @protected
   * @type {string}
   */
  passwordSelector = '#password:visible';

  /**
   * @protected
   * @type {string}
   */
  submitSelector = '.woocommerce-form-login__submit:visible';

  /**
   * @protected
   * @type {string}
   */
  tableSelector = 'table.account-orders-table:visible';

  /**
   * @protected
   * @type {string}
   */
  tableRowSelector = 'tr.woocommerce-orders-table__row:visible';
}

module.exports = TransactieSysteemProvider;
