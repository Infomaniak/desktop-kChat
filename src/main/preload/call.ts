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
import {setupRemoteDrawRender} from '@infomaniak/jitsi-meet-electron-sdk/renderer';
import {contextBridge, ipcRenderer, log} from 'electron';
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
    setupKmeetScreenSharePicker(api);
    setupKmeetRemoteDraw(api);

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

// Ik: 6.1.x screensharing protocol relay. The SDK's page-side picker hook cannot run
// here (the external API lives in this isolated world), so the preload wires the flow:
// when the main process starts a getDisplayMedia request it asks the page for a picker,
// we forward it to the kMeet app over the external API transport
// (open-desktop-picker request → the app opens its own source picker), the app then
// asks for the source list through the _request-desktop-sources transport request which
// we answer from the SDK get-sources channel, and the app's selection comes back as the
// picker request response, relayed to the main process as do-gdm.
const kmeetGdmMarkerChannel = 'jitsi-screen-sharing-marker';
const kmeetGdmGetSourcesChannel = 'jitsi-screen-sharing-get-sources';

function sanitizeSourcesForApp(sources: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return sources.map((source) => {
        const thumbnail = source.thumbnail as {toDataURL?: () => string} | undefined;
        const dataUrl = typeof thumbnail?.toDataURL === 'function' ? thumbnail.toDataURL() : undefined;

        // The kMeet picker reads either `thumbnailURL` (legacy shape) or
        // `thumbnail.dataUrl` (6.1.x bridge shape); expose both.
        return {
            ...source,
            thumbnailURL: dataUrl,
            thumbnail: dataUrl ? {dataUrl} : undefined,
        };
    });
}

type KmeetApiTransport = {
    on: (event: string, listener: (payload: unknown, callback: unknown) => void) => void;
    sendRequest: (request: {name: string}) => Promise<Record<string, unknown>>;
};

function setupKmeetScreenSharePicker(apiInstance: _JitsiMeetExternalAPI) {
    const transport = (apiInstance as unknown as {_transport: KmeetApiTransport})._transport;

    // The kMeet picker asks for the source list over the external API transport.
    transport.on('request', (payload, respond) => {
        const request = payload as {name?: string; options?: unknown} | null;
        if (request?.name === '_new_electron_screensharing_supported') {
            // Ik: tells the kMeet app to use the getDisplayMedia-based flow instead of
            // the legacy window.JitsiMeetElectron path.
            (respond as unknown as (r: unknown) => void)(true);
            return;
        }
        if (request?.name !== '_request-desktop-sources') {
            return;
        }
        const options = request.options ?? {types: ['screen', 'window'], thumbnailSize: {width: 320, height: 180}};
        ipcRenderer.invoke(kmeetGdmGetSourcesChannel, options).then(
            (sources) => (respond as unknown as (r: unknown) => void)({sources: sanitizeSourcesForApp(sources)}),
            (error) => (respond as unknown as (r: unknown) => void)({error: String((error as Error)?.message ?? error)}),
        );
    });

    // The main process signals that a getDisplayMedia request waits for a source.
    ipcRenderer.on(kmeetGdmMarkerChannel, (_event, payload) => {
        const marker = payload as {data?: {name?: string; requestId?: number}} | null;
        if (marker?.data?.name !== 'open-picker' || typeof marker.data.requestId !== 'number') {
            return;
        }
        const {requestId} = marker.data;
        transport.sendRequest({name: 'open-desktop-picker'}).then(
            (result) => ipcRenderer.send(kmeetGdmMarkerChannel, {data: {name: 'do-gdm', requestId, ...result}}),
            () => ipcRenderer.send(kmeetGdmMarkerChannel, {data: {name: 'do-gdm', requestId, source: null}}),
        );
    });
}

// Ik: 6.1.x remote-draw (draw on the shared screen) relay. The SDK page-side hook
// cannot run here, so the preload shims the `window.jitsiElectronSDK.remoteDraw`
// bridge surface (same IPC channels as the SDK preload bridge) in the isolated
// world and instantiates the SDK renderer hook against it. The hook opens a
// `jitsi-remote-draw` postis channel to the kMeet frame and announces
// "supported", which is what lets the app activate its draw receiver and
// advertise the http://jitsi.org/meet/remotedraw presence feature that enables
// the drawing button while a screen share is active.
function setupKmeetRemoteDraw(apiInstance: _JitsiMeetExternalAPI): void {
    const drawMarker = 'jitsi-screen-sharing-draw-marker';
    const remoteDrawBridge = {
        platform: process.platform,
        start: (sourceId: string) => {
            log.info(`[kmeet-draw] start invoked, sourceId: ${sourceId}`);

            return sourceId ? ipcRenderer.invoke('jitsi-remotedraw-start', sourceId) : undefined;
        },
        getDisplay: (sourceId: string) => {
            log.info(`[kmeet-draw] getDisplay invoked, sourceId: ${sourceId}`);

            return sourceId ? ipcRenderer.invoke('jitsi-remotedraw-get-display', sourceId) : undefined;
        },
        sendEvent: (data: unknown, display: unknown) => {
            log.info(`[kmeet-draw] sendEvent: ${JSON.stringify(data).slice(0, 140)}`);
            ipcRenderer.send(drawMarker, {data, display});
        },
        onDrawEvent: (callback: (payload: unknown) => void) => {
            const listener = (_event: unknown, payload: unknown) => callback(payload);
            ipcRenderer.on(drawMarker, listener);

            return () => ipcRenderer.removeListener(drawMarker, listener);
        },
        onDisplaysChanged: (callback: () => void) => {
            const listener = () => callback();
            ipcRenderer.on('jitsi-remotedraw-displays-changed', listener);

            return () => ipcRenderer.removeListener('jitsi-remotedraw-displays-changed', listener);
        },
    };

    const isolatedWindow = window as unknown as {jitsiElectronSDK?: Record<string, unknown>};
    isolatedWindow.jitsiElectronSDK = {...isolatedWindow.jitsiElectronSDK, remoteDraw: remoteDrawBridge};

    setupRemoteDrawRender(apiInstance);
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

