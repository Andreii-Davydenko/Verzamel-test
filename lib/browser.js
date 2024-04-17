class Browser {
  /**
   * Create browser instance
   * @param {import('playwright-core').BrowserType} chromium
   * @param {String} exePath
   */
  constructor(chromium, exePath) {
    this.chromium = chromium;
    this.exePath = exePath;
  }

  /**
   * @public
   * @return {Promise<void>}
   */
  async init() {
    /**
     * @type {Browser}
     */
    this.chrome = await this.chromium.launch({
      executablePath: this.exePath,
      headless: true,
      args: ['--deny-permission-prompts'],
    });
  }

  /**
   * @public
   * @return {Promise<import('playwright-core').BrowserContext>}
   */
  async getPage() {
    const context = await this.chrome.newContext();
    return context && context.newPage();
  }
}

module.exports = Browser;
