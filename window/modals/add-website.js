class AddWebsite extends React.Component {
  constructor(props) {
    super(props);
    this.setFormValue = this.setFormValue.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleOAuth = this.handleOAuth.bind(this);
    this.getProvider = this.getProvider.bind(this);
    this.providerHasUsername = this.providerHasUsername.bind(this);
    this.providerHasPassword = this.providerHasPassword.bind(this);
    this.providerHasOAuth = this.providerHasOAuth.bind(this);
  }

  providerOptions = [];

  state = {
    formValue: {
      name: '', url: '', username: '', password: '',
    },
  };

  async fetchProviderOptions() {
    this.providerOptions = await window.ipc.getProviders();
  }

  async componentDidMount() {
    await this.fetchProviderOptions();
  }

  setFormValue(formValue) {
    this.setState({ ...this.state, formValue });
  }

  getDefaultWsName(url) {
    const provider = this.providerOptions.find((item) => item.value === url);
    if (!provider) return '';
    return provider.label;
  }

  getProvider() {
    const { url } = this.state.formValue;
    return this.providerOptions.find((item) => item.value === url) || {};
  }

  providerHasUsername() {
    const provider = this.getProvider();
    return provider?.credentials?.username;
  }

  providerHasPassword() {
    const provider = this.getProvider();
    return provider?.credentials?.password;
  }

  providerHasAccountId() {
    const provider = this.getProvider();
    return provider?.credentials?.accountId;
  }

  providerHasBusinessId() {
    const provider = this.getProvider();
    return provider?.credentials?.businessId;
  }

  providerHasOAuth() {
    const provider = this.getProvider();
    return provider?.credentials?.oauth;
  }

  async handleSubmit() {
    const { t } = this.props;
    const {
      url, username, password, accountId, businessId,
    } = this.state.formValue;
    if (!url) {
      return window.getNotification(t('selectInvoiceProvider'));
    }
    const { credentials } = this.getProvider();
    if (credentials?.username && !username) {
      return this.window.getNotification(
        t('provideCredential', { credential: t(this.getProvider()?.credentials?.username).toLowerCase() }),
      );
    }
    if ((credentials?.password || credentials?.oauth) && !password) {
      return this.isOAuthProvider()
        ? window.getNotification(t('provideAuth'))
        : window.getNotification(
          t('provideCredential', { credential: t(this.getProvider()?.credentials?.password).toLowerCase() }),
        );
    }
    if (credentials?.accountId && !accountId) {
      return this.window.getNotification(
        t('provideCredential', { credential: t(this.getProvider()?.credentials?.accountId).toLowerCase() }),
      );
    }
    if (credentials?.businessId && !businessId) {
      return this.window.getNotification(
        t('provideCredential', { credential: t(this.getProvider()?.credentials?.businessId).toLowerCase() }),
      );
    }
    const name = this.state.formValue.name || this.getDefaultWsName(url);
    const result = await window.ipc.createWebsite({
      name, url, username, password, accountId, businessId,
    });
    if (result.error) {
      return window.getNotification(result.error);
    }
    this.setFormValue({
      url: '', name: '', username: '', password: '', accountId: '', businessId: '',
    });
    return this.props.closeWsModal();
  }

  async handleOAuth() {
    const token = await window.ipc.getOAuthCredentials('google');
    if (token) this.setFormValue({ ...this.state.formValue, password: token });
  }

  renderCredentialsForm() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Form, Button,
    } = rsuite;
    const { CheckCircleOutlined, WarningOutlined } = icons;
    if (!this.state.formValue.url) return [];
    return [
      h(Form.Group, { controlId: 'name' }, [
        h(Form.ControlLabel, null, t('customName')),
        h(Form.Control, { name: 'name' }),
      ]),
      this.providerHasUsername() && h(Form.Group, { controlId: 'username' }, [
        h(Form.ControlLabel, null, t(this.getProvider().credentials.username)),
        h(Form.Control, { name: 'username' }),
      ]),
      this.providerHasPassword() && h(Form.Group, { controlId: 'password' }, [
        h(Form.ControlLabel, null, t(this.getProvider().credentials.password)),
        h(Form.Control, { name: 'password', type: 'password' }),
      ]),
      this.providerHasAccountId() && h(Form.Group, { controlId: 'accountId' }, [
        h(Form.ControlLabel, null, t(this.getProvider().credentials.accountId)),
        h(Form.Control, { name: 'accountId' }),
      ]),
      this.providerHasBusinessId() && h(Form.Group, { controlId: 'businessId' }, [
        h(Form.ControlLabel, null, t(this.getProvider().credentials.businessId)),
        h(Form.Control, { name: 'businessId' }),
      ]),
      this.providerHasOAuth() && h(Button, {
        onClick: this.handleOAuth,
        endIcon: this.state.formValue.password ? h(CheckCircleOutlined) : h(WarningOutlined),
      }, t(this.getProvider().credentials.oauth)),
    ];
  }

  render() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Button, Modal, Form, InputPicker,
    } = rsuite;
    return h(Modal, { open: this.props.wsModalOpen, onClose: this.props.closeWsModal }, [
      h(Modal.Header, null, [
        h(Modal.Title, null, t('addWebsite')),
      ]),
      h(Modal.Body, null, [
        h(Form, {
          className: 'add-website-form',
          formValue: this.state.formValue,
          onChange: this.setFormValue,
        }, [
          h(Form.Group, { controlId: 'url' }, [
            h(Form.ControlLabel, null, t('invoiceProvider')),
            h(Form.Control, { name: 'url', accepter: InputPicker, data: this.providerOptions }),
          ]),
          ...this.renderCredentialsForm(),
        ]),
      ]),
      h(Modal.Footer, null, [
        h(Button, { onClick: this.handleSubmit }, t('submit')),
        h(Button, { onClick: this.props.closeWsModal }, t('cancel')),
      ]),
    ]);
  }
}

window.AddWebsite = AddWebsite;
