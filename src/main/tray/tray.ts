// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, Tray, systemPreferences, nativeTheme} from 'electron';

import AppState from 'common/appState';
import {UPDATE_APPSTATE_TOTALS} from 'common/communication';
import {Logger} from 'common/log';
import {localizeMessage} from 'main/i18nManager';
import {loadImagesSync, loadImagesAsync} from 'main/tray/trayImages';
import type {IconSet} from 'main/tray/trayImages';
import MainWindow from 'main/windows/mainWindow';

const log = new Logger('Tray');

export class TrayIcon {
    private tray?: Tray;
    private images: IconSet;
    private status: keyof IconSet;
    private message: string;
    private iconTheme: string;
    private themeChangeTimeout: NodeJS.Timeout | null = null;

    constructor() {
        this.status = 'normal';
        this.message = app.name;
        this.images = {} as IconSet;
        this.iconTheme = '';

        AppState.on(UPDATE_APPSTATE_TOTALS, this.onAppStateUpdate);
    }

    init = (iconTheme: string) => {
        this.iconTheme = iconTheme;
        this.images = loadImagesSync(iconTheme);
        this.tray = new Tray(this.images.normal);

        if (process.platform === 'darwin') {
            systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', () => {
                this.tray?.setImage(this.images.normal);
            });
        }

        if (process.platform === 'win32') {
            nativeTheme.on('updated', this.onThemeUpdated);
        }

        this.tray.setToolTip(app.name);
        this.tray.on('click', this.onClick);
        this.tray.on('right-click', () => this.tray?.popUpContextMenu());
        this.tray.on('balloon-click', this.onClick);

        // loadImagesSync uses nativeTheme.shouldUseDarkColors which can be wrong when
        // the app theme overrides nativeTheme.themeSource. Refresh async from the
        // Windows registry to get the real system theme and correct the icon.
        this.refreshImages(iconTheme);
    };

    private onThemeUpdated = () => {
        if (this.themeChangeTimeout) {
            clearTimeout(this.themeChangeTimeout);
        }
        this.themeChangeTimeout = setTimeout(() => {
            this.themeChangeTimeout = null;
            this.refreshImages(this.iconTheme);
        }, 300);
    };

    refreshImages = async (trayIconTheme: string) => {
        this.iconTheme = trayIconTheme;
        this.images = await loadImagesAsync(trayIconTheme);
        if (this.tray) {
            this.update(this.status, this.message);
        }
        return this.images;
    };

    destroy = () => {
        if (process.platform === 'win32') {
            nativeTheme.removeListener('updated', this.onThemeUpdated);
            if (this.themeChangeTimeout) {
                clearTimeout(this.themeChangeTimeout);
                this.themeChangeTimeout = null;
            }
            this.tray?.destroy();
        }
    };

    setMenu = (tMenu: Electron.Menu) => this.tray?.setContextMenu(tMenu);

    private update = (status: keyof IconSet, message: string) => {
        if (!this.tray || this.tray.isDestroyed()) {
            return;
        }

        this.status = status;
        this.message = message;
        this.tray.setImage(this.images[status]);
        this.tray.setToolTip(message);
    };

    private onClick = () => {
        log.verbose('onClick');

        // Special case for macOS since that's how most tray icons behave there
        if (process.platform === 'darwin') {
            this.tray?.popUpContextMenu();
            return;
        }

        // At minimum show the main window
        MainWindow.show();

        const mainWindow = MainWindow.get();
        if (!mainWindow) {
            throw new Error('Main window does not exist');
        }

        // Restore if minimized
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
            mainWindow.show();
        }

        mainWindow.focus();
    };

    private onAppStateUpdate = (anyExpired: boolean, anyMentions: number, anyUnreads: boolean) => {
        if (anyMentions > 0) {
            this.update('mention', localizeMessage('main.tray.tray.mention', 'You have been mentioned'));
        } else if (anyUnreads) {
            this.update('unread', localizeMessage('main.tray.tray.unread', 'You have unread channels'));
        } else if (anyExpired) {
            this.update('mention', localizeMessage('main.tray.tray.expired', 'Session Expired: Please sign in to continue receiving notifications.'));
        } else {
            this.update('normal', app.name);
        }
    };
}

const tray = new TrayIcon();
export default tray;
