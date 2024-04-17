const WooCommerceProvider = require('./woocommerce.provider');

class MondkapjeswinkelProvider extends WooCommerceProvider {
  /**
   * @private
   * @type {string}
   */
  name = 'Mondkapjeswinkel.nl';

  /**
   * @private
   * @type {string}
   */
  authUrl = 'https://www.mondkapjeswinkel.nl/mijn-account';

  /**
   * @private
   * @type {string}
   */
  invoiceUrl = 'https://www.mondkapjeswinkel.nl/mijn-account/orders/';

  /**
   * @protected
   * @type {string}
   */
  usernameSelector = '#username';

  /**
   * @protected
   * @type {string}
   */
  passwordSelector = '#password';

  /**
   * @protected
   * @type {string}
   */
  submitSelector = '.woocommerce-form-login__submit';

  /**
   * @protected
   * @type {string}
   */
  tableSelector = 'table.account-orders-table';

  /**
   * @protected
   * @type {string}
   */
  tableRowSelector = 'tr.woocommerce-orders-table__row';
}

module.exports = MondkapjeswinkelProvider;
