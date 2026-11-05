// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import url from 'url';

import {
    getPopupTarget,
    initPopupsConfigurationMain,
    setupPictureInPictureMain,
    setupPowerMonitorMain,
    setupRemoteDrawMain,
    setupScreenSharingMain,
} from '@infomaniak/jitsi-meet-electron-sdk/main';
import {app, BrowserWindow, ipcMain, shell} from 'electron';

import CallDialingWindow from './callDialingWindow';
import MainWindow from './mainWindow';

import electronBuilder from '../../../electron-builder.json';
import ServerViewState from '../../app/serverViewState';
import {CALL_ENDED, CALL_READY_TO_CLOSE, CALL_RING_CLOSE_WINDOW, CALL_RING_WINDOW_IS_OPEN} from '../../common/communication';
import {Logger} from '../../common/log';
import {isOfficialKchatTenantURL, isTrustedKmeetAuthURL, isTrustedKmeetURL, parseURL} from '../../common/utils/url';
import {composeUserAgent, getLocalPreload} from '../utils';
import ViewManager from '../views/viewManager';

type CallInfoNotifyProps = {
    push: string;
    email: string;
    channel: string;
    desktop: string;
    comments: string;
    first_name: string;
    push_status: string;
    mention_keys: string;
    push_threads: string;
    desktop_sound: string;
    email_threads: string;
    desktop_threads: string;
    desktop_notification_sound: string;
};

type CallInfoTimezone = {
    automaticTimezone: string;
    manualTimezone: string;
    useAutomaticTimezone: string;
};

type CallInfoProps = {
    show_last_active: string;
    customStatus: string;
};

type CallInfoUser = {
    id: string;
    user_id: number;
    team_id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    last_picture_update: number;
    username: string;
    email: string;
    nickname: string;
    is_bot: boolean;
    first_name: string;
    last_name: string;
    roles: string;
    auth_data: string;
    auth_service: string;
    position: string;
    allow_marketing: boolean;
    notify_props: CallInfoNotifyProps;
    last_password_update: number;
    locale: string;
    props: CallInfoProps;
    timezone: CallInfoTimezone;
    disable_welcome_email: boolean;
};

export interface CallInfo {
    avatar: string;
    user: CallInfoUser;
    channelID: string;
    conferenceId: string;
    name: string;
    locale: string;
    jwt: string;
}

const log = new Logger('KmeetCallWindow');

/**
 * Opens the given link in an external browser.
 *
 * @param {string} link - The link (URL) that should be opened in the external browser.
 * @returns {void}
 */
export function openExternalLink(link: string) {
    let u;

    try {
        u = url.parse(link);
    } catch (e) {
        return;
    }

    const proto = u.protocol;
    const href = u.href;

    if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') {
        shell.openExternal(href);
    }
}

class KmeetCallWindow {
    private callWindow?: BrowserWindow;
    private callInfo?: CallInfo;

    constructor() {
        ipcMain.handle('get-call-info', () => this.callInfo);
        ipcMain.on(CALL_ENDED, this.handleCallEnded);
        ipcMain.on(CALL_READY_TO_CLOSE, this.handleCallEnded);
        ipcMain.on(CALL_RING_CLOSE_WINDOW, this.handleCloseRingWindow);
        ipcMain.handle(CALL_RING_WINDOW_IS_OPEN, this.handleIsCallWindowOpen);
    }

    buildWindow(callInfo: CallInfo) {
        const mainWindow = MainWindow.get()!;
        const currentServer = ServerViewState!.getCurrentServer();
        const preload = getLocalPreload('call.js');
        const session = mainWindow.webContents.session;

        this.callWindow = new BrowserWindow({
            title: callInfo.name,
            show: true,
            center: true,
            webPreferences: {
                preload,
                session,
                sandbox: true,
                enableBlinkFeatures: 'WebAssemblyCSP',
                contextIsolation: true,

                // Ik: the preload exposes jitsiNodeAPI through the contextBridge and the
                // injected kmeet.js uses no Node APIs — nodeIntegration is gone.
                //
                // Sandbox enabled (upstream jitsi-meet-electron pattern): the bundled
                // call preload is self-contained (only electron + lazy external
                // modules, no top-level Node API use) and validated to boot under
                // sandbox:true. No webSecurity override either: the 6.1.x SDK render
                // modules are postMessage based ("browser-safe") and never touch the
                // cross-origin Jitsi iframe window directly.
            },
        });

        this.callInfo = callInfo;

        const localURL = 'kchat-desktop://renderer/call.html';
        this.callWindow.loadURL(localURL, {
            userAgent: composeUserAgent(),
        }).catch(
            (reason) => {
                log.error(`Call window failed to load: ${reason}`);
            });

        this.callWindow.webContents.on('dom-ready', () => {
            this.callWindow!.moveTop();

            const kmeetScriptURL = `${currentServer.url.toString()}static/kmeet.js`;
            const parsedScriptURL = parseURL(kmeetScriptURL);

            // Ik: never hand an untrusted script URL to the renderer — same allowlist as the
            // renderer-side check (the shared kMeet origin or an official kChat tenant).
            if (!parsedScriptURL || (!isTrustedKmeetURL(parsedScriptURL) && !isOfficialKchatTenantURL(parsedScriptURL))) {
                log.error(`Refusing to load the call script from an untrusted origin: ${kmeetScriptURL}`);
                return;
            }

            this.callWindow!.webContents.send('load-server-url', kmeetScriptURL);
        });

        // Ik: default-deny navigation — the call window is privileged, so only the local
        // call page and the trusted kMeet origin may navigate its main frame.
        this.callWindow.webContents.on('will-navigate', (event, url) => {
            const parsedURL = parseURL(url);
            if (parsedURL && (parsedURL.protocol === 'kchat-desktop:' || isTrustedKmeetURL(parsedURL))) {
                return;
            }

            log.warn(`Prevented the call window from navigating to: ${url}`);
            event.preventDefault();
        });

        // Ik: HTTP redirects must stay on web protocols (upstream jitsi-meet-electron
        // pattern): a call page redirecting to file:// or a custom scheme would
        // bypass the will-navigate allowlist above.
        this.callWindow.webContents.on('will-redirect', (event, url) => {
            const parsedURL = parseURL(url);
            if (parsedURL && ['http:', 'https:', 'ws:', 'wss:'].includes(parsedURL.protocol)) {
                return;
            }

            log.warn(`Prevented the call window from redirecting to: ${url}`);
            event.preventDefault();
        });

        const windowOpenHandler = ({url, frameName}: {url: string; frameName: string}): Electron.WindowOpenHandlerResponse => {
            const target = getPopupTarget(url, frameName);

            if (!target || target === 'browser') {
                openExternalLink(url);

                return {action: 'deny'};
            }

            if (target === 'electron') {
                // Ik: an Electron popup inherits the call window's context — only the trusted
                // kMeet origin and the kMeet SSO authorize popup may open one.
                const parsedURL = parseURL(url);
                if (parsedURL && (isTrustedKmeetURL(parsedURL) || isTrustedKmeetAuthURL(parsedURL))) {
                    return {action: 'allow'};
                }

                log.warn(`Prevented a popup from an untrusted origin in the call window: ${url}`);
                return {action: 'deny'};
            }

            return {action: 'deny'};
        };

        initPopupsConfigurationMain(this.callWindow);
        this.callWindow.webContents.setWindowOpenHandler(windowOpenHandler);
        setupPowerMonitorMain(this.callWindow);
        setupScreenSharingMain(this.callWindow, app.getName(), electronBuilder.appId);
        setupRemoteDrawMain(this.callWindow);
        setupPictureInPictureMain(this.callWindow);

        const withDevTools = Boolean(process.env.MM_DEBUG_SETTINGS) || false;

        // Ik: the kMeet app keeps a mirror <video> (pipVideo) whose stream drives the
        // native Chromium picture-in-picture. The SDK 6.x always-on-top window is gone,
        // so losing focus or minimizing the call window hands the video to a floating
        // native PiP window instead; focusing the window again closes it.
        // executeJavaScript with userGesture=true mirrors the SDK's own main-process
        // PiP path (a minimize/blur carries no user activation, which the element PiP
        // API otherwise requires).
        const requestKmeetPiP = (reason: string) => {
            const win = this.callWindow;
            if (!win || win.isDestroyed()) {
                return;
            }
            log.info(`kmeet PiP requested on ${reason}`);
            const kmeetFrame = win.webContents.mainFrame.frames.find((frame) => frame.name.startsWith('jitsiConferenceFrame'));
            if (!kmeetFrame) {
                log.warn(`kmeet PiP on ${reason}: conference frame not found`);
                return;
            }
            kmeetFrame.executeJavaScript(
                'window.JitsiMeetJS?.app?.electron?.requestPictureInPicture?.()',
                true,
            ).then(() => log.info(`kmeet PiP script executed on ${reason}`)).catch((error) => log.warn(`kmeet PiP on ${reason} failed:`, error));
        };
        const closeKmeetPiP = () => {
            const win = this.callWindow;
            if (!win || win.isDestroyed()) {
                return;
            }
            const kmeetFrame = win.webContents.mainFrame.frames.find((frame) => frame.name.startsWith('jitsiConferenceFrame'));
            kmeetFrame?.executeJavaScript(
                'document.exitPictureInPicture?.()',
                true,
            ).catch((error) => log.warn('kmeet PiP close failed:', error));
        };
        this.callWindow.on('minimize', () => requestKmeetPiP('minimize'));
        this.callWindow.on('blur', () => requestKmeetPiP('blur'));
        this.callWindow.on('restore', closeKmeetPiP);
        this.callWindow.on('focus', closeKmeetPiP);

        if (withDevTools) {
            this.callWindow.webContents.openDevTools({mode: 'detach'});
        }
    }

    create(callInfo: CallInfo) {
        const mainWindow = MainWindow.get();
        const currentServer = ServerViewState!.getCurrentServer();

        if (!mainWindow || !currentServer) {
            log.error('Main window does not exist');
            return;
        }

        if (this.callWindow && !this.callWindow.isDestroyed()) {
            log.info('Call window is already open, focusing on the existing window.');
            this.callWindow.focus();
            return;
        }

        if (this.callWindow) {
            this.callWindow?.on('closed', () => {
                this.buildWindow(callInfo);
            });

            this.destroy();

            return;
        }

        if (CallDialingWindow.isClosable()) {
            this.closeRingWindow();
        }

        this.buildWindow(callInfo);
    }

    destroy() {
        try {
            if (this.callWindow?.closable) {
                this.callWindow?.close();
            }
        } catch (error) {
            log.debug('Kmeet window could not be destroyed', error);
        }

        this.callInfo = undefined;
        this.callWindow = undefined;
    }

    private handleCallEnded = (_: any, message: any) => {
        this.destroy();
        ViewManager.sendToAllViews(CALL_ENDED, message);
    };

    private closeRingWindow = () => {
        CallDialingWindow.destroy();
    };

    private handleCloseRingWindow = () => {
        this.closeRingWindow();
    };

    private handleIsCallWindowOpen = () => {
        return CallDialingWindow.isClosable();
    };
}

const kmeetCallWindow = new KmeetCallWindow();
export default kmeetCallWindow;
