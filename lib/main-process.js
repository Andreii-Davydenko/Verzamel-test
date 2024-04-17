const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { format } = require('date-fns');
const nodemailer = require('nodemailer');
const { Base64 } = require('js-base64');
const providers = require('../providers');
const Normalizer = require('./normalizer');
const Logger = require('./logger');

const ActiveCampaignPartnerProvider = require('../providers/activecampaignpartner.provider');
const AmazonNlProvider = require('../providers/amazon-nl.provider');
const BenProvider = require('../providers/ben.provider');
const BolParticulierProvider = require('../providers/bol-particulier.provider');
const BolRetailProvider = require('../providers/bol-retail.provider');
const BolZakelijkProvider = require('../providers/bol-zakelijk.provider');
const CalendlyProvider = require('../providers/calendly.provider');
const CanvaProvider = require('../providers/canva.provider');
const ChannableProvider = require('../providers/channable.provider');
const CheapConnectProvider = require('../providers/cheapconnect.provider.js');
const CloudwaysProvider = require('../providers/cloudways.provider');
const CoolblueProvider = require('../providers/coolblue.provider');
const DeKwekerProvider = require('../providers/de-kweker.provider.js');
const DigitalOceanProvider = require('../providers/digital-ocean.provider');
const DropboxProvider = require('../providers/dropbox.provider');
const EBoekhoudenNLProvider = require('../providers/e-boekhouden-nl.provider.js');
const FacebookAdsTransactionsProvider = require('../providers/facebookads-transactions.provider');
const FedExProvider = require('../providers/fedex.provider');
const GammaProvider = require('../providers/gamma.provider.js');
const GoogleAdsProvider = require('../providers/google-ads.provider');
const HollandsnieuweProvider = require('../providers/hollandsnieuwe.provider.js');
const InktNl123Provider = require('../providers/123inkt-nl.provider');
const KlaviyoProvider = require('../providers/klaviyo.provider');
const LaterProvider = require('../providers/later.provider');
const LebaraProvider = require('../providers/lebara.provider');
const MailchimpProvider = require('../providers/mailchimp.provider');
const MailchimpMultiProvider = require('../providers/mailchimp-multi.provider');
const MakeProvider = require('../providers/make.provider');
const MakroProvider = require('../providers/makro.provider');
const Microsoft365PersonalProvider = require('../providers/microsoft365-personal.provider');
const MijndomeinProvider = require('../providers/mijndomein.provider');
const MKBBrandstofProvider = require('../providers/mkb-brandstof.provider');
const MollieProvider = require('../providers/mollie.provider');
const MondkapjeswinkerProvider = require('../providers/mondkapjeswinkel.provider');
const MoneybirdProvider = require('../providers/moneybird.provider');
const MoneybirdPortalProvider = require('../providers/moneybird-portal.provider');
const MyParcelProvider = require('../providers/myparcel.provider');
const NSZakelijkProvider = require('../providers/ns-zakelijk.provider.js');
const OdidoZakelijkProvider = require('../providers/odido-zakelijk.provider');
const OdidoZakelijkVerzamelfacturenProvider = require('../providers/odido-zakelijk-verzamelfacturen.provider');
const OpenAIPlatformProvider = require('../providers/openai-platform.provider');
const OrderchampProvider = require('../providers/orderchamp.provider');
const ParkLineProvider = require('../providers/park-line.provider');
const ParkmobileProvider = require('../providers/park-mobile.provider');
const PhoenixProvider = require('../providers/phoenix.provider.js');
const PinterestBusinessProvider = require('../providers/pinterest-business.provider');
const PixlrProvider = require('../providers/pixlr.provider');
const PlugAndPayStoreProvider = require('../providers/plug-and-pay-store.provider.js');
const QParkProvider = require('../providers/q-park.provider');
const RinkelProvider = require('../providers/rinkel.provider');
const SendcloudProvider = require('../providers/sendcloud.provider');
const SpecialLeaseProvider = require('../providers/special-lease.provider.js');
const ShopifyProvider = require('../providers/shopify.provider');
const SimpelProvider = require('../providers/simpel.provider.js');
const SimyoProvider = require('../providers/simyo.provider.js');
const SpotifyProvider = require('../providers/spotify.provider.js');
const TradetrackerPublisherProvider = require('../providers/tradetracker-publisher.provider');
const TransactieSysteemProvider = require('../providers/transactiesysteem.provider');
const TransIpProvider = require('../providers/transip.provider');
const UpworkFreelancerProvider = require('../providers/upwork-freelancer.provider');
const UpworkClientProvider = require('../providers/upwork-client.provider');
const VandebronProvider = require('../providers/vandebron.provider.js');
const VersioOudPortaalProvider = require('../providers/versio-oud-portaal.provider');
const VerzamelSysteemProvider = require('../providers/verzamelsysteem.provider');
const VimexxProvider = require('../providers/vimexx.provider');
const VodafoneZakelijkProvider = require('../providers/vodafone-zakelijk.provider.js');
const VoysProvider = require('../providers/voys.provider.js');
const WHMCSProvider = require('../providers/whmcs.provider');
const WPMLProvider = require('../providers/wpml.provider');
const YellowbrickProvider = require('../providers/yellowbrick.provider');
// const YoufoneProvider = require('../providers/youfone.provider');
const YoufoneSimOnlyProvider = require('../providers/youfone-simonly.provider.js');
const ZapierProvider = require('../providers/zapier.provider');
const ZiggoProvider = require('../providers/ziggo.provider.js');

const GoogleOAuth = require('../oauth/google.oauth');

class MainProcess {
  /**
   * @private
   * @type {{ download: import('playwright-core').Download, id: String}[]}
   */
  availableDownloads = [];

  /**
   * @private
   * @type {Electron.BrowserWindow}
   */
  win = null;

  /**
   * @private
   * @type {Logger}
   */
  logger = null;

  /**
   * @private
   * @type {Map<String, Function>}
   */
  twoFAWaitingList = new Map();

  /**
   * @private
   * @type {number}
   */
  fetchCount = 0;

  /**
   * @private
   * @type {Map<string, Function>}
   */
  providers = new Map([
    ['https://www.activecampaign.com/partner/invoices.php', ActiveCampaignPartnerProvider],
    ['https://www.amazon.nl/gp/css/order-history', AmazonNlProvider],
    ['https://www.ben.nl/ikben/facturen', BenProvider],
    ['https://www.bol.com/nl/rnwy/account/facturen/betaald', BolParticulierProvider],
    ['https://api.bol.com/retailer/invoices', BolRetailProvider],
    ['https://www.bol.com/nl/rnwy/account/facturen/openstaand', BolZakelijkProvider],
    ['https://calendly.com/app/admin/billing', CalendlyProvider],
    ['https://www.canva.com/settings/purchase-history', CanvaProvider],
    ['https://app.channable.com/companies/STORE_ID/pricing', ChannableProvider],
    ['https://account.cheapconnect.net/invoices.php', CheapConnectProvider],
    ['https://platform.cloudways.com/account/invoice', CloudwaysProvider],
    ['https://www.coolblue.nl/mijn-coolblue-account/orderoverzicht', CoolblueProvider],
    ['https://www.dekweker.nl/mijn-account/facturen-pakbonnen.html', DeKwekerProvider],
    ['https://cloud.digitalocean.com/account/billing', DigitalOceanProvider],
    ['https://www.dropbox.com/manage/billing', DropboxProvider],
    ['https://secure20.e-boekhouden.nl/beheer/uwgegevens', EBoekhoudenNLProvider],
    ['https://business.facebook.com/billing_hub/payment_activity', FacebookAdsTransactionsProvider],
    ['https://www.fedex.com/fedexbillingonline/pages/accountsummary/accountSummaryFBO.xhtml', FedExProvider],
    ['https://mijn.gamma.nl/mijn-aankopen/', GammaProvider],
    ['https://ads.google.com/aw/billing/documents', GoogleAdsProvider],
    ['https://www.hollandsnieuwe.nl/mijn-hollandsnieuwe/ACCOUNT_ID/facturen', HollandsnieuweProvider],
    ['https://www.123inkt.nl/customer/invoices.html', InktNl123Provider],
    ['https://www.klaviyo.com/settings/billing/payment-history', KlaviyoProvider],
    ['https://app.later.com/account/subscription/billing', LaterProvider],
    ['https://www.lebara.nl/nl/mylebara/postpaid-bills.html', LebaraProvider],
    ['https://us10.admin.mailchimp.com/account/billing-history/', MailchimpProvider],
    ['https://us7.admin.mailchimp.com/account/billing-history/', MailchimpMultiProvider],
    ['https://eu2.make.com/organization/ORGANIZATION_ID/payments', MakeProvider],
    ['https://docs.makro.nl/', MakroProvider],
    ['https://account.microsoft.com/billing/orders', Microsoft365PersonalProvider],
    ['https://mijnaccount.mijndomein.nl/facturen', MijndomeinProvider],
    ['https://mijn.mkb-brandstof.nl', MKBBrandstofProvider],
    ['https://api.mollie.com/v2/invoices', MollieProvider],
    ['https://www.mondkapjeswinkel.nl/mijn-account/orders/', MondkapjeswinkerProvider],
    ['https://moneybird.com', MoneybirdProvider],
    ['https://moneybird.com/', MoneybirdPortalProvider],
    ['https://backoffice.myparcel.nl/invoices', MyParcelProvider],
    ['https://www.ns.nl/mijnnszakelijk/facturen', NSZakelijkProvider],
    ['https://www.odido.nl/zakelijk/my/facturen', OdidoZakelijkProvider],
    ['https://www.odido.nl/zakelijk/my/verzamelfacturen', OdidoZakelijkVerzamelfacturenProvider],
    ['https://platform.openai.com/account/billing/history', OpenAIPlatformProvider],
    ['https://www.orderchamp.com/nl/supplier_invoices', OrderchampProvider],
    ['https://mijn.park-line.nl/Epms/ClientPages/client/client_invoices.aspx', ParkLineProvider],
    ['https://account.parkmobile.com/invoices/all', ParkmobileProvider],
    ['https://app.phoenixsite.nl/sitemanager#/account/invoices', PhoenixProvider],
    ['https://ads.pinterest.com/login/', PinterestBusinessProvider],
    ['https://pixlr.com/nl/myaccount/', PixlrProvider],
    ['https://v2.plugandpay.nl/settings/license/invoices', PlugAndPayStoreProvider],
    ['https://www.q-park.nl/nl-nl/myqpark/myaccount/myinvoices/', QParkProvider],
    ['https://my.rinkel.com/account/billing', RinkelProvider],
    ['https://app.sendcloud.com/v2/settings/financial/invoices/list', SendcloudProvider],
    ['https://uwfactuuronline.speciallease.nl/#/documents', SpecialLeaseProvider],
    ['https://admin.shopify.com/store', ShopifyProvider],
    ['https://mijn.simpel.nl/facturen?sid=SUBSCRIPTION_ID', SimpelProvider],
    ['https://mijn.simyo.nl/facturen', SimyoProvider],
    ['https://www.spotify.com/nl/account/order-history/subscription/', SpotifyProvider],
    ['https://affiliate.tradetracker.com/financial/invoice', TradetrackerPublisherProvider],
    ['https://transactiesysteem.nl/mijn-account/orders', TransactieSysteemProvider],
    ['https://api.transip.nl/v6/invoices', TransIpProvider],
    ['https://www.upwork.com/nx/payments/reports/transaction-history', UpworkClientProvider],
    ['https://www.upwork.com/nx/payments/reports/transaction-history#', UpworkFreelancerProvider],
    ['https://mijn.vandebron.nl/thuis/financieel', VandebronProvider],
    ['https://www.versio.nl/customer/financial/invoices', VersioOudPortaalProvider],
    ['https://verzamelsysteem.nl/mijn-account/orders', VerzamelSysteemProvider],
    ['https://my.vimexx.nl/order', VimexxProvider],
    ['https://www.vodafone.nl/my/rekeningen', VodafoneZakelijkProvider],
    ['https://freedom.voys.nl/client/CLIENT_ID/twinfield/invoices/', VoysProvider],
    ['https://www.whmcs.com/members/clientarea.php?action=invoices', WHMCSProvider],
    ['https://wpml.org/account/view_order/', WPMLProvider],
    ['https://my.yellowbrick.nl/#/profile/payment', YellowbrickProvider],
    // ['https://my.youfone.nl/facturen', YoufoneProvider],
    ['https://my.youfone.nl/facturen', YoufoneSimOnlyProvider],
    ['https://zapier.com/app/settings/billing', ZapierProvider],
    ['https://www.ziggo.nl/mijn-ziggo/facturen/overzicht', ZiggoProvider],
  ]);

  /**
   * @private
   * @type {Map<string, Function>}
   */
  oauth = new Map([
    ['google', GoogleOAuth],
  ]);

  /**
   * Initialize the main process
   * @param {Electron} [electron] electron engine
   * @param {Repository} [repo] data repository
   * @param {Browser} [browser] browser instance
   */
  constructor(electron, repo, browser) {
    this.electron = electron;
    this.repo = repo;
    this.browser = browser;
    this.normalizer = new Normalizer();
  }

  /**
   * @private
   * @param {(() => Promise)[]} functions
   * @return {Promise<*>[]}
   */
  async runSequentially(functions) {
    if (functions.length === 0) return [];
    const [first, ...rest] = functions;
    return [await first(), ...(await this.runSequentially(rest))];
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async createWindow() {
    const win = new this.electron.BrowserWindow({
      width: 1000,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'bridge.js'),
      },
    });
    await win.loadFile('window/index.html');
    this.win = win;
  }

  /**
   * @private
   * @return {void}
   */
  handleEvents() {
    this.electron.app.on('activate', () => {
      if (this.electron.BrowserWindow.getAllWindows().length === 0) this.createWindow();
    });
    this.electron.app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.electron.app.quit();
      }
    });
    this.electron.app.on('before-quit', () => {
      try {
        this.electron.app.quit();
      } catch (err) {
        process.exit();
      }
    });
  }

  /**
   * @private
   * @return {void}
   */
  setupIpc() {
    this.electron.ipcMain.handle(
      'createWebsite',
      async (event, website) => this.repo.createWebsite(website),
    );
    this.electron.ipcMain.handle(
      'updateWebsite',
      async (event, website) => this.repo.updateWebsite(website),
    );
    this.electron.ipcMain.handle(
      'deleteWebsite',
      async (event, id) => this.repo.deleteWebsite(id),
    );
    this.electron.ipcMain.handle(
      'getAllWebsites',
      async () => this.repo.getAllWebsites(),
    );
    this.electron.ipcMain.handle(
      'getWebsitesByIds',
      async (event, ids) => this.repo.getWebsitesByIds(ids),
    );
    this.electron.ipcMain.handle(
      'getProviders',
      () => providers,
    );
    this.electron.ipcMain.handle(
      'initBrowser',
      async () => this.initBrowser(),
    );
    this.electron.ipcMain.handle(
      'fetchInvoices',
      async (
        event,
        dateRange,
        websiteIdsToFetchFor,
      ) => this.fetchInvoices(
        dateRange,
        websiteIdsToFetchFor,
      ),
    );
    this.electron.ipcMain.handle(
      'getAllInvoices',
      async () => this.repo.getAllInvoices(),
    );
    this.electron.ipcMain.handle(
      'deleteAllInvoices',
      async () => this.repo.deleteAllInvoices(),
    );
    this.electron.ipcMain.handle(
      'downloadInvoice',
      async (event, ctx) => this.downloadInvoice(ctx),
    );
    this.electron.ipcMain.handle(
      'getInvoicePathForMail',
      async (event, id) => this.getInvoicePathForMail(id),
    );
    this.electron.ipcMain.handle(
      'deleteSelectedInvoices',
      async (event, ids) => this.repo.bulkDeleteInvoices(ids),
    );
    this.electron.ipcMain.handle(
      'insertEmailedInvoice',
      async (event, combination) => this.repo.insertEmailedInvoice(combination),
    );
    this.electron.ipcMain.handle(
      'getAllEmailedInvoices',
      async () => this.repo.getAllEmailedInvoices(),
    );
    this.electron.ipcMain.handle(
      'deleteAllEmailedInvoices',
      async () => this.repo.deleteAllEmailedInvoices(),
    );
    this.electron.ipcMain.handle(
      'insertDownloadedInvoice',
      async (event, combination) => this.repo.insertDownloadedInvoice(combination),
    );
    this.electron.ipcMain.handle(
      'getAllDownloadedInvoices',
      async () => this.repo.getAllDownloadedInvoices(),
    );
    this.electron.ipcMain.handle(
      'deleteAllDownloadedInvoices',
      async () => this.repo.deleteAllDownloadedInvoices(),
    );
    this.electron.ipcMain.handle(
      'getSettings',
      async () => this.repo.getSettings(),
    );
    this.electron.ipcMain.handle(
      'saveSettings',
      async (event, settings) => this.saveSettings(settings),
    );
    this.electron.ipcMain.handle(
      'resolve2FA',
      async (event, payload) => this.resolve2FAInput(payload),
    );
    this.electron.ipcMain.handle(
      'getOAuthCredentials',
      async (event, key) => this.getOAuthCredentials(key),
    );
    this.electron.ipcMain.handle(
      'checkForUpdates',
      async () => this.checkForUpdates(),
    );
    this.electron.ipcMain.handle(
      'downloadUpdate',
      async () => this.downloadUpdate(),
    );
    this.electron.ipcMain.handle(
      'getLicenseStatus',
      () => this.getLicenseStatus(),
    );
    this.electron.ipcMain.handle(
      'getCurrentVersion',
      () => this.getCurrentVersion(),
    );
    this.electron.ipcMain.handle(
      'ensureDocumentsDir',
      async () => this.ensureDocumentsDir(),
    );
    this.electron.ipcMain.handle(
      'sendMail',
      async (event, settings) => this.sendMail(settings),
    );
  }

  /**
   * @private
   * @param {Object} settings
   * @param {string} settings.format
   * @param {string} settings.dateFormat
   * @param {boolean} settings.debugMode
   * @param {boolean} settings.licenseKey
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    this.logger.setDebugMode(settings.debugMode);
    return this.repo.updateSettings(settings);
  }

  /**
   * @private
   * @return {Promise<Object>}
   */
  async initBrowser() {
    try {
      await this.browser.init();
      return { success: true };
    } catch (err) {
      return { error: 'chromeInitializationFailed' };
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async initSettings() {
    const defaultSettings = {
      format: '[suggested-filename]', dateFormat: 'd-M-yyyy', debugMode: false, licenseKey: '',
    };
    const settings = await this.repo.getSettings()
      || await this.repo.createSettings(defaultSettings);
    if (!Object.prototype.hasOwnProperty.call(settings, 'format')) {
      await this.repo.updateSettings({
        ...settings,
        format: defaultSettings.format,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(settings, 'dateFormat')) {
      await this.repo.updateSettings({
        ...settings,
        dateFormat: defaultSettings.dateFormat,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(settings, 'debugMode')) {
      await this.repo.updateSettings({
        ...settings,
        debugMode: defaultSettings.debugMode,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(settings, 'licenseKey')) {
      await this.repo.updateSettings({
        ...settings,
        licenseKey: defaultSettings.licenseKey,
      });
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async initLogger() {
    const settings = await this.repo.getSettings();
    const date = format(new Date(), 'dd-MM-yyyy');
    const baseLogPath = `${this.electron.app.getPath('documents')}/VerzamelSysteem/Debug-log-${date}`;
    this.logger = new Logger(baseLogPath, settings.debugMode);
  }

  /**
   * @private
   * @param {{ from: String, to: String }} filters
   * @return {Promise<Object[]>}
   */
  async fetchInvoices(filters, websiteIdsToFetchFor) {
    await this.repo.deleteAllInvoices();
    const websites = await this.repo.getWebsitesByIds(websiteIdsToFetchFor);
    if (websites.error) return [websites];
    const result = await this.runSequentially(websites.map(
      (ws) => async () => {
        this.win.webContents.send('onFetchWsChange', {
          msg: 'loadingWebsite',
          wsName: ws.name,
          percent: null,
        });
        const invoices = await this.fetchInvoicesForWs(ws, filters);
        this.win.webContents.send('onNotification', {
          msg: 'fetchingInvoicesFromWebsiteCompleted',
          wsName: ws.name,
          type: 'success',
        });
        return invoices;
      },
    ));
    return Promise.all(result.map(
      async (wsResult) => {
        if (wsResult.error) return wsResult;
        return this.handleFetchResults(wsResult);
      },
    ));
  }

  /**
   * @private
   * @param {{ _id: String, name: String, url: String }} ws
   * @param {{ from: String, to: String }} filters
   * @return {Promise<{date: *, download: *, website: *, description: *}[]|{error: String}|*|*[]>}
   */
  async fetchInvoicesForWs(ws, filters) {
    let providerName = '';
    try {
      const Provider = this.providers.get(ws.url);
      if (!Provider) {
        this.win.webContents.send('onNotification', { msg: 'websiteIsNotSupported', type: 'error' });
        return [];
      }
      const settings = await this.repo.getSettings();
      const page = await this.browser.getPage();
      const ctx = {
        ws, page, win: this.win, settings, filters, logger: this.logger,
      };
      const provider = new Provider(ctx);
      providerName = `${provider.name} - ${ws.name}`;
      this.logger.info(providerName, 'Starting...');
      if (provider.requires2FA) {
        const fetch = await provider.authenticate();
        if (provider.authDone) {
          await this.handleFetchSuccess(ws);
          return await fetch('');
        // eslint-disable-next-line no-else-return
        } else if (provider.requiresSecurityQuestion) {
          const code = await this.get2FAInput(ws.name, ws._id, provider.securityQuestion);
          return await fetch(code);
        }
        const code = await this.get2FAInput(ws.name, ws._id);
        return await fetch(code);
      }
      const result = await provider.fetch();
      await this.handleFetchSuccess(ws);
      return result;
    } catch (err) {
      await this.handleFetchError(ws, err);
      return [];
    } finally {
      this.logger.info(providerName, 'Finished...');
    }
  }

  /**
   * @private
   * @param {Object[]} wsResult
   */
  async handleFetchResults(wsResult) {
    return Promise.all(wsResult.map(
      async (item) => {
        const invoice = await this.repo.createInvoice({
          description: item.description,
          date: item.date || null,
          wsName: item.wsName,
          fileName: item.fileName,
        });
        if (invoice.error) return invoice;
        // eslint-disable-next-line no-underscore-dangle
        this.availableDownloads.push({ download: item.download, id: invoice._id });
        return invoice;
      },
    ));
  }

  /**
   * @private
   * @param {Object} [invoice]
   * @param {String} [invoice.description]
   * @param {String} [invoice.date]
   * @param {String} [invoice.wsName]
   * @param {String} [invoice.fileName]
   * @param {String} lang
   * @return {Promise<String>}
   */
  async getDownloadPath(invoice, lang) {
    const settings = await this.repo.getSettings();
    const date = invoice.date ? this.normalizer.normalizeDate(lang, invoice.date) : '';
    const fileName = settings.format
      .replace('[suggested-filename]', invoice.fileName.replace('.pdf', ''))
      .replace('[description]', invoice.description)
      .replace('[date]', date)
      .replace('[website-name]', invoice.wsName);
    return `${this.electron.app.getPath('documents')}/VerzamelSysteem/${fileName}.pdf`;
  }

  /**
   * @private
   * @param {Object} ctx
   * @param {String} ctx.id
   * @param {String} ctx.lang
   * @return {Promise<{success: boolean}|{error}|Object|{error: string}>}
   */
  async downloadInvoice({ id, lang }) {
    const downloadObj = this.availableDownloads.find((item) => item.id === id);
    const invoice = await this.repo.getInvoiceById(id);
    if (invoice.error) return invoice;
    if (!downloadObj) return { error: 'downloadIsNotAvailable' };
    const downloadPath = await this.getDownloadPath(invoice, lang);
    await downloadObj.download.saveAs(downloadPath);
    return { success: true };
  }

  async getInvoicePathForMail(id) {
    const downloadObj = this.availableDownloads.find((item) => item.id === id);
    const invoice = await this.repo.getInvoiceById(id);
    if (invoice.error) return invoice;
    if (!downloadObj) return { error: 'downloadIsNotAvailable' };
    if (downloadObj.download.buffer) {
      return {
        filename: invoice.fileName.endsWith('.pdf') ? `${invoice.wsName} - ${invoice.fileName}` : `${invoice.wsName} - ${invoice.fileName}.pdf`,
        content: downloadObj.download.buffer,
      };
    }
    return {
      filename: invoice.fileName.endsWith('.pdf') ? `${invoice.wsName} - ${invoice.fileName}` : `${invoice.wsName} - ${invoice.fileName}.pdf`,
      path: await downloadObj.download.path(),
    };
  }

  /**
   * @private
   * @param {String} name
   * @param {String} id
   * @return {Promise<String>}
   */
  async get2FAInput(name, id, question = false) {
    this.win.webContents.send('on2FA', { name, id, question });
    return new Promise((resolve) => {
      this.twoFAWaitingList.set(id, resolve);
    });
  }

  /**
   * @private
   * @param {Object} payload
   * @param {String} payload.id
   * @param {String} payload.code
   * @return {Promise<void>}
   */
  async resolve2FAInput({ id, code }) {
    const resolve = this.twoFAWaitingList.get(id);
    if (resolve) {
      resolve(code);
      this.twoFAWaitingList.delete(id);
    }
  }

  /**
   * @private
   * @param {String} key
   * @return {Promise<Object>}
   */
  async getOAuthCredentials(key) {
    const OAuth = this.oauth.get(key);
    const oauth = new OAuth(this.electron, this.win);
    return oauth.getCredentials();
  }

  /**
   * @private
   * @return {Promise<Awaited<boolean>[]>}
   */
  async ensureCredentialsSecured() {
    const websites = await this.repo.getAllWebsites();
    return Promise.all(websites.map(
      async (ws) => {
        if (!ws.secured) {
          await this.repo.updateWebsite(ws);
        }
        return true;
      },
    ));
  }

  /**
   * @private
   * @param {{ _id: String, name: String }} ws
   * @return {Promise<void>}
   */
  async handleFetchSuccess(ws) {
    await this.repo.unsetWebsiteAuthFailed(ws._id);
    await this.repo.unsetWebsiteFetchFailed(ws._id);
  }

  /**
   * @private
   * @param {{ _id: String, name: String }} ws
   * @param {Error} err
   * @return {Promise<void>}
   */
  async handleFetchError(ws, err) {
    if (err.message === 'authenticationFailed') {
      await this.repo.setWebsiteAuthFailed(ws._id);
    } else {
      await this.repo.setWebsiteFetchFailed(ws._id);
    }
    this.win.webContents.send('onNotification', { msg: err.message, wsName: ws.name, type: 'error' });
  }

  /**
   * @private
   * @return {void}
   */
  setupUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.setFeedURL({
      provider: 'spaces',
      name: 'verzamel-systeem-updates',
      region: 'ams3',
      acl: 'public-read',
    });
    autoUpdater.on('checking-for-update', (info) => {
      this.win.webContents.send('onUpdateCheck', info);
    });
    autoUpdater.on('update-available', (info) => {
      this.win.webContents.send('onUpdateAvailable', info);
    });
    autoUpdater.on('update-not-available', (info) => {
      this.win.webContents.send('onUpdateNotAvailable', info);
    });
    autoUpdater.on('error', (err) => {
      this.win.webContents.send('onUpdateError', err);
    });
    autoUpdater.on('download-progress', (progressObj) => {
      this.win.webContents.send('onUpdateDownloadProgress', progressObj);
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.win.webContents.send('onUpdateDownloaded', info);
    });
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async checkForUpdates() {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.win.webContents.send('onUpdateError', err);
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async sendMail({
    settings, attachment, total, index, type,
  }) {
    try {
      const transporter = nodemailer.createTransport({
        host: settings.smtpServer,
        port: Number(settings.smtpPort),
        secure: settings.smtpSsl,
        auth: settings.smtpAuth ? {
          user: settings.smtpUsername,
          pass: settings.smtpPassword,
        } : false,
      });

      if (type !== 1) {
        this.win.webContents.send('onFetchWsChange', {
          msg: 'testingSMTP',
        });
        const mailOptions = {
          from: `VerzamelSysteem ${settings.smtpUsername}`,
          to: settings.smtpEmail,
          subject: attachment.title,
          html: attachment.text,
        };

        return new Promise((resolve, reject) => {
          transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
              this.win.webContents.send('onNotification', { msg: err.code, type: 'error' });
              reject(err);
            } else {
              this.win.webContents.send('onNotification', { msg: 'connSuccessSMTP', type: 'success' });
              resolve(info);
            }
          });
        });
      }
      const fileName = attachment[0].filename;
      const mailOptions = {
        from: `VerzamelSysteem ${settings.smtpUsername}`,
        to: settings.smtpEmail,
        subject: fileName.substring(0, fileName.length - 4),
        attachments: attachment,
      };
      const percent = Math.round(((index + 1) / total) * 100);

      return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            reject(err);
          } else {
            this.win.webContents.send('onFetchWsChange', {
              msg: 'sendingMail',
              percent,
            });
            resolve(info);
          }
        });
      });
    } catch (err) {
      throw new Error(err);
    }
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async downloadUpdate() {
    try {
      await autoUpdater.downloadUpdate();
      await autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      this.win.webContents.send('onUpdateError', err);
    }
  }

  /**
  * @private
  * @return {Promise<boolean>}
  */
  async getLicenseStatus() {
    await this.win.setTitle('VerzamelSysteem');
    const username = 'ck_4fe0b41c586850aa7cc607a32ac4f5e3337f717a';
    const password = 'cs_1712ce2e98ade80d10d4353618f8246eb5da9ae3';
    const clientID = 'ck_5128866fcf80afe0b00340cd091d021d6de8e086';
    const clientSecret = 'cs_b977d75c4c48d0af83253d15a444ab1403a8de47';
    const returnValue = [];
    try {
      const { licenseKey } = await this.repo.getSettings();
      const response = await fetch(`https://verzamelsysteem.nl/wp-json/lmfwc/v2/licenses/activate/${licenseKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Base64.encode(`${username}:${password}`)}`,
        },
      });
      if (response.status === 200) {
        const license = await response.json();
        console.log('License Status from main process:');
        console.log(license);
        const excludedProductIds = [1565, 1566, 712, 292];
        if (license.data.productId && !excludedProductIds.includes(license.data.productId)) {
          const checkProduct = await fetch(`https://verzamelsysteem.nl/wp-json/wc/v1/products/${license.data.productId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${Base64.encode(`${clientID}:${clientSecret}`)}`,
            },
          });
          if (checkProduct.status === 200) {
            const productDetails = await checkProduct.json();
            this.win.setTitle(productDetails.name);
            returnValue.push(productDetails.images[0].src);
          } else {
            returnValue.push(null);
          }
        } else {
          returnValue.push(null);
          this.win.setTitle('VerzamelSysteem');
        }

        const status = license.success ? license.data.status : 0;
        if (status === 1 || status === 2 || status === 3) {
          returnValue.push(true);
          return returnValue;
        } if (status === 4) {
          returnValue.push(false);
          return returnValue;
        }
      }
      returnValue.push(false);
      return returnValue;
    } catch (e) {
      this.win.setTitle('VerzamelSysteem');
      returnValue.push(null);
      returnValue.push(false);
      return returnValue;
    }
  }

  /**
   * @private
   * @return {Promise<string>}
   */
  async getCurrentVersion() {
    return autoUpdater.currentVersion.format();
  }

  /**
   * @private
   * @return {Promise<void>}
   */
  async ensureDocumentsDir() {
    try {
      return fs.mkdirSync(`${this.electron.app.getPath('documents')}/VerzamelSysteem`);
    } catch (err) {
      if (!err.message.includes('EEXIST')) {
        const msg = 'failedToCreateOutputDir';
        this.win.webContents.send('onNotification', { msg, type: 'error' });
      }
      return Promise.resolve();
    }
  }

  /**
   * @public
   * @return {Promise<void>}
   */
  async bootstrap() {
    await this.electron.app.whenReady();
    this.handleEvents();
    this.setupIpc();
    this.setupUpdater();
    await this.initSettings();
    await this.initLogger();
    await this.ensureCredentialsSecured();
    await this.createWindow();
  }
}

module.exports = MainProcess;
