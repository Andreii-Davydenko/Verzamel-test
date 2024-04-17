class Navigation extends React.Component {
  render() {
    const h = React.createElement;
    const { t } = this.props;
    const {
      Sidebar, Sidenav, Nav,
    } = rsuite;
    const { HomeFilled, DownloadOutlined, SettingOutlined } = icons;
    return h(Sidebar, {
      className: 'main-nav',
      style: { display: 'flex', flexDirection: 'column' },
      width: 200,
    }, [
      h(Sidenav.Header, { className: 'nav-header' }, t('menu')),
      h(Sidenav, null, [
        h(Sidenav.Body, null, [
          h(Nav, null, [
            h(Nav.Item, {
              onSelect: () => this.props.switchView('WEBSITES'),
              active: this.props.currentView === 'WEBSITES',
              icon: h(HomeFilled, null),
            }, t('websites')),
            h(Nav.Item, {
              onSelect: () => this.props.switchView('INVOICES'),
              active: this.props.currentView === 'INVOICES',
              icon: h(DownloadOutlined, null),
            }, t('invoices')),
            h(Nav.Item, {
              onSelect: () => this.props.switchView('SETTINGS'),
              active: this.props.currentView === 'SETTINGS',
              icon: h(SettingOutlined, null),
            }, t('settings')),
          ]),
          this.props.logo ? h('img', {
            src: this.props.logo,
            alt: 'Image',
            style: {
              position: 'absolute',
              width: '200px',
              height: '200px',
              bottom: 0,
            },
          }) : '',
        ]),
      ]),
    ]);
  }
}

window.Navigation = Navigation;
