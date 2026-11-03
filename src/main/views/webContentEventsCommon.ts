// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import path from 'path';

import type {Event, WebContentsConsoleMessageEventParams, WebContentsWillFrameNavigateEventParams} from 'electron';

import type {Logger} from 'common/log';
import {getLevel} from 'common/log';
import {parseURL} from 'common/utils/url';

import {protocols} from '../../../electron-builder.json';

export const generateHandleConsoleMessage = (log: Logger) => (event: Event<WebContentsConsoleMessageEventParams>) => {
    const wcLog = log.withPrefix('renderer');
    let logFn = wcLog.debug;
    switch (event.level) {
    case 'error':
        logFn = wcLog.error;
        break;
    case 'warning':
        logFn = wcLog.warn;
        break;
    }

    // Only include line entries if we're debugging
    const entries = [event.message];
    if (['debug', 'silly'].includes(getLevel())) {
        entries.push(`(${path.basename(event.sourceId)}:${event.lineNumber})`);
    }

    logFn(...entries);
};

export function isCustomProtocol(url: URL) {
    const scheme = protocols && protocols[0] && protocols[0].schemes && protocols[0].schemes[0];
    return url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== `${scheme}:`;
}

export function isMattermostProtocol(url: URL) {
    const scheme = protocols && protocols[0] && protocols[0].schemes && protocols[0].schemes[0];
    return url.protocol === `${scheme}:`;
}

// Ik: subframes may only navigate over http(s); protocol-less document URLs (programmatic
// and srcdoc iframes) stay allowed. Nested frames must not become an escape hatch around
// the main-frame navigation policy.
const ALLOWED_SUBFRAME_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_SUBFRAME_URLS = new Set(['about:blank', 'about:srcdoc']);

export function isAllowedSubframeNavigation(rawURL?: string): boolean {
    if (!rawURL || ALLOWED_SUBFRAME_URLS.has(rawURL)) {
        return true;
    }

    const parsedURL = parseURL(rawURL);
    if (!parsedURL) {
        return false;
    }

    return ALLOWED_SUBFRAME_PROTOCOLS.has(parsedURL.protocol);
}

export const generateWillFrameNavigate = (log: Logger) => (event: Event<WebContentsWillFrameNavigateEventParams>) => {
    // will-frame-navigate also fires for the main frame; defer that to will-navigate
    // so the policy does not run twice.
    if (event.isMainFrame) {
        return;
    }

    if (isAllowedSubframeNavigation(event.url)) {
        return;
    }

    log.debug('Prevented subframe from navigating to a blocked protocol');
    event.preventDefault();
};
