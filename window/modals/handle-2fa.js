class Handle2fa extends React.Component {
  constructor(props) {
    super(props);
    this.setFormValue = this.setFormValue.bind(this);
    this.onSkip = this.onSkip.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
  }

  state = {
    formValue: { code: '' },
  };

  setFormValue(formValue) {
    this.setState({ ...this.state, formValue });
  }

  async onSkip() {
    await window.ipc.resolve2FA({ id: this.props.id, code: '' });
    this.setFormValue({ code: '' });
    this.props.onClose();
  }

  async onSubmit() {
    await window.ipc.resolve2FA({ id: this.props.id, code: this.state.formValue.code });
    this.setFormValue({ code: '' });
    this.props.onClose();
  }

  render() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Button, Modal, Form,
    } = rsuite;
    return h(Modal, { open: this.props.open, onClose: this.props.onClose }, [
      h(Modal.Header, null, [
        h(Modal.Title, null, t(this.props.question ? 'enterSQforWebsite' : 'enter2FACodeForWebsite', { wsName: this.props.name })),
      ]),
      h(Modal.Body, null, [
        h(Form, {
          className: this.props.question ? 'security-question' : 'two-fa',
          formValue: this.state.formValue,
          onChange: this.setFormValue,
        }, [
          h(Form.Group, { controlId: 'code' }, [
            h(Form.ControlLabel, null, t(this.props.question ? this.props.question : 'code2FA')),
            h(Form.Control, { name: 'code' }),
          ]),
        ]),
      ]),
      h(Modal.Footer, null, [
        h(Button, { onClick: this.onSubmit }, t('submit')),
        h(Button, { onClick: this.onSkip }, t('skip')),
      ]),
    ]);
  }
}

window.Handle2fa = Handle2fa;
