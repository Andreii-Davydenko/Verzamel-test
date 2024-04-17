class HandleUpdate extends React.Component {
  state = {
    isDownloading: false,
    percent: 0,
  };

  constructor(props) {
    super(props);
    this.setPercent = this.setPercent.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
  }

  setPercent(percent) {
    this.setState({ isDownloading: true, percent });
  }

  onSubmit() {
    this.setState({ isDownloading: true });
    window.ipc.downloadUpdate();
  }

  componentDidMount() {
    window.ipc.onUpdateDownloadProgress((event, progressObj) => {
      if (progressObj?.percent) {
        this.setPercent(Math.round(progressObj.percent));
      }
    });
  }

  render() {
    const h = React.createElement;
    const { t } = this.props;
    const { Button, Modal, Progress } = rsuite;
    return h(Modal, { open: this.props.open, onClose: this.props.onClose }, [
      h(Modal.Header, null, [
        h(Modal.Title, null, this.props.available ? t('updateAvailable') : t('updateNotAvailable')),
      ]),
      h(Modal.Body, null, [
        h('p', null, this.props.available ? t('foundVersion', { version: this.props.version }) : t('updateForVersionNotAvailable')),
        this.state.isDownloading && h('p', null, t('downloading')),
        this.state.isDownloading && h(Progress.Line, {
          percent: this.state.percent,
        }),
      ]),
      h(Modal.Footer, null, this.props.available
        ? [
          h(Button, { onClick: this.onSubmit, disabled: this.state.isDownloading }, t('downloadAndInstall')),
          h(Button, { onClick: this.props.onClose, disabled: this.state.isDownloading }, t('skip')),
        ] : [h(Button, { onClick: this.props.onClose }, t('ok'))]),
    ]);
  }
}

window.HandleUpdate = HandleUpdate;
