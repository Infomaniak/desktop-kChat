// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
'use strict';

import ContextMenu from './contextMenu';

jest.mock('electron-context-menu', () => jest.fn(() => jest.fn()));

jest.mock('main/i18nManager', () => ({
    localizeMessage: jest.fn((_, defaultString) => defaultString),
}));

describe('main/contextMenu', () => {
    describe('shouldShowMenu', () => {
        const contextMenu = new ContextMenu({}, {webContents: {}});

        it('should not show menu on internal link', () => {
            expect(contextMenu.menuOptions.shouldShowMenu(null, {
                mediaType: 'none',
                linkURL: 'http://server-1.com/subpath#',
                pageURL: 'http://server-1.com/subpath',
                srcURL: '',
                misspelledWord: '',
                selectionText: '',
            })).toBe(false);
        });

        it('should not show menu on buttons', () => {
            expect(contextMenu.menuOptions.shouldShowMenu(null, {
                mediaType: 'none',
                linkURL: '',
                pageURL: 'http://server-1.com/subpath',
                srcURL: '',
                misspelledWord: '',
                selectionText: '',
            })).toBe(false);
        });

        it('should show menu on editables', () => {
            expect(contextMenu.menuOptions.shouldShowMenu(null, {
                mediaType: 'none',
                linkURL: '',
                pageURL: 'http://server-1.com/subpath',
                srcURL: '',
                misspelledWord: '',
                selectionText: '',
                isEditable: true,
            })).toBe(true);
        });

        it('should show menu on images', () => {
            expect(contextMenu.menuOptions.shouldShowMenu(null, {
                mediaType: 'image',
                linkURL: '',
                pageURL: 'http://server-1.com/subpath',
                srcURL: 'http://server-1.com/subpath/image.png',
                misspelledWord: '',
                selectionText: '',
                isEditable: true,
            })).toBe(true);
        });

        it('should show menu on external links', () => {
            expect(contextMenu.menuOptions.shouldShowMenu(null, {
                mediaType: 'none',
                linkURL: 'http://server-2.com/link',
                pageURL: 'http://server-1.com/subpath',
                srcURL: '',
                misspelledWord: '',
                selectionText: '',
                isEditable: true,
            })).toBe(true);
        });
    });

    describe('reload', () => {
        it('should call dispose on reload', () => {
            const contextMenu = new ContextMenu({}, {webContents: {}});
            const fn = contextMenu.menuDispose;
            contextMenu.reload();
            expect(fn).toHaveBeenCalled();
        });
    });

    describe('localized labels', () => {
        it('should pass labels to electron-context-menu', () => {
            const electronContextMenu = require('electron-context-menu');
            // eslint-disable-next-line no-new
            new ContextMenu({}, {webContents: {}});
            const callArgs = electronContextMenu.mock.calls[0][0];
            expect(callArgs.labels).toBeDefined();
            expect(callArgs.labels.copy).toBe('Copy');
            expect(callArgs.labels.services).toBe('Services');
            expect(callArgs.labels.searchWithGoogle).toBe('Search with Google');
        });

        it('should call localizeMessage for every menu label', () => {
            const {localizeMessage} = require('main/i18nManager');
            localizeMessage.mockClear();
            // eslint-disable-next-line no-new
            new ContextMenu({}, {webContents: {}});
            const keys = localizeMessage.mock.calls.map((c) => c[0]);
            expect(keys).toContain('contextMenu.copy');
            expect(keys).toContain('contextMenu.paste');
            expect(keys).toContain('contextMenu.services');
            expect(keys).toContain('contextMenu.searchWithGoogle');
            expect(keys).toContain('contextMenu.lookUpSelection');
            expect(keys).toContain('contextMenu.copyImage');
            expect(keys).toContain('contextMenu.saveImage');
            expect(keys).toContain('contextMenu.saveImageAs');
            expect(keys).toContain('contextMenu.copyLink');
            expect(keys.length).toBe(17);
        });

        it('should not include inspect label', () => {
            const electronContextMenu = require('electron-context-menu');
            // eslint-disable-next-line no-new
            new ContextMenu({}, {webContents: {}});
            const labels = electronContextMenu.mock.calls[0][0].labels;
            expect(labels.inspect).toBeUndefined();
        });

        it('should set showInspectElement to false', () => {
            const contextMenu = new ContextMenu({}, {webContents: {}});
            expect(contextMenu.menuOptions.showInspectElement).toBe(false);
        });

        it('should use localized strings when localizeMessage returns them', () => {
            const {localizeMessage} = require('main/i18nManager');
            localizeMessage.mockImplementation((key) => {
                if (key === 'contextMenu.copy') {
                    return 'Copier';
                }
                if (key === 'contextMenu.services') {
                    return 'Services';
                }
                return key;
            });
            const electronContextMenu = require('electron-context-menu');
            // eslint-disable-next-line no-new
            new ContextMenu({}, {webContents: {}});
            const labels = electronContextMenu.mock.calls[0][0].labels;
            expect(labels.copy).toBe('Copier');
            expect(labels.services).toBe('Services');
            localizeMessage.mockRestore();
        });
    });
});
