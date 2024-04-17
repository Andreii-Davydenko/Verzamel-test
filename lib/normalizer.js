class Normalizer {
  /**
   * @private
   * @type {Map<String, String>}
   */
  en = new Map([
    ['Jan', 'January'],
    ['Feb', 'February'],
    ['Mar', 'March'],
    ['Apr', 'April'],
    ['May', 'May'],
    ['Jun', 'June'],
    ['Jul', 'July'],
    ['Aug', 'August'],
    ['Sep', 'September'],
    ['Oct', 'October'],
    ['Nov', 'November'],
    ['Dec', 'December'],
  ]);

  /**
   * @private
   * @type {Map<String, String>}
   */
  nl = new Map([
    ['Jan', 'Januari'],
    ['Feb', 'Februari'],
    ['Mar', 'Maart'],
    ['Apr', 'April'],
    ['May', 'Mei'],
    ['Jun', 'Juni'],
    ['Jul', 'Juli'],
    ['Aug', 'Augustus'],
    ['Sep', 'September'],
    ['Oct', 'Oktober'],
    ['Nov', 'November'],
    ['Dec', 'December'],
  ]);

  /**
   * @public
   * @param {String} lang
   * @param {String} date
   */
  normalizeDate(lang, date) {
    let normalizedDate = '';
    normalizedDate = this.translateMonthName(lang, date);
    normalizedDate = this.escapeTrailingSlashChars(normalizedDate);
    return normalizedDate;
  }

  /**
   * @private
   * @param {String} lang
   * @param {String} date
   * @return {String}
   */
  translateMonthName(lang, date) {
    if (!this[lang]) return date;
    let translatedDate = date;
    this[lang].forEach((val, key) => {
      translatedDate = translatedDate.replace(key, val);
    });
    return translatedDate;
  }

  /**
   * @private
   * @param {String} date
   * @return {String}
   */
  escapeTrailingSlashChars(date) {
    return date.replace(/\//g, '\u2215');
  }
}

module.exports = Normalizer;
