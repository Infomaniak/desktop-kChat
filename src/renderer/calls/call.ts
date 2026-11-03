// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {isOfficialKchatTenantURL, isTrustedKmeetURL, parseURL} from 'common/utils/url';

// Ik: the script URL arrives over IPC and is injected as a remote <script> in a privileged
// window — re-validate its origin here: an untrusted message must be refused, not injected.
function isTrustedScriptURL(src: string) {
    const parsedURL = parseURL(src);
    return Boolean(parsedURL && (isTrustedKmeetURL(parsedURL) || isOfficialKchatTenantURL(parsedURL)));
}

function loadFile(src: string) {
    if (!isTrustedScriptURL(src)) {
        console.error(`Refused to load a script or stylesheet from an untrusted origin: ${src}`);
        return;
    }

    if (src.endsWith('.js')) {
        const script = document.createElement('script');

        script.async = true;
        script.src = src;

        document.head.appendChild(script);
    } else if (src.endsWith('.css')) {
        const link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('type', 'text/css');
        link.setAttribute('href', src);
        document.head.appendChild(link);
    }
}

window.jitsiNodeAPI.onLoadServerUrl((serverUrl) => {
    loadFile(serverUrl);
});
