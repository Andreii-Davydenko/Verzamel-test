class Controls extends React.Component {
  state = {
    wsModalOpen: false,
    dateRange: [],
  };

  languages = [
    { label: 'EN', value: 'en' },
    { label: 'NL', value: 'nl' },
  ];

  constructor(props) {
    super(props);
    this.openWsModal = this.openWsModal.bind(this);
    this.closeWsModal = this.closeWsModal.bind(this);
    this.setDateRange = this.setDateRange.bind(this);
    this.fetchInvoices = this.fetchInvoices.bind(this);
    this.saveSettings = this.saveSettings.bind(this);
  }

  openWsModal() {
    this.setState({ ...this.state, wsModalOpen: true });
  }

  closeWsModal() {
    this.setState({ ...this.state, wsModalOpen: false });
    this.props.fetchWebsites();
  }

  setDateRange(dateRange) {
    this.setState({ ...this.state, dateRange });
  }

  async fetchInvoices() {
    const { t, websiteIdsToFetchFor } = this.props;
    if (websiteIdsToFetchFor.length < 1) {
      window.getNotification(t('noWebsiteSelected'));
    } else {
      this.props.setLoading(true);
      const dateRange = this.state.dateRange.length === 2
        ? { from: this.state.dateRange[0].toISOString(), to: this.state.dateRange[1].toISOString() }
        : null;
      await window.ipc.fetchInvoices(dateRange, websiteIdsToFetchFor);
      const invoices = await window.ipc.getAllInvoices();
      this.props.setInvoices(invoices);
      await this.props.fetchWebsites();
      window.getNotification(t('done'), 'success');
    }
  }

  async saveSettings() {
    const { t } = this.props;
    const result = await window.ipc.saveSettings({
      format: this.props.format,
      dateFormat: this.props.dateFormat,
      debugMode: this.props.debugMode,
      smtpUsername: this.props.smtpUsername,
      smtpPassword: this.props.smtpPassword,
      smtpServer: this.props.smtpServer,
      smtpPort: this.props.smtpPort,
      smtpSsl: this.props.smtpSsl,
      smtpAuth: this.props.smtpAuth,
      smtpEmail: this.props.smtpEmail,
      licenseKey: this.props.licenseKey,
    });
    await this.props.fetchLicenseStatus();
    if (result.error) {
      return window.getNotification(result.error);
    }
    return window.getNotification(t('settingsUpdated'), 'success');
  }

  getDatePickerLocale(t) {
    return {
      sunday: t('su'),
      monday: t('mo'),
      tuesday: t('tu'),
      wednesday: t('we'),
      thursday: t('th'),
      friday: t('fr'),
      saturday: t('sa'),
      ok: 'OK',
      renderMonth: (date) => {
        const monthName = t(date.toLocaleString('en-GB', { month: 'short' }).toLowerCase());
        const year = date.toLocaleString('en-GB', { year: 'numeric' });
        return `${monthName} ${year}`;
      },
    };
  }

  getDatePickerRanges(t) {
    return [
      {
        label: t('today'),
        value: [dayjs().startOf('day').toDate(), dayjs().endOf('day').toDate()],
      },
      {
        label: t('yesterday'),
        value: [
          dayjs().subtract(1, 'day').startOf('day').toDate(),
          dayjs().subtract(1, 'day').endOf('day').toDate(),
        ],
      },
      {
        label: t('last7days'),
        value: [
          dayjs().subtract(6, 'day').startOf('day').toDate(),
          dayjs().endOf('day').toDate(),
        ],
      },
      {
        label: t('last30days'),
        value: [
          dayjs().subtract(29, 'day').startOf('day').toDate(),
          dayjs().endOf('day').toDate(),
        ],
      },
    ];
  }

  renderRightControls(h) {
    const { t } = this.props;
    const {
      Nav,
      Button,
      DateRangePicker,
      SelectPicker,
    } = rsuite;
    const {
      ReloadOutlined,
      PlusOutlined,
      DownloadOutlined,
      DeleteFilled,
      SaveOutlined,
      MailOutlined,
    } = icons;
    let rightControls = [];
    if (this.props.scraperAvailable) {
      rightControls = [h(Button, {
        onClick: this.fetchInvoices,
        disabled: !this.props.scraperAvailable,
      }, [
        h(ReloadOutlined, null),
      ]),
      h(Button, { onClick: this.openWsModal }, [
        h(PlusOutlined, null),
      ])];
    } else {
      rightControls = [h('span', { className: 'scraper-unavailable text-bold' }, t('insertKeySettingsPage'))];
    }
    switch (this.props.currentView) {
      case 'WEBSITES':
        return h(Nav, { pullRight: true, className: 'main-controls-right' }, [...[
          h(DateRangePicker, {
            className: 'invoice-daterange-picker',
            format: 'dd-MM-yyyy',
            placement: 'bottomRight',
            placeholder: t('selectDateRange'),
            value: this.state.dateRange,
            locale: this.getDatePickerLocale(t),
            ranges: this.getDatePickerRanges(t),
            onChange: (val) => this.setDateRange(val),
            onClean: () => this.setDateRange([]),
          }),
        ], ...rightControls,
        ]);
      case 'INVOICES':
        return h(Nav, { pullRight: true, className: 'main-controls-right' }, [
          h(SelectPicker, {
            className: 'download-select-option',
            data: [
              { label: t('selectNothing'), value: 'nothing' },
              { label: t('selectNotDownloaded'), value: 'not-downloaded' },
              { label: t('selectNotEmailed'), value: 'not-emailed' },
            ],
            searchable: false,
            cleanable: false,
            defaultValue: 'en',
            onChange: (val) => {
              switch (val) {
                case 'nothing': {
                  this.props.emptyInvoiceSelectionList();
                  break;
                }
                case 'not-downloaded': {
                  this.props.selectUnDownloadedInvoices();
                  break;
                }
                case 'not-emailed': {
                  this.props.selectUnEmailedInvoices();
                  break;
                }
                default: {
                  break;
                }
              }
            },
          }),
          h(Button, { onClick: this.props.downloadSelectedInvoices }, [
            h(DownloadOutlined, null),
          ]),
          h(Button, { onClick: this.props.mailInvoices }, [
            h(MailOutlined, null),
          ]),
          h(Button, { onClick: this.props.deleteSelectedInvoices }, [
            h(DeleteFilled, null),
          ]),
        ]);
      case 'SETTINGS':
        return h(Nav, { pullRight: true, className: 'main-controls-right' }, [
          h(Button, { onClick: this.saveSettings }, [
            h(SaveOutlined, null),
          ]),
        ]);
      default:
        return h(Nav, { pullRight: true, className: 'main-controls-right' }, [
          h(Button, { onClick: this.fetchInvoices }, [
            h(ReloadOutlined, null),
          ]),
          h(Button, { onClick: this.openWsModal }, [
            h(PlusOutlined, null),
          ]),
        ]);
    }
  }

  render() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Navbar, Nav, Button, SelectPicker,
    } = rsuite;
    const { HomeFilled } = icons;
    return h(Navbar, { className: 'main-controls' }, [
      h(window.AddWebsite, {
        wsModalOpen: this.state.wsModalOpen,
        closeWsModal: this.closeWsModal,
        t,
      }),
      h(Nav, null, [
        h(Button, {
          className: 'home-btn',
          onClick: () => this.props.switchView('WEBSITES'),
        }, [
          h(HomeFilled, null),
        ]),
        h(SelectPicker, {
          className: 'lang-picker',
          data: this.languages,
          searchable: false,
          cleanable: false,
          defaultValue: 'en',
          onChange: (val) => this.props.changeLanguage(val),
        }),
      ]),
      this.renderRightControls(h),
    ]);
  }
}

window.Controls = Controls;
