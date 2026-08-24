// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import os from 'os';
import path from 'path';

import {app} from 'electron';

/**
 * Default user preferences. End-users can change these parameters by editing config.json
 * @param {number} version - Scheme version. (Not application version)
 */

import type {ConfigV3} from 'types/config';

function parseXdgDownloadDir(): string | undefined {
    const home = os.homedir();
    if (!home) {
        return undefined;
    }
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const userDirsFile = path.join(configDir, 'user-dirs.dirs');
    try {
        const contents = fs.readFileSync(userDirsFile, 'utf-8');
        const match = contents.match(/^XDG_DOWNLOAD_DIR="(.+)"\r?$/m);
        if (match) {
            const dir = match[1].replace(/\$HOME/g, home);
            if (dir) {
                return dir;
            }
        }
    } catch {
        // File may not exist (e.g. minimal/headless systems)
    }
    return undefined;
}

export const getDefaultDownloadLocation = (): string | undefined => {
    // eslint-disable-next-line no-undef
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (__IS_MAC_APP_STORE__) {
        return undefined;
    }

    if (process.platform === 'linux') {
        if (process.env.XDG_DOWNLOAD_DIR) {
            return process.env.XDG_DOWNLOAD_DIR;
        }

        const xdgDownload = parseXdgDownloadDir();
        if (xdgDownload) {
            return xdgDownload;
        }
    }

    return app.getPath('downloads') || path.join(os.homedir(), 'Downloads');
};

const defaultPreferences: ConfigV3 = {
    version: 3,
    teams: [],
    showTrayIcon: true,
    trayIconTheme: 'use_system',
    minimizeToTray: process.platform !== 'linux',
    notifications: {
        flashWindow: process.platform === 'linux' ? 0 : 2,
        bounceIcon: true,
        bounceIconType: 'informational',
    },
    showUnreadBadge: true,
    useSpellChecker: true,
    enableHardwareAcceleration: true,
    autostart: true,
    hideOnStart: false,
    spellCheckerLocales: [],
    darkMode: false,
    lastActiveTeam: 0,
    downloadLocation: getDefaultDownloadLocation(),
    startInFullscreen: false,
    logLevel: 'info',
    enableMetrics: true,
};

export default defaultPreferences;
