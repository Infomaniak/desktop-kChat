// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, session} from 'electron';
import isDev from 'electron-is-dev';

import {Logger} from 'common/log';

const log = new Logger('ProxyManager');

export function setupBeforeAppReady() {
    if (!isDev) {
        return;
    }

    const proxy = process.env.MM_PROXY;
    const ignoreCerts = process.env.MM_IGNORE_CERT_ERRORS === 'true';

    if (proxy || ignoreCerts) {
        log.info(`Ignoring certificate errors (proxy=${proxy || 'none'}, explicit=${ignoreCerts})`);
        app.commandLine.appendSwitch('ignore-certificate-errors');
    }
}

export function setupAfterAppReady() {
    if (!isDev) {
        return;
    }

    const proxy = process.env.MM_PROXY;

    if (proxy) {
        log.info(`Configuring proxy: ${proxy}`);
        session.defaultSession.setProxy({proxyRules: proxy});
    }
}
