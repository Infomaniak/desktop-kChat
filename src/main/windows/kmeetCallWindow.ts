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
import {app, BrowserWindow, ipcMain, shell, systemPreferences, webFrameMain} from 'electron';

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

type ApplePrivacyAnchor =
    | 'LocationServices'
    | 'Contacts'
    | 'Calendars'
    | 'Reminders'
    | 'Photos'
    | 'Camera'
    | 'Microphone'
    | 'SpeechRecognition'
    | 'Accessibility'
    | 'AllFiles'
    | 'Automation'
    | 'Diagnostics'
    | 'Advertising'
    | 'AppleIntelligenceReport'
    | 'DevTools'
    | 'NudityDetection'
    | 'Location'
    | 'SystemServices'
    | 'ScreenCapture'
    | 'AudioCapture'
    | 'Analytics'
    | 'FilesAndFolders'
    | 'DesktopFolder'
    | 'DocumentsFolder'
    | 'DownloadsFolder'
    | 'NetworkVolume'
    | 'RemovableVolume'
    | 'Pasteboard'

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

function openScreenSettings(anchor?: ApplePrivacyAnchor) {
    const privacyAnchor = anchor ? `?Privacy_${anchor}` : '';
    const link = `x-apple.systempreferences:com.apple.preference.security${privacyAnchor}`;
    return shell.openExternal(link);
}

// Ik: the screensharing bridge the kMeet app expects at window.JitsiMeetElectron
// (same surface as the SDK's render hook), relayed over window messages to the call
// window preload, which owns the IPC channels. Injected from the main process into
// the kMeet frame because the SDK's cross-origin write cannot survive
// contextIsolation + webSecurity.
const kmeetFrameBridgeScript = `
(() => {
    if (window.JitsiMeetElectron) {
        return;
    }
    let seq = 0;
    const pending = new Map();
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.__kmeetBridge !== 'reply' || !data.id || !pending.has(data.id)) {
            return;
        }
        const entry = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) {
            entry.reject(new Error(String(data.error)));
        } else {
            entry.resolve(data.result);
        }
    });
    const request = (kind, payload) => new Promise((resolve, reject) => {
        const id = String(Date.now()) + '-' + (seq++);
        pending.set(id, {resolve, reject});
        window.parent.postMessage({__kmeetBridge: 'request', id, kind, payload}, '*');
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error('kmeet bridge timeout: ' + kind));
            }
        }, 30000);
    });
    window.JitsiMeetElectron = {
        obtainDesktopStreams: (callback, errorCallback, options) => request('get-sources', options).then((result) => {
            // Ik: thumbnails cross the postMessage relay as data-URL strings — restore
            // the SDK's NativeImage-like surface the app expects ({toDataURL()}).
            const sources = (result || []).map((source) => (typeof source.thumbnail === 'string' ? {...source, thumbnail: {toDataURL: () => source.thumbnail}} : source));
            callback(sources);
        }).catch((error) => errorCallback(error)),
        getScreenPermissions: (callback, errorCallback) => request('screen-permissions').then((result) => callback(result)).catch((error) => errorCallback(error)),
        openMacScreenPermissionSettings: (callback, errorCallback) => request('open-screen-permission-settings').then((result) => callback && callback(result)).catch((error) => errorCallback && errorCallback(error)),
        openMacPermissionSettings: (callback, errorCallback, anchor) => request('open-permission-settings', anchor).then((result) => callback && callback(result)).catch((error) => errorCallback && errorCallback(error)),
    };
})();
`;

class KmeetCallWindow {
    private callWindow?: BrowserWindow;
    private callInfo?: CallInfo;

    constructor() {
        ipcMain.handle('get-call-info', () => this.callInfo);
        ipcMain.handle('screen-share-permissions', () => {
            log.debug('getMediaAccessStatus screen', systemPreferences.getMediaAccessStatus('screen'));
            return systemPreferences.getMediaAccessStatus('screen');
        });
        ipcMain.handle('open-screen-permission-settings', () => {
            return openScreenSettings('ScreenCapture');
        });
        ipcMain.handle('open-permission-settings', (_event, anchor?: ApplePrivacyAnchor) => {
            return openScreenSettings(anchor);
        });
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
                sandbox: false,
                enableBlinkFeatures: 'WebAssemblyCSP',
                contextIsolation: true,

                // Ik: the preload exposes jitsiNodeAPI through the contextBridge and the
                // injected kmeet.js uses no Node APIs — nodeIntegration is gone. This
                // webSecurity remains for the Jitsi SDK cross-origin iframes (powermonitor,
                // remotedraw); tracked for a separate A/B evaluation.
                webSecurity: false,
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

        // Ik: the kMeet frame expects window.JitsiMeetElectron (the SDK's screensharing
        // bridge). The SDK injects it with a cross-origin write that cannot survive
        // contextIsolation + webSecurity on, so the main process injects an equivalent
        // bridge whose calls are relayed to the preload over window messages.
        this.callWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
            if (isMainFrame) {
                return;
            }
            const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
            const frameURL = frame ? parseURL(frame.url) : undefined;
            if (!frame || !frameURL || !isTrustedKmeetURL(frameURL)) {
                return;
            }
            frame.executeJavaScript(kmeetFrameBridgeScript).catch((error) => log.warn('kmeet bridge injection failed:', error));
        });

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
