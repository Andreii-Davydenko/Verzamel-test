class Settings extends React.Component {
  state = {
    isLookingForUpdates: false,
    licenseKey: '',
    currentVersion: '',
    activeForm: 'general',
    isChecked: false,
  };

  constructor(props) {
    super(props);
    this.getDateFormatOptions = this.getDateFormatOptions.bind(this);
    this.checkForUpdates = this.checkForUpdates.bind(this);
    this.setLicenseStatus = this.setLicenseStatus.bind(this);
    this.setCurrentVersion = this.setCurrentVersion.bind(this);
  }

  checkForUpdates() {
    this.setState({ ...this.state, isLookingForUpdates: true });
    window.ipc.checkForUpdates();
  }

  async saveLicense() {
    this.props.setLogo(null);
    const { t } = this.props;
    const settings = await window.ipc.getSettings();
    await window.ipc.saveSettings({
      ...settings,
      licenseKey: this.props.licenseKey,
    });
    const status = await this.props.fetchLicenseStatus();
    await this.props.setLogoAndScraperAvailable(status[1], status[0]);
    if (status.error) {
      window.getNotification(t('licenseKeyInvalid'));
    }
    if (!status[1]) {
      window.getNotification(t('licenseNotValid'), 'error');
    } else {
      // TODO can remove or change this  based on the caching mechanism
      window.getNotification(t('licenseIsActivated'), 'success');
    }
  }

  setLicenseStatus(status) {
    this.setState({ ...this.state, licenseStatus: status });
  }

  setCurrentVersion(currentVersion) {
    this.setState({ ...this.state, currentVersion });
  }

  async testMailConnection() {
    const { t, setLoading } = this.props;
    setLoading(true);
    const oldSettings = await window.ipc.getSettings();
    await window.ipc.saveSettings({
      ...oldSettings,
      smtpUsername: this.props.smtpUsername,
      smtpPassword: this.props.smtpPassword,
      smtpServer: this.props.smtpServer,
      smtpPort: this.props.smtpPort,
      smtpSsl: this.props.smtpSsl,
      smtpAuth: this.props.smtpAuth,
      smtpEmail: this.props.smtpEmail,
    });
    const settings = await window.ipc.getSettings();
    try {
      await window.ipc.sendMail({
        settings,
        attachment: {
          title: t('smtpTestingTitle'),
          text: t('smtpTestingText'),
        },
        type: 0,
      });
      setLoading(false);
    } catch (err) {
      setLoading(false);
    }
  }

  async componentDidMount() {
    window.ipc.onUpdateNotAvailable(() => {
      if (this.state.isLookingForUpdates) {
        this.props.openUpdate('', false);
        this.setState({ ...this.state, isLookingForUpdates: false });
      }
    });
    const currentVersion = await window.ipc.getCurrentVersion();
    // const licenseStatus = await window.ipc.getLicenseStatus();
    // this.setLicenseStatus(licenseStatus[1]);
    this.setCurrentVersion(currentVersion || '');
  }

  getDateFormatOptions(t) {
    const today = new Date();
    const monthName = t(today.toLocaleString('en-GB', { month: 'short' }).toLowerCase());
    const day = today.toLocaleString('en-GB', { day: 'numeric' });
    const day2Digit = today.toLocaleString('en-GB', { day: '2-digit' });
    const month = today.toLocaleString('en-GB', { month: 'numeric' });
    const month2Digit = today.toLocaleString('en-GB', { month: '2-digit' });
    const year = today.toLocaleString('en-GB', { year: 'numeric' });
    return [
      { label: `${day}-${month}-${year}`, value: 'd-M-yyyy' },
      { label: `${day2Digit}-${month2Digit}-${year}`, value: 'dd-MM-yyyy' },
      { label: `${day} ${monthName} ${year}`, value: 'd MMM yyyy' },
      { label: `${day}/${month}/${year}`, value: 'd/M/yyyy' },
      { label: `${year}-${month2Digit}-${day2Digit}`, value: 'yyyy-MM-dd' },
    ];
  }

  render() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Input, Form, SelectPicker, Button, Toggle, Nav, Checkbox,
    } = rsuite;
    const boxStyle = { marginTop: 10 };
    const emailForm = h(Form.Group, null, [
      h(Form.ControlLabel, { style: boxStyle }, [
        t('username'),
        h(Input, {
          value: this.props.smtpUsername,
          onChange: (val) => this.props.setSmtpUsername(val),
          placeholder: t('username'),
        }),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('password'),
        h(Input, {
          type: 'password',
          value: this.props.smtpPassword,
          onChange: (val) => this.props.setSmtpPassword(val),
          placeholder: t('password'),
        }),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('smtpServer'),
        h(Input, {
          value: this.props.smtpServer,
          onChange: (val) => this.props.setSmtpServer(val),
          placeholder: t('smtpServer'),
        }),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('smtpPort'),
        h(Input, {
          value: this.props.smtpPort,
          onChange: (val) => this.props.setSmtpPort(val),
          placeholder: t('smtpPort'),
        }),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('smtpSsl'),
        h(Checkbox, {
          className: 'toggle-named',
          checked: this.props.smtpSsl,
          onChange: (val, checked) => this.props.setSmtpSsl(checked),
        }),
        t('smtpPortMessage'),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('smtpAuth'),
        h(Checkbox, {
          checked: this.props.smtpAuth,
          onChange: (val, checked) => this.props.setSmtpAuth(checked),
        }),
      ]),
      h(Form.ControlLabel, { style: boxStyle }, [
        t('smtpEmailTo'),
        h(Input, {
          value: this.props.smtpEmail,
          onChange: (val) => this.props.setSmtpEmail(val),
          placeholder: t('smtpEmailTo'),
        }),
      ]),
      h(Form.ControlLabel, { style: { marginTop: 30, float: 'right' } }, [
        h(Button, { style: { backgroundColor: 'grey', color: '#fff' }, onClick: () => this.testMailConnection() }, t('testConnection')),
      ]),
    ]);

    const GeneralForm = h(Form, { className: 'settings' }, [
      h(Form.Group, null, [
        h('label', null, t('invoiceTitleFormat')),
        h(Input, {
          value: this.props.format,
          onChange: (val) => this.props.setFormat(val),
        }),
        h(Form.HelpText, null, t('availableTags')),
        h(Form.HelpText, null, t('fileExtensionAppendedAutomatically')),
      ]),
      h(Form.Group, null, [
        h('label', null, t('invoiceDateFormat')),
        h(SelectPicker, {
          className: 'date-format-picker',
          data: this.getDateFormatOptions(t),
          searchable: false,
          cleanable: false,
          value: this.props.dateFormat,
          onChange: (val) => this.props.setDateFormat(val),
        }),
      ]),
      h(Form.Group, { className: 'rs-flex-box-grid rs-flex-box-grid-bottom rs-flex-box-grid-space-between' }, [
        h('div', { className: 'rs-flex-box-grid-item rs-flex-box-grid-item-15' }, [
          h('label', null, 'License Key'),
          h(Input, {
            value: this.props.licenseKey,
            onChange: (val) => this.props.setLicenseKey(val),
          }),
        ]),
        h('div', { className: 'rs-flex-box-grid-item  rs-flex-box-grid-item-7' }, [
          h(Button, { className: 'rs-btn-md', onClick: () => this.saveLicense() }, t('saveLicenseKey')),
        ]),
      ]),
      h(Form.Group, null, [
        h(Form.ControlLabel, null, [
          h(Toggle, {
            className: 'toggle-named',
            checked: this.props.debugMode,
            onChange: (val) => this.props.setDebugMode(val),
          }),
          t('debugMode'),
        ]),
      ]),
      h(Form.Group, null, [
        h(Button, { onClick: this.props.resetDownloadedList }, t('resetDownloadedList')),
        h(Button, { onClick: this.props.resetEmailedList, className: 'reset-email-list' }, t('resetEmailedList')),
      ]),
      h(Form.Group, null, [
        h(Button, { onClick: this.checkForUpdates }, t('checkForUpdates')),
        this.state.currentVersion && h('span', { className: 'current-version' }, [
          t('currentVersion', { version: this.state.currentVersion }),
        ]),
      ]),
    ]);
    const activeForm = this.state.activeForm === 'general' ? GeneralForm : emailForm;
    return h(Form, { className: 'settings' }, [
      h(Nav, { activeKey: this.state.activeForm, appearance: 'tabs' }, [
        h(Nav.Item, { eventKey: 'general', onClick: () => this.setState({ activeForm: 'general' }) }, t('generalSettings')),
        h(Nav.Item, { eventKey: 'email', onClick: () => this.setState({ activeForm: 'email' }) }, t('emailSettings')),
      ]),
      activeForm,
    ]);
  }
}

window.Settings = Settings;
