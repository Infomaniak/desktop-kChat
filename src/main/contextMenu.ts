// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {BrowserWindow, BrowserView, WebviewTag, WebContents, ContextMenuParams, Event} from 'electron';
import type {Labels, Options} from 'electron-context-menu';
import electronContextMenu from 'electron-context-menu';

import {parseURL} from 'common/utils/url';
import {localizeMessage} from 'main/i18nManager';

const getLocalizedLabels = (): Labels => ({
    learnSpelling: localizeMessage('contextMenu.learnSpelling', 'Learn Spelling'),
    lookUpSelection: localizeMessage('contextMenu.lookUpSelection', 'Look Up \u201c{selection}\u201d'),
    searchWithGoogle: localizeMessage('contextMenu.searchWithGoogle', 'Search with Google'),
    cut: localizeMessage('contextMenu.cut', 'Cut'),
    copy: localizeMessage('contextMenu.copy', 'Copy'),
    paste: localizeMessage('contextMenu.paste', 'Paste'),
    selectAll: localizeMessage('contextMenu.selectAll', 'Select All'),
    saveImage: localizeMessage('contextMenu.saveImage', 'Save Image'),
    saveImageAs: localizeMessage('contextMenu.saveImageAs', 'Save Image As\u2026'),
    saveVideo: localizeMessage('contextMenu.saveVideo', 'Save Video'),
    saveVideoAs: localizeMessage('contextMenu.saveVideoAs', 'Save Video As\u2026'),
    copyLink: localizeMessage('contextMenu.copyLink', 'Copy Link'),
    saveLinkAs: localizeMessage('contextMenu.saveLinkAs', 'Save Link As\u2026'),
    copyImage: localizeMessage('contextMenu.copyImage', 'Copy Image'),
    copyImageAddress: localizeMessage('contextMenu.copyImageAddress', 'Copy Image Address'),
    copyVideoAddress: localizeMessage('contextMenu.copyVideoAddress', 'Copy Video Address'),
    services: localizeMessage('contextMenu.services', 'Services'),
});

const defaultMenuOptions = {
    shouldShowMenu: (e: Event, p: ContextMenuParams) => {
        const isInternalLink = p.linkURL.endsWith('#') && p.linkURL.slice(0, -1) === p.pageURL;
        let isInternalSrc;
        try {
            const srcurl = parseURL(p.srcURL);
            isInternalSrc = srcurl?.protocol === 'kchat-desktop:';
        } catch (err) {
            isInternalSrc = false;
        }
        return p.isEditable || (p.mediaType !== 'none' && !isInternalSrc) || (p.linkURL !== '' && !isInternalLink) || p.misspelledWord !== '' || p.selectionText !== '';
    },
    showLookUpSelection: true,
    showSearchWithGoogle: true,
    showCopyImage: true,
    showSaveImage: true,
    showSaveImageAs: true,
    showServices: true,
    showInspectElement: false,
};

export default class ContextMenu {
    view: BrowserWindow | BrowserView | WebviewTag | WebContents;
    menuOptions: Options;
    menuDispose?: () => void;

    constructor(options: Options, view: BrowserWindow | WebContents) {
        const providedOptions: Options = options || {};

        this.menuOptions = Object.assign({}, defaultMenuOptions, providedOptions);
        this.view = view;

        this.reload();
    }

    dispose = () => {
        if (this.menuDispose) {
            this.menuDispose();
            delete this.menuDispose;
        }
    };

    reload = () => {
        this.dispose();

        const options = {window: this.view, labels: getLocalizedLabels(), ...this.menuOptions};
        this.menuDispose = electronContextMenu(options);
    };
}
