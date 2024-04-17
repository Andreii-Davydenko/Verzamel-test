// eslint-disable-next-line import/no-extraneous-dependencies
const electron = require('electron');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const captcha = require('puppeteer-extra-plugin-recaptcha');

const Repository = require('./lib/repository');
const Browser = require('./lib/browser');
const MainProcess = require('./lib/main-process');

chromium.use(stealth());
chromium.use(captcha({
  provider: { id: '2captcha', token: 'd47582b381fb7690ed580f75d5da15b9' },
  visualFeedback: true,
}));

function getExePath() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = chromePaths.find((p) => fs.existsSync(p));
  return chromePath || chromePaths[0];
}

const browser = new Browser(chromium, getExePath());
const repo = new Repository(electron.app.getPath('userData'));
const mainProcess = new MainProcess(electron, repo, browser);

mainProcess.bootstrap();
