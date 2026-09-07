// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {execFile} from 'child_process';

import {nativeTheme} from 'electron';

import {Logger} from 'common/log';

const log = new Logger('WindowsTheme');

const REG_QUERY_CMD = 'reg';
const REG_QUERY_ARGS = [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
    '/v',
    'SystemUsesLightTheme',
];

export function isWindowsSystemDark(): Promise<boolean> {
    return new Promise((resolve) => {
        execFile(REG_QUERY_CMD, REG_QUERY_ARGS, {timeout: 2000}, (error, stdout) => {
            if (error) {
                log.warn('Failed to read system theme from registry, falling back to nativeTheme', {error});
                resolve(nativeTheme.shouldUseDarkColors);
                return;
            }
            resolve(!stdout.includes('0x1'));
        });
    });
}
