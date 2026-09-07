// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import path from 'path';

import {app, nativeImage, nativeTheme} from 'electron';

import {isWindowsSystemDark} from 'main/tray/windowsTheme';

const assetsDir = path.resolve(app.getAppPath(), 'assets');

export type IconSet = {
    normal: Electron.NativeImage;
    unread: Electron.NativeImage;
    mention: Electron.NativeImage;
};

function resolveTheme(trayIconTheme: string, systemDark: boolean): string {
    const effectiveTheme = process.platform === 'win32' ? 'use_system' : trayIconTheme;
    if (effectiveTheme !== 'use_system') {
        return effectiveTheme;
    }
    return systemDark ? 'light' : 'dark';
}

export function loadImagesSync(trayIconTheme: string): IconSet {
    const systemDark = nativeTheme.shouldUseDarkColors;
    return buildImages(resolveTheme(trayIconTheme, systemDark));
}

export async function loadImagesAsync(trayIconTheme: string): Promise<IconSet> {
    const systemDark = process.platform === 'win32' ? await isWindowsSystemDark() : nativeTheme.shouldUseDarkColors;
    return buildImages(resolveTheme(trayIconTheme, systemDark));
}

function buildImages(resolvedTheme: string): IconSet {
    switch (process.platform) {
    case 'win32':
        return {
            normal: nativeImage.createFromPath(path.resolve(assetsDir, `windows/tray_${resolvedTheme}.ico`)),
            unread: nativeImage.createFromPath(path.resolve(assetsDir, `windows/tray_${resolvedTheme}_unread.ico`)),
            mention: nativeImage.createFromPath(path.resolve(assetsDir, `windows/tray_${resolvedTheme}_mention.ico`)),
        };
    case 'darwin': {
        const osxNormal = nativeImage.createFromPath(path.resolve(assetsDir, 'osx/menuIcons/MenuIcon16Template.png'));
        const osxUnread = nativeImage.createFromPath(path.resolve(assetsDir, 'osx/menuIcons/MenuIconUnread16Template.png'));
        osxNormal.setTemplateImage(true);
        osxUnread.setTemplateImage(true);
        return {
            normal: osxNormal,
            unread: osxUnread,
            mention: osxUnread,
        };
    }
    case 'linux': {
        const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
        return {
            normal: nativeImage.createFromPath(path.resolve(assetsDir, 'linux', `top_bar_${theme}_16.png`)),
            unread: nativeImage.createFromPath(path.resolve(assetsDir, 'linux', `top_bar_${theme}_unread_16.png`)),
            mention: nativeImage.createFromPath(path.resolve(assetsDir, 'linux', `top_bar_${theme}_mention_16.png`)),
        };
    }
    default:
        return {} as IconSet;
    }
}
