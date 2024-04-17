const http = require('http');
const url = require('url');

class RedirectServer {
  /**
   * @private
   * @type {import('http').Server<typeof IncomingMessage, typeof ServerResponse>}
   */
  server;

  /**
   * @private
   * @type {Promise<string>}
   */
  potentialRedirect;

  /**
   * @param {Object} ctx
   * @param {Number} ctx.port
   * @param {String} successRedirectURL
   * @param {String} callbackPath
   */
  constructor({ port, successRedirectURL, callbackPath }) {
    this.potentialRedirect = new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url && url.parse(req.url).pathname === callbackPath) {
          res.writeHead(302, { Location: successRedirectURL });
          res.end();
          resolve(this.resolveURL(`http://127.0.0.1:${port}`, req.url));
          this.server.close();
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.server.on('error', (e) => reject(e));
      this.server.listen(port);
    });
  }

  /**
   * @private
   * @param {String} from
   * @param {String} to
   * @return {String}
   */
  resolveURL(from, to) {
    const resolvedUrl = new URL(to, new URL(from, 'resolve://'));
    if (resolvedUrl.protocol === 'resolve:') {
      // `from` is a relative URL.
      const { pathname, search, hash } = resolvedUrl;
      return pathname + search + hash;
    }
    return resolvedUrl.toString();
  }

  /**
   * Will resolve with the exact reached callback URL that contains the Authorization code.
   */
  waitForRedirect() {
    return this.potentialRedirect;
  }

  close() {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => this.server.close(resolve));
  }
}

module.exports = RedirectServer;
