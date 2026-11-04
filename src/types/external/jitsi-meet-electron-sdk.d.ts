/* eslint-disable header/header */

declare module '@infomaniak/jitsi-meet-electron-sdk/main' {
    import type {BrowserWindow} from 'electron';

    export function getPopupTarget(url: string, frameName: string): string | undefined;
    export function initPopupsConfigurationMain(window: BrowserWindow): void;
    export function setupPictureInPictureMain(window: BrowserWindow): void;
    export function setupPowerMonitorMain(window: BrowserWindow): void;
    export function setupRemoteControlMain(window: BrowserWindow): void;
    export function setupRemoteDrawMain(window: BrowserWindow): void;
    export function setupScreenSharingMain(window: BrowserWindow, identity: string, osxBundleId: string): void;
    export function cleanupPowerMonitorMain(window: BrowserWindow): void;

    export interface PopupsConfigRegistry {
    }

    export const popupsConfigRegistry: PopupsConfigRegistry;
}

declare module '@infomaniak/jitsi-meet-electron-sdk/preload' {
    export function install(): void;
}

// Ik: 6.1.x renderer hooks run in the page main world; the kchat call window keeps
// its screensharing bridge in the preload until the external API is migrated to the
// main world, so these are declared but unused.
declare module '@infomaniak/jitsi-meet-electron-sdk/renderer' {
    import type {_JitsiMeetExternalAPI} from 'jitsi-meet';

    export function initPopupsConfigurationRender(api: _JitsiMeetExternalAPI): void;
    export function setupPictureInPictureRender(api: _JitsiMeetExternalAPI): void;
    export function setupPowerMonitorRender(api: _JitsiMeetExternalAPI): void;
    export function setupRemoteControlRender(api: _JitsiMeetExternalAPI): void;
    export function setupRemoteDrawRender(api: _JitsiMeetExternalAPI): void;
    export function setupScreenSharingRender(api: _JitsiMeetExternalAPI): void;
}
