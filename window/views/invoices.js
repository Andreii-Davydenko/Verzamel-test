class Invoices extends React.Component {
  state = {
    sortColumn: 'date',
    sortType: 'desc',
  };

  constructor(props) {
    super(props);
    this.getTranslatedInvoices = this.getTranslatedInvoices.bind(this);
    this.getData = this.getData.bind(this);
    this.sortByDate = this.sortByDate.bind(this);
    this.getSortedInvoices = this.getSortedInvoices.bind(this);
    this.onSortColumn = this.onSortColumn.bind(this);
  }

  getSortedInvoices() {
    return this.props.invoices.sort((a, b) => {
      const x = a[this.state.sortColumn];
      const y = b[this.state.sortColumn];
      if (this.state.sortColumn === 'date') {
        return this.sortByDate(x, y);
      }
      if (this.state.sortType === 'asc') {
        return `${x}`.localeCompare(`${y}`);
      }
      return `${y}`.localeCompare(`${x}`);
    });
  }

  getTranslatedInvoices(invoices, t) {
    return invoices
      .map((invoice) => ({ ...invoice, date: this.translateInvoiceDate(t, invoice.date) }));
  }

  getData(t) {
    const sortedInvoices = this.getSortedInvoices();
    return this.getTranslatedInvoices(sortedInvoices, t);
  }

  sortByDate(x, y) {
    const dateFormat = this.props.dateFormat.toUpperCase();
    const xDate = dayjs(x, dateFormat).unix();
    const yDate = dayjs(y, dateFormat).unix();
    if (this.state.sortType === 'asc') {
      return xDate - yDate;
    }
    return yDate - xDate;
  }

  translateInvoiceDate(t, date) {
    if (!date) return '';
    let translatedDate = date.toLowerCase();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    months.forEach((month) => {
      translatedDate = translatedDate.replace(month, t(month));
    });
    return translatedDate;
  }

  async downloadInvoice(id) {
    const { t, i18n, updateDownloaded } = this.props;
    const result = await window.ipc.downloadInvoice({ id, lang: i18n.language });
    if (result.error) {
      window.getNotification(result.error);
    } else {
      updateDownloaded(id);
      window.getNotification(t('downloadComplete'), 'success');
    }
  }

  onSortColumn(sortColumn, sortType) {
    this.setState({ sortColumn, sortType });
  }

  render() {
    const { t } = this.props;
    const h = React.createElement;
    const { Table, Button, Checkbox } = rsuite;
    const { DownloadOutlined, CheckCircleFilled, CheckCircleOutlined } = icons;
    const { checkedKeys } = this.props;
    let checked = false;
    let indeterminate = false;

    if (checkedKeys.length === this.props.invoices.length) {
      checked = true;
    } else if (checkedKeys.length === 0) {
      checked = false;
    } else if (checkedKeys.length > 0 && checkedKeys.length < this.props.invoices.length) {
      indeterminate = true;
    }

    const handleCheckAll = (value, isChecked) => {
      // eslint-disable-next-line no-underscore-dangle
      const keys = isChecked ? this.props.invoices.map((item) => item._id) : [];
      this.props.setCheckedKeys(keys);
    };

    const handleCheck = (value, isChecked) => {
      const keys = isChecked
        ? [...checkedKeys, value]
        : checkedKeys.filter((item) => item !== value);
      this.props.setCheckedKeys(keys);
    };

    return h(Table, {
      showHeader: true,
      fillHeight: true,
      rowHeight: 38,
      headerHeight: 40,
      renderEmpty: () => h('div', { className: 'rs-table-body-info' }, t('noDataFound')),
      data: this.getData(t),
      sortColumn: this.state.sortColumn,
      sortType: this.state.sortType,
      onSortColumn: this.onSortColumn,
    }, [
      h(Table.Column, {
        width: 50,
        align: 'center',
      }, [
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
        h(Table.Cell, {
          style: { padding: 0 },
          dataKey: '_id',
        }, (rowData) => h('div', { style: { lineHeight: '36px' } }, [
          h(Checkbox, {
            value: rowData._id,
            inline: true,
            checkedKeys,
            checked: checkedKeys.some((item) => item === rowData._id),
            onChange: handleCheck,
          }),
        ])),
      ]),
      h(Table.Column, {
        key: 'description',
        width: this.props.columnWidth.description,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('description')),
        h(Table.Cell, { dataKey: 'description' }),
      ]),
      h(Table.Column, {
        key: 'filename',
        width: this.props.columnWidth.fileName,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('invoice')),
        h(Table.Cell, { dataKey: 'fileName' }),
      ]),
      h(Table.Column, {
        key: 'date',
        width: this.props.columnWidth.date,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('date')),
        h(Table.Cell, { dataKey: 'date' }),
      ]),
      h(Table.Column, {
        key: 'website',
        width: this.props.columnWidth.wsName,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('website')),
        h(Table.Cell, { dataKey: 'wsName' }),
      ]),
      h(Table.Column, {
        key: 'downloaded',
        width: this.props.columnWidth.downloaded,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('downloaded')),
        h(Table.Cell, {
          dataKey: '_id',
        }, (rowData) => h('span', null, [
          h(this.props.downloaded[rowData._id] ? CheckCircleFilled : CheckCircleOutlined, null),
        ])),
      ]),
      h(Table.Column, {
        key: 'emailed',
        width: this.props.columnWidth.wsName,
        sortable: true,
        resizable: true,
        onResize: this.props.setColumnWidth,
      }, [
        h(Table.HeaderCell, null, t('emailed')),
        h(Table.Cell, {
          dataKey: '_id',
        }, (rowData) => h('span', null, [
          h(this.props.emailed[rowData._id] ? CheckCircleFilled : CheckCircleOutlined, null),
        ])),
      ]),
      h(Table.Column, {
        key: 'actions',
        width: 60,
      }, [
        h(Table.HeaderCell, null, ''),
        h(Table.Cell, null, (rowData) => h(Button, {
          size: 'xs',
          appearance: 'subtle',
          onClick: () => this.downloadInvoice(rowData._id),
        }, [
          h(DownloadOutlined, null),
        ])),
      ]),
    ]);
  }
}

window.Invoices = Invoices;
