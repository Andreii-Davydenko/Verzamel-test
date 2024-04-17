class App extends React.Component {
  constructor(props) {
    super(props);
    this.switchView = this.switchView.bind(this);
    this.setWebsites = this.setWebsites.bind(this);
    this.fetchWebsites = this.fetchWebsites.bind(this);
    this.setLogoAndScraperAvailable = this.setLogoAndScraperAvailable.bind(this);
    this.setLoading = this.setLoading.bind(this);
    this.setInvoices = this.setInvoices.bind(this);
    this.setCheckedKeys = this.setCheckedKeys.bind(this);
    this.updateDownloaded = this.updateDownloaded.bind(this);
    this.selectUnDownloadedInvoices = this.selectUnDownloadedInvoices.bind(this);
    this.emptyInvoiceSelectionList = this.emptyInvoiceSelectionList.bind(this);
    this.selectUnEmailedInvoices = this.selectUnEmailedInvoices.bind(this);
    this.resetDownloadedList = this.resetDownloadedList.bind(this);
    this.resetEmailedList = this.resetEmailedList.bind(this);
    this.updateCheckedWebSites = this.updateCheckedWebSites.bind(this);
    this.deleteSelectedInvoices = this.deleteSelectedInvoices.bind(this);
    this.downloadSelectedInvoices = this.downloadSelectedInvoices.bind(this);
    this.mailInvoices = this.mailInvoices.bind(this);
    this.setFormat = this.setFormat.bind(this);
    this.setDateFormat = this.setDateFormat.bind(this);
    this.setDebugMode = this.setDebugMode.bind(this);
    this.setSmtpUsername = this.setSmtpUsername.bind(this);
    this.setSmtpPassword = this.setSmtpPassword.bind(this);
    this.setSmtpEmail = this.setSmtpEmail.bind(this);
    this.setSmtpServer = this.setSmtpServer.bind(this);
    this.setSmtpPort = this.setSmtpPort.bind(this);
    this.setSmtpAuth = this.setSmtpAuth.bind(this);
    this.setSmtpSsl = this.setSmtpSsl.bind(this);
    this.setLicenseKey = this.setLicenseKey.bind(this);
    this.setLicenseStatus = this.setLicenseStatus.bind(this);
    this.fetchLicenseStatus = this.fetchLicenseStatus.bind(this);
    this.setSettings = this.setSettings.bind(this);
    this.open2FA = this.open2FA.bind(this);
    this.close2FA = this.close2FA.bind(this);
    this.setCurrentWs = this.setCurrentWs.bind(this);
    this.setLogo = this.setLogo.bind(this);
    this.openUpdate = this.openUpdate.bind(this);
    this.closeUpdate = this.closeUpdate.bind(this);
    this.setColumnWidth = this.setColumnWidth.bind(this);
    this.adjustTableWidth = this.adjustTableWidth.bind(this);
    this.reviewAvailableWidth = this.reviewAvailableWidth.bind(this);
    this.editWebsite = this.editWebsite.bind(this);
    this.closeEditWebsiteModal = this.closeEditWebsiteModal.bind(this);

    this.websiteColumnRatio = {
      name: 5 / 20,
      url: 12 / 20,
      actionWebsite: 3 / 20,
    };

    this.invoiceColumnRatio = {
      description: 4 / 22,
      fileName: 3 / 22,
      date: 3 / 22,
      wsName: 4 / 22,
      downloaded: 2 / 22,
      emailed: 2 / 22,
      actionInvoice: 1 / 22,
    };
    this.reviewAvailableWidth();
    this.state = {
      isLoading: false,
      currentView: 'WEBSITES',
      scraperAvailable: false,
      websites: [],
      invoices: [],
      settings: [],
      checkedKeys: [],
      format: '',
      dateFormat: '',
      debugMode: false,
      smtpUsername: '',
      smtpPassword: '',
      smtpServer: '',
      smtpPort: '',
      smtpSsl: false,
      smtpAuth: false,
      smtpEmail: '',
      licenseKey: '',
      licenseStatus: null,
      twoFAOpen: false,
      twoFAName: '',
      SQ: '',
      twoFAId: '',
      currentWs: { msg: '', wsName: '', percent: null },
      version: '',
      updateOpen: false,
      updateAvailable: false,
      columnWidth: {
        description: this.widthSpaceLeft * this.invoiceColumnRatio.description,
        fileName: this.widthSpaceLeft * this.invoiceColumnRatio.fileName,
        date: this.widthSpaceLeft * this.invoiceColumnRatio.date,
        wsName: this.widthSpaceLeft * this.invoiceColumnRatio.wsName,
        downloaded: this.widthSpaceLeft * this.invoiceColumnRatio.downloaded,
        emailed: this.widthSpaceLeft * this.invoiceColumnRatio.emailed,
        actionInvoice: this.widthSpaceLeft * this.invoiceColumnRatio.actionInvoice,
        name: this.widthSpaceLeft * this.websiteColumnRatio.name,
        url: this.widthSpaceLeft * this.websiteColumnRatio.url,
        actionWebsite: this.widthSpaceLeft * this.websiteColumnRatio.actionWebsite,
      },
      fetchCount: 0,
      appLogo: null,
      websiteToEdit: null,
      checkedWebSites: {},
      emailed: {},
      downloaded: {},
      invoiceDetailMap: {},
    };
  }

  open2FA(name, id, question) {
    this.setState({
      ...this.state,
      twoFAOpen: true,
      twoFAName: name,
      twoFAId: id,
      SQ: question,
    });
  }

  close2FA() {
    this.setState({
      ...this.state,
      twoFAOpen: false,
      twoFAName: '',
      SQ: '',
      twoFAId: '',
    });
  }

  openUpdate(version, updateAvailable) {
    this.setState({
      ...this.state,
      updateOpen: true,
      updateAvailable,
      version,
    });
  }

  closeUpdate() {
    this.setState({
      ...this.state,
      updateOpen: false,
      updateAvailable: false,
      version: '',
    });
  }

  switchView(view) {
    this.setState({ ...this.state, currentView: view });
  }

  setWebsites(websites) {
    const localCheckedWebSites = {};
    const exactCheckedWebSites = { ...this.state.checkedWebSites };
    const checkedWebSitesKeys = Object.keys(exactCheckedWebSites);
    const hasSomeCheckedWebsites = !!checkedWebSitesKeys.length;
    (websites || []).forEach(({ _id }) => {
      localCheckedWebSites[_id] = 1;
    });
    if (hasSomeCheckedWebsites) {
      (checkedWebSitesKeys || []).forEach((currentKey) => {
        if (!(localCheckedWebSites[currentKey] === 1)) {
          delete exactCheckedWebSites[currentKey];
        }
      });
    }
    this.setState({
      ...this.state,
      checkedWebSites: hasSomeCheckedWebsites
        ? exactCheckedWebSites
        : localCheckedWebSites,
      websites,
    });
  }

  updateCheckedWebSites(checkedWebSites) {
    this.setState({ ...this.state, checkedWebSites });
  }

  async setInvoices(invoices) {
    const newerTimeStamp = Date.now();
    const localEmailed = {};
    const localDownloaded = {};
    const localInvoices = [];
    const invoiceDetailMapUpdate = {};

    (invoices || []).forEach((invoice) => {
      const { wsName, fileName, _id } = invoice || {};
      const combination = `${wsName}__COM__BI__${fileName}`;
      if (!!invoice && !invoiceDetailMapUpdate[combination]) {
        invoiceDetailMapUpdate[combination] = _id;
        invoiceDetailMapUpdate[_id] = combination;
        localInvoices.push(invoice);
      }
    });
    const emailedInvoices = await window.ipc.getAllEmailedInvoices();
    (emailedInvoices || []).forEach(({
      combination,
      // emailedOn,
    }) => {
      if (invoiceDetailMapUpdate[combination]) {
        localEmailed[invoiceDetailMapUpdate[combination]] = 1;
      }
    });
    const downloadedInvoices = await window.ipc.getAllDownloadedInvoices();
    (downloadedInvoices || []).forEach(({
      combination,
      // downloadedOn,
    }) => {
      if (invoiceDetailMapUpdate[combination]) {
        localDownloaded[invoiceDetailMapUpdate[combination]] = 1;
      }
    });

    const dataToUpdate = {
      ...this.state,
      isLoading: false,
      currentView: 'INVOICES',
      checkedKeys: [],
      currentWs: { msg: '', percent: null },
      invoices: localInvoices,
      invoiceDetailMap: {
        // ...this.state.invoiceDetailMap,
        ...invoiceDetailMapUpdate,
      },
      emailed: localEmailed,
      downloaded: localDownloaded,
      newerTimeStamp,
    };
    this.setState(dataToUpdate);
    const theIntervalOfRetry = setInterval(() => {
      if (!(this.state.newerTimeStamp === newerTimeStamp) || this.state.isLoading) {
        this.setState(dataToUpdate);
      } else {
        clearInterval(theIntervalOfRetry);
      }
    }, 600);
  }

  updateDownloaded(id) {
    this.setState({
      ...this.state,
      downloaded: {
        ...this.state.downloaded,
        [id]: 1,
      },
    });
    if (typeof this.state.invoiceDetailMap[id] === 'string') {
      window.ipc.insertDownloadedInvoice(this.state.invoiceDetailMap[id]);
    }
  }

  async resetDownloadedList() {
    const { t } = this.props;
    this.setState({
      ...this.state,
      downloaded: {},
    });
    window.ipc.deleteAllDownloadedInvoices();
    return window.getNotification(t('downlodedInvoiceResetComplete'), 'success');
  }

  async resetEmailedList() {
    const { t } = this.props;
    this.setState({
      ...this.state,
      emailed: {},
    });
    window.ipc.deleteAllEmailedInvoices();
    return window.getNotification(t('emailedInvoiceResetComplete'), 'success');
  }

  async emptyInvoiceSelectionList() {
    const {
      t,
    } = this.props;
    this.setState({
      ...this.state,
      checkedKeys: [],
    });
    return window.getNotification(t('selectionListIsNowEmpty'), 'success');
  }

  async selectUnDownloadedInvoices() {
    const {
      t,
    } = this.props;
    this.setState({
      ...this.state,
      checkedKeys: this.state.invoices
        .reduce((initial, item) => {
          if (
            !(
              this
                .state
                .downloaded[item._id] === 1)
          ) {
            initial.push(item._id);
          }
          return initial;
        }, []),
    });
    return window.getNotification(t('allUnDownloadedSelected'), 'success');
  }

  async selectUnEmailedInvoices() {
    const {
      t,
    } = this.props;
    this.setState({
      ...this.state,
      checkedKeys: this.state.invoices
        .reduce((initial, item) => {
          if (
            !(
              this
                .state
                .emailed[item._id] === 1)
          ) {
            initial.push(item._id);
          }
          return initial;
        }, []),
    });
    return window.getNotification(t('allUnEmailedSelected'), 'success');
  }

  async setLogoAndScraperAvailable(scraperStatus, logo) {
    this.setState({
      ...this.state,
      scraperAvailable: scraperStatus,
      appLogo: logo,
    });
  }

  async setLogo(state) {
    this.setState({ ...this.state, appLogo: state }, (e) => e);
  }

  setLoading(isLoading) {
    this.setState({ ...this.state, isLoading });
  }

  setCheckedKeys(checkedKeys) {
    this.setState({ ...this.state, checkedKeys });
  }

  setFormat(format) {
    this.setState({ ...this.state, format });
  }

  setDateFormat(dateFormat) {
    this.setState({ ...this.state, dateFormat });
  }

  setDebugMode(debugMode) {
    this.setState({ ...this.state, debugMode });
  }

  setSmtpUsername(smtpUsername) {
    this.setState({ ...this.state, smtpUsername });
  }

  setSmtpPassword(smtpPassword) {
    this.setState({ ...this.state, smtpPassword });
  }

  setSmtpEmail(smtpEmail) {
    this.setState({ ...this.state, smtpEmail });
  }

  setSmtpServer(smtpServer) {
    this.setState({ ...this.state, smtpServer });
  }

  setSmtpAuth(smtpAuth) {
    this.setState({ ...this.state, smtpAuth });
  }

  setSmtpPort(smtpPort) {
    this.setState({ ...this.state, smtpPort });
  }

  setSmtpSsl(smtpSsl) {
    this.setState({ ...this.state, smtpSsl });
  }

  setLicenseKey(licenseKey) {
    this.setState({ ...this.state, licenseKey });
  }

  setLicenseStatus(licenseStatus) {
    this.setState({ ...this.state, licenseStatus });
  }

  async setSettings({
    // eslint-disable-next-line max-len
    format,
    dateFormat,
    debugMode,
    licenseKey,
    smtpUsername,
    smtpPassword,
    smtpEmail,
    smtpServer,
    smtpPort,
    smtpAuth,
    smtpSsl,
  }) {
    this.setState({
      // eslint-disable-next-line max-len
      ...this.state,
      format,
      dateFormat,
      debugMode,
      smtpUsername,
      smtpPassword,
      smtpEmail,
      smtpServer,
      smtpPort,
      smtpAuth,
      smtpSsl,
      licenseKey,
    });
  }

  setCurrentWs(currentWs) {
    this.setState({ ...this.state, currentWs });
  }

  async fetchWebsites() {
    const data = await window.ipc.getAllWebsites();
    this.setWebsites(data);
  }

  closeEditWebsiteModal() {
    this.setState({ ...this.state, websiteToEdit: null });
    this.fetchWebsites();
  }

  async editWebsite(websiteToEdit) {
    this.setState({ ...this.state, websiteToEdit });
  }

  async fetchSettings() {
    const settings = await window.ipc.getSettings();
    this.setSettings(settings);
  }

  async fetchLicenseStatus() {
    const licenseStatus = await window.ipc.getLicenseStatus();
    this.setLicenseStatus(licenseStatus[1]);
    await this.setLogoAndScraperAvailable(licenseStatus[1], licenseStatus[0]);
    return licenseStatus;
  }

  async initScraper() {
    const result = await window.ipc.initBrowser();
    if (result.error) {
      window.getNotification(result.error, 'error');
    } else {
      this.setLogoAndScraperAvailable(false);
    }
  }

  async componentDidMount() {
    const { t } = this.props;
    window.addEventListener('resize', this.adjustTableWidth);
    window.ipc.on2FA((event, { name, id, question }) => {
      this.open2FA(name, id, question);
    });
    window.ipc.onFetchWsChange((event, wsFetchState) => {
      this.setCurrentWs(wsFetchState);
    });
    window.ipc.onNotification((event, { msg, type, wsName }) => {
      const message = wsName ? t(msg, { wsName }) : t(msg);
      window.getNotification(message, type);
    });
    window.ipc.onUpdateAvailable((event, updateInfo) => {
      this.openUpdate(updateInfo.version, true);
    });
    window.ipc.onUpdateError((event, err) => {
      window.getNotification(err.message);
    });
    await this.fetchWebsites();
    await this.initScraper();
    await this.fetchSettings();
    await window.ipc.deleteAllInvoices();
    await window.ipc.ensureDocumentsDir();
    await window.ipc.checkForUpdates();
    await this.fetchLicenseStatus();
  }

  renderCurrentView(
    h,
    websiteIdsToFetchFor,
  ) {
    const { t, i18n } = this.props;
    switch (this.state.currentView) {
      case 'WEBSITES':
        return h(window.Websites, {
          websiteIdsToFetchFor,
          checkedWebSites: this.state.checkedWebSites,
          updateCheckedWebSites: this.updateCheckedWebSites,
          websites: this.state.websites,
          fetchWebsites: this.fetchWebsites,
          columnWidth: this.state.columnWidth,
          setColumnWidth: this.setColumnWidth,
          editWebsite: this.editWebsite,
          t,
        });
      case 'INVOICES':
        return h(window.Invoices, {
          invoices: this.state.invoices,
          dateFormat: this.state.dateFormat,
          setInvoices: this.setInvoices,
          checkedKeys: this.state.checkedKeys,
          downloaded: this.state.downloaded,
          updateDownloaded: this.updateDownloaded,
          emailed: this.state.emailed,
          setCheckedKeys: this.setCheckedKeys,
          columnWidth: this.state.columnWidth,
          setColumnWidth: this.setColumnWidth,
          i18n,
          t,
        });
      case 'SETTINGS':
        return h(window.Settings, {
          format: this.state.format,
          dateFormat: this.state.dateFormat,
          debugMode: this.state.debugMode,
          smtpUsername: this.state.smtpUsername,
          smtpPassword: this.state.smtpPassword,
          smtpEmail: this.state.smtpEmail,
          smtpServer: this.state.smtpServer,
          smtpPort: this.state.smtpPort,
          smtpSsl: this.state.smtpSsl,
          smtpAuth: this.state.smtpAuth,
          licenseKey: this.state.licenseKey,
          licenseStatus: this.state.licenseStatus,
          appLogo: this.state.appLogo,
          setLoading: this.setLoading,
          setFormat: this.setFormat,
          setDateFormat: this.setDateFormat,
          setDebugMode: this.setDebugMode,
          resetDownloadedList: this.resetDownloadedList,
          resetEmailedList: this.resetEmailedList,
          setSmtpUsername: this.setSmtpUsername,
          setSmtpPassword: this.setSmtpPassword,
          setSmtpEmail: this.setSmtpEmail,
          setSmtpServer: this.setSmtpServer,
          setSmtpAuth: this.setSmtpAuth,
          setSmtpPort: this.setSmtpPort,
          setSmtpSsl: this.setSmtpSsl,
          setLicenseKey: this.setLicenseKey,
          setLicenseStatus: this.setLicenseStatus,
          fetchLicenseStatus: this.fetchLicenseStatus,
          setLogoAndScraperAvailable: this.setLogoAndScraperAvailable,
          openUpdate: this.openUpdate,
          setLogo: this.setLogo,
          t,
        });
      default:
        return h(window.Websites, {
          websites: this.state.websites,
          fetchWebsites: this.fetchWebsites,
          t,
        });
    }
  }

  async deleteSelectedInvoices() {
    const { t } = this.props;
    if (this.state.checkedKeys.length < 1) {
      return window.getNotification(t('noInvoicesSelected'));
    }
    const result = await window.ipc.deleteSelectedInvoices(
      this.state.checkedKeys,
    );
    if (result.error) {
      window.getNotification(result.error);
    }
    const invoices = await window.ipc.getAllInvoices();
    return this.setInvoices(invoices);
  }

  async downloadSelectedInvoices() {
    const { t } = this.props;
    const { i18n } = this.props;
    if (this.state.checkedKeys.length < 1) {
      return window.getNotification(t('noInvoicesSelected'));
    }
    const downloadedOnSuccess = {};
    let someDownloadsFailed = false;
    await Promise.all(this.state.checkedKeys.map(
      async (id) => {
        const response = await window.ipc.downloadInvoice({ id, lang: i18n.language });
        if (!!response && !!response.success) {
          downloadedOnSuccess[id] = 1;
        } else {
          someDownloadsFailed = true;
        }
      },
    ));
    this.setState({
      ...this.state,
      downloaded: {
        ...this.state.downloaded,
        ...downloadedOnSuccess,
      },
    });

    Object.keys(downloadedOnSuccess).forEach((id) => {
      if (typeof this.state.invoiceDetailMap[id] === 'string') {
        try {
          window.ipc.insertDownloadedInvoice(this.state.invoiceDetailMap[id]);
        } catch (error) {
          // We know that some may fail due to duplicate in db and it is totally fine
        }
      }
    });
    if (someDownloadsFailed) {
      return window.getNotification(t('downloadCompleteWithErrors'));
    }
    return window.getNotification(t('allSelectedInvoicesDownloaded'), 'success');
  }

  async mailInvoices() {
    const { t } = this.props;
    if (this.state.checkedKeys.length < 1) {
      return window.getNotification(t('noInvoicesSelected'));
    }
    const mailedOnSuccess = {};
    const settings = await window.ipc.getSettings();
    const result = await Promise.all(this.state.checkedKeys.map(
      async (id) => {
        mailedOnSuccess[id] = 1;
        return window.ipc.getInvoicePathForMail(id);
      },
    ));
    this.setState({
      ...this.state,
      isLoading: true,
    });
    let errorOccurred = false;
    // eslint-disable-next-line no-plusplus
    for (let index = 0; index < result.length; index++) {
      const data = result[index];

      try {
        await window.ipc.sendMail({
          settings,
          attachment: [data],
          total: result.length,
          index,
          type: 1,
        });
      } catch (err) {
        errorOccurred = true;
      }
    }
    this.setState({
      ...this.state,
      isLoading: false,
      emailed: errorOccurred
        ? this.state.emailed : {
          ...this.state.emailed,
          ...mailedOnSuccess,
        },
    });
    Object.keys(mailedOnSuccess).forEach((id) => {
      if (typeof this.state.invoiceDetailMap[id] === 'string') {
        try {
          window.ipc.insertEmailedInvoice(this.state.invoiceDetailMap[id]);
        } catch (error) {
          // We know that some may fail due to duplicate in db and it is totally fine
        }
      }
    });
    if (!errorOccurred) {
      return window.getNotification(t('emailSent'), 'success');
    }
    return window.getNotification(t('emailNotSent'), 'error');
  }

  setColumnWidth(width, key) {
    this.setState({
      ...this.state,
      columnWidth: {
        ...this.state.columnWidth,
        [key]: width,
      },
    });
  }

  reviewAvailableWidth() {
    this.widthSpaceLeft = document.body.clientWidth > 785
      ? document.body.clientWidth - 250
      : document.body.clientWidth - 290;
  }

  adjustTableWidth() {
    this.reviewAvailableWidth();
    const name = this.widthSpaceLeft * this.websiteColumnRatio.name;
    const url = this.widthSpaceLeft * this.websiteColumnRatio.url;
    const actionWebsite = this.widthSpaceLeft * this.websiteColumnRatio.actionWebsite;

    const description = this.widthSpaceLeft * this.invoiceColumnRatio.description;
    const fileName = this.widthSpaceLeft * this.invoiceColumnRatio.fileName;
    const date = this.widthSpaceLeft * this.invoiceColumnRatio.date;
    const wsName = this.widthSpaceLeft * this.invoiceColumnRatio.wsName;
    const downloaded = this.widthSpaceLeft * this.invoiceColumnRatio.downloaded;
    const emailed = this.widthSpaceLeft * this.invoiceColumnRatio.emailed;
    const actionInvoice = this.widthSpaceLeft * this.invoiceColumnRatio.actionInvoice;

    this.setState({
      ...this.state,
      columnWidth: {
        ...this.state.columnWidth,
        name,
        description,
        fileName,
        date,
        wsName,
        downloaded,
        emailed,
        actionInvoice,
        url,
        actionWebsite,
      },
    });
  }

  render() {
    const h = React.createElement;
    const { t, i18n } = this.props;
    const { checkedWebSites } = this.state;
    const { Container, Loader, Progress } = rsuite;
    const websiteIdsToFetchFor = Object.keys(checkedWebSites);
    return h(Container, null, [
      this.state.websiteToEdit ? h(window.EditWebsite, {
        website: this.state.websiteToEdit,
        closeEditWebsiteModal: this.closeEditWebsiteModal,
        t,
      }) : null,
      h(window.Handle2fa, {
        name: this.state.twoFAName,
        id: this.state.twoFAId,
        question: this.state.SQ,
        open: this.state.twoFAOpen,
        onClose: this.close2FA,
        t,
      }),
      h(window.HandleUpdate, {
        version: this.state.version,
        open: this.state.updateOpen,
        onClose: this.closeUpdate,
        available: this.state.updateAvailable,
        t,
      }),
      h(window.Controls, {
        websiteIdsToFetchFor,
        switchView: this.switchView,
        fetchWebsites: this.fetchWebsites,
        currentView: this.state.currentView,
        setLoading: this.setLoading,
        setInvoices: this.setInvoices,
        deleteSelectedInvoices: this.deleteSelectedInvoices,
        downloadSelectedInvoices: this.downloadSelectedInvoices,
        selectUnDownloadedInvoices: this.selectUnDownloadedInvoices,
        emptyInvoiceSelectionList: this.emptyInvoiceSelectionList,
        selectUnEmailedInvoices: this.selectUnEmailedInvoices,
        mailInvoices: this.mailInvoices,
        format: this.state.format,
        dateFormat: this.state.dateFormat,
        debugMode: this.state.debugMode,
        smtpUsername: this.state.smtpUsername,
        smtpPassword: this.state.smtpPassword,
        smtpEmail: this.state.smtpEmail,
        smtpServer: this.state.smtpServer,
        smtpPort: this.state.smtpPort,
        smtpSsl: this.state.smtpSsl,
        smtpAuth: this.state.smtpAuth,
        licenseKey: this.state.licenseKey,
        licenseStatus: this.state.licenseStatus,
        changeLanguage: i18n.changeLanguage,
        scraperAvailable: this.state.scraperAvailable,
        fetchLicenseStatus: this.fetchLicenseStatus,
        t,
      }),
      h(Container, null, [
        h(window.Navigation, {
          switchView: this.switchView,
          currentView: this.state.currentView,
          logo: this.state.appLogo,
          t,
        }),
        h(Container, { className: 'app-content' }, [
          this.renderCurrentView(
            h,
            websiteIdsToFetchFor,
          ),
          this.state.isLoading
            && h(Loader, {
              size: 'md',
              backdrop: true,
              vertical: true,
              content: [
                t(this.state.currentWs.msg, {
                  wsName: this.state.currentWs.wsName,
                }) || t('loading'),
                this.state.currentWs.percent
                && h(Progress.Line, {
                  percent: this.state.currentWs.percent || 0,
                }),
              ],
            }),
        ]),
      ]),
    ]);
  }
}

function getNotification(msg, type = 'warning') {
  const { toaster } = rsuite;
  const component = React.createElement(
    rsuite.Message,
    {
      showIcon: true,
      type,
      closable: true,
    },
    msg,
  );
  return toaster.push(component, {
    placement: 'bottomCenter',
    duration: 10000,
  });
}

dayjs.extend(dayjsCustomParseFormat);

window.getNotification = getNotification;
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(ReactI18next.withTranslation()(App), null));
