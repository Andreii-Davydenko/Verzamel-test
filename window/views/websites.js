class Websites extends React.Component {
  providerOptions = [];

  state = {
    sortColumn: 'name',
    sortType: 'asc',
  };

  constructor(props) {
    super(props);
    this.getSortedWebsites = this.getSortedWebsites.bind(this);
    this.onSortColumn = this.onSortColumn.bind(this);
  }

  async deleteWebsite(id) {
    await window.ipc.deleteWebsite(id);
    this.props.fetchWebsites();
  }

  async fetchProviderOptions() {
    this.providerOptions = await window.ipc.getProviders();
  }

  isDateless(url) {
    const provider = this.providerOptions.find((item) => item.value === url);
    return provider?.dateless;
  }

  async componentDidMount() {
    await this.fetchProviderOptions();
  }

  getSortedWebsites(websites) {
    return websites.sort((a, b) => {
      const x = a[this.state.sortColumn];
      const y = b[this.state.sortColumn];
      if (this.state.sortType === 'asc') {
        return `${x}`.localeCompare(`${y}`);
      }
      return `${y}`.localeCompare(`${x}`);
    });
  }

  onSortColumn(sortColumn, sortType) {
    this.setState({ sortColumn, sortType });
  }

  render() {
    const h = React.createElement;
    const {
      t,
      websites,
      checkedWebSites,
      updateCheckedWebSites,
      websiteIdsToFetchFor,
      columnWidth,
      setColumnWidth,
      editWebsite,
    } = this.props;

    const { Table, Button, Checkbox } = rsuite;
    const {
      DeleteFilled, EditFilled, CalendarFilled, WarningFilled,
    } = icons;
    let checked = false;
    let indeterminate = false;

    if (websiteIdsToFetchFor.length === websites.length) {
      checked = true;
    } else if (websiteIdsToFetchFor.length === 0) {
      checked = false;
    } else if (
      websiteIdsToFetchFor.length > 0
      && websiteIdsToFetchFor.length < websites.length
    ) {
      indeterminate = true;
    }

    const handleCheckAll = (value, isChecked) => {
      const finalCheckedKeys = {};
      if (isChecked) {
        (websites || []).forEach(({ _id }) => {
          finalCheckedKeys[_id] = 1;
        });
      }
      updateCheckedWebSites(finalCheckedKeys);
    };

    const handleCheck = (value, isChecked) => {
      const finalCheckedKeys = { ...(checkedWebSites || {}) };
      if (isChecked) {
        finalCheckedKeys[value] = 1;
      } else {
        delete finalCheckedKeys[value];
      }
      updateCheckedWebSites(finalCheckedKeys);
    };
    return h(
      Table,
      {
        showHeader: true,
        fillHeight: true,
        rowHeight: 38,
        headerHeight: 40,
        renderEmpty: () => h('div', { className: 'rs-table-body-info' }, t('noDataFound')),
        data: this.getSortedWebsites(websites),
        sortColumn: this.state.sortColumn,
        sortType: this.state.sortType,
        onSortColumn: this.onSortColumn,
      },
      [
        h(
          Table.Column,
          {
            width: 50,
            align: 'center',
          },
          [
            h(Table.HeaderCell, { style: { padding: 0 } }, [
              h('div', { style: { lineHeight: '40px' } }, [
                h(Checkbox, {
                  inline: true,
                  checked,
                  indeterminate,
                  onChange: handleCheckAll,
                }),
              ]),
            ]),
            h(
              Table.Cell,
              {
                style: { padding: 0 },
                dataKey: '_id',
              },
              (rowData) => h('div', { style: { lineHeight: '36px' } }, [
                h(Checkbox, {
                  value: rowData._id,
                  inline: true,
                  checkedKeys: websiteIdsToFetchFor,
                  checked: !!checkedWebSites[rowData._id],
                  onChange: handleCheck,
                }),
              ]),
            ),
          ],
        ),
        h(
          Table.Column,
          {
            key: 'name',
            width: columnWidth.name,
            onResize: setColumnWidth,
            resizable: true,
            sortable: true,
          },
          [
            h(Table.HeaderCell, null, t('websiteName')),
            h(Table.Cell, { dataKey: 'name' }),
          ],
        ),
        h(
          Table.Column,
          {
            key: 'url',
            width: columnWidth.url,
            onResize: setColumnWidth,
            resizable: true,
          },
          [
            h(Table.HeaderCell, null, t('websiteUrl')),
            h(Table.Cell, { dataKey: 'url' }),
          ],
        ),
        h(
          Table.Column,
          {
            key: 'actions',
            width: columnWidth.actionWebsite,
            align: 'right',
          },
          [
            h(Table.HeaderCell, null, ''),
            h(Table.Cell, { className: 'btn-cell' }, (rowData) => [
              (rowData.authFailed || rowData.fetchFailed)
                && h('div', { className: 'err-badge-container' }, [
                  h(WarningFilled, {
                    className: 'provider-badge hint--left',
                    'aria-label': rowData.authFailed
                      ? t('authenticationFailed', { wsName: rowData.name })
                      : t('failedToFetchInvoicesFromWebsite', {
                        wsName: rowData.name,
                      }),
                  }),
                ]),
              this.isDateless(rowData.url)
                && h(
                  'div',
                  { className: 'fa-provider-badge-container dateless' },
                  [
                    h(CalendarFilled, {
                      className: 'fa-provider-badge provider-badge hint--left',
                      'aria-label': t('invoiceDateNotAvailable'),
                    }),
                  ],
                ),
              h(Button, {
                size: 'xs',
                appearance: 'subtle',
                // eslint-disable-next-line no-underscore-dangle
                onClick: () => editWebsite(rowData),
              }, [
                h(EditFilled, null),
              ]),
              h(Button, {
                size: 'xs',
                appearance: 'subtle',
                // eslint-disable-next-line no-underscore-dangle
                onClick: () => this.deleteWebsite(rowData._id),
              }, [
                h(DeleteFilled, null),
              ]),
            ]),
          ],
        ),
      ],
    );
  }
}

window.Websites = Websites;
