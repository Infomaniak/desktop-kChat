// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
// Copyright (c) 2015-2016

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
'use strict';

// Ik: installs the `window.jitsiElectronSDK` contextBridge surface on the page's
// main world (pip, powermonitor, remotedraw, screensharing fragments). The
// renderer-side SDK hooks that consumed it in earlier SDK versions are gone from
// the preload: the isolated world cannot run them, the screensharing source flow
// is served by the kmeet frame bridge below until the external API moves to the
// page main world.
import {install as installSdkBridge} from '@infomaniak/jitsi-meet-electron-sdk/preload';
import {contextBridge, ipcRenderer} from 'electron';
import type {
    JitsiMeetExternalAPIConstructor,
    ExternalAPIEventCallbacks,
    JitsiMeetExternalAPI as _JitsiMeetExternalAPI,
    ExternalAPIOptions as _ExternalAPIOptions,
    Config as _Config,
} from 'jitsi-meet';

import {CALL_ENDED, CALL_READY_TO_CLOSE} from 'common/communication';
import {KMEET_ORIGIN} from 'common/utils/constants';
import JitsiMeetExternalAPI from 'common/utils/external_api';

// Ik: expose the SDK bridge on the page main world before any page script runs.
installSdkBridge();

const whitelistedIpcChannels = [
    'protocol-data-msg',
    'renderer-ready',
];

interface Config extends _Config {

    // Jitsi's types are missing these fields
    prejoinConfig?: {
        enabled: boolean;
        hideDisplayName?: boolean;
        hideExtraJoinButtons?: string[];
    };
    toolbarButtons?: string[];
    conferenceInfo?: {
        alwaysVIsible?: string[];
        autoHide?: string[];
    };
    disableSelfViewSettings?: boolean;
    localSubject: string;
}

type CallInfo = {
    channelID: string;
    locale: string;
    name: string;
    user: {
        first_name: string;
    };
    jwt: string;
    avatar: string;
}

interface ExternalAPIOptions extends _ExternalAPIOptions {
    configOverwrite?: Config;

    // Jitsi's types are missing these fields
    lang?: string;
    sandbox?: string;
}

let api: _JitsiMeetExternalAPI | undefined;

/**
 * Setup the renderer process.
 *
 * @param {*} selector - CSS selector of the container element (the webapp passes a
 * selector string because the contextBridge can only copy plain values).
 * @param {*} callInfo - Call info object.
 * @returns {void}
 */
function setupRenderer(selector: string, callInfo: CallInfo) {
    const parentNode = document.querySelector(selector);
    if (!parentNode) {
        throw new Error(`kmeet: setupRenderer container not found for selector: ${selector}`);
    }

    const options: ExternalAPIOptions = {
        width: '100%',
        height: '100%',
        roomName: callInfo?.channelID,
        parentNode,
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms',
        userInfo: {
            displayName: callInfo?.user?.first_name,
        },
        configOverwrite: {
            defaultLanguage: callInfo?.locale || 'en',
            startWithVideoMuted: true,
            prejoinPageEnabled: false,
            localSubject: callInfo.name,
            disableInviteFunctions: true,
            disableAGC: true,
        },
        jwt: callInfo.jwt,
    };

    api = new (JitsiMeetExternalAPI as JitsiMeetExternalAPIConstructor)(KMEET_ORIGIN, options);

    setupKmeetScreenShareBridge(api);

    api.executeCommand('avatarUrl', callInfo.avatar);

    api.on('videoConferenceLeft', () => ipcRenderer.send(CALL_ENDED, callInfo));
    api.on('errorOccurred', onErrorOccurred);

    api.on('readyToClose', () => {
        console.log('call ready to close from prejoin');
        ipcRenderer.send(CALL_READY_TO_CLOSE);
    });

    return api;
}

const onErrorOccurred = ({error}: Parameters<ExternalAPIEventCallbacks['errorOccurred']>[0]): void => {
    if (error.isFatal) {
        console.log(error);

        ipcRenderer.send(CALL_READY_TO_CLOSE);
    }
};

// Ik: the kMeet frame asks the host for desktop sources (and macOS capture
// permissions) through window.JitsiMeetElectron — historically injected by the SDK
// with a cross-origin write that cannot work with contextIsolation + webSecurity on.
// The bridge lives in the preload (isolated world): requests arrive as window
// messages from the kMeet frame, are routed to fixed IPC channels and answered back
// to the frame that asked. Only the Jitsi iframe of the trusted kMeet origin may ask,
// and only these fixed channels are reachable.
const kmeetScreenShareChannels = {
    'get-sources': 'jitsi-screen-sharing-get-sources',
    'screen-permissions': 'screen-share-permissions',
    'open-screen-permission-settings': 'open-screen-permission-settings',
    'open-permission-settings': 'open-permission-settings',
};

// Ik: ipc results may embed Electron values (NativeImage thumbnails of the desktop
// sources) that structured-clone cannot cross a postMessage boundary — keep plain
// data, turning images into data URLs so previews still work.
function sanitizeForBridge(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (value && typeof value === 'object' && typeof (value as {toDataURL?: unknown}).toDataURL === 'function') {
        try {
            return (value as {toDataURL: () => string}).toDataURL();
        } catch {
            return undefined;
        }
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeForBridge(entry) ?? null);
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            const sanitized = sanitizeForBridge(entry);
            if (sanitized !== undefined) {
                out[key] = sanitized;
            }
        }
        return out;
    }
    return undefined;
}

function setupKmeetScreenShareBridge(apiInstance: _JitsiMeetExternalAPI) {
    const iframeWindow = (apiInstance.getIFrame() as unknown as HTMLIFrameElement).contentWindow;

    window.addEventListener('message', (event) => {
        const data = event.data as {__kmeetBridge?: string; id?: string; kind?: string; payload?: unknown} | null;
        if (!data || data.__kmeetBridge !== 'request' || !data.id || !data.kind) {
            return;
        }

        // only the kMeet frame may drive these channels
        if (!iframeWindow || event.source !== iframeWindow) {
            return;
        }

        const channel = kmeetScreenShareChannels[data.kind as keyof typeof kmeetScreenShareChannels];
        if (!channel) {
            return;
        }

        ipcRenderer.invoke(channel, data.payload).then(
            (result) => event.source?.postMessage({__kmeetBridge: 'reply', id: data.id, result: sanitizeForBridge(result)}, '*'),
            (error) => event.source?.postMessage({__kmeetBridge: 'reply', id: data.id, error: String((error as Error)?.message ?? error)}, '*'),
        );
    });
}

// Ik: exposed through the contextBridge so the call window can run with
// contextIsolation: true and no nodeIntegration — the page only sees this
// narrow surface, everything else (SDK modules, ipcRenderer) stays in the
// isolated preload world.
// ik: legacy lint error
/* eslint-disable */
contextBridge.exposeInMainWorld('jitsiNodeAPI', {

    // Ik: feature-detection flag for the webapp — the desktop resolves the
    // container itself from the selector (a DOM element cannot cross the bridge).
    setupRendererAcceptsSelector: true,

    // @ts-expect-error legacy type error
    setupRenderer: (selector: string, callInfo: CallInfo) => {
        setupRenderer(selector, callInfo);
    },

    // @ts-expect-error legacy type error
    getCallInfo: () => ipcRenderer.invoke('get-call-info'),
    onLoadServerUrl: (listener) => ipcRenderer.on('load-server-url', (_, url) => listener(url)),
    ipc: {

        on: (channel: any, listener: any) => {
            if (!whitelistedIpcChannels.includes(channel)) {
                return;
            }

            return ipcRenderer.on(channel, listener);
        },
        send: (channel: any) => {
            if (!whitelistedIpcChannels.includes(channel)) {
                return;
            }

            return ipcRenderer.send(channel);
        },
        removeListener: (channel: any, listener: any) => {
            if (!whitelistedIpcChannels.includes(channel)) {
                return;
            }

            return ipcRenderer.removeListener(channel, listener);
        },
    },
});
/* eslint-disable */

