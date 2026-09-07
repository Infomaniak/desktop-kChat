// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

'use strict';

import {TOGGLE_LOADING_SCREEN_VISIBILITY} from 'common/communication';
import MainWindow from 'main/windows/mainWindow';

import {LoadingScreen} from './loadingScreen';

jest.mock('electron', () => {
    const mockEmitter = jest.requireActual('events');
    return {
        app: {
            getPath: jest.fn(),
        },
        ipcMain: {
            on: jest.fn(),
        },
        WebContentsView: jest.fn().mockImplementation(() => {
            const mockWebContents = new mockEmitter();
            mockWebContents.send = jest.fn();
            mockWebContents.loadURL = jest.fn();
            mockWebContents.isLoading = jest.fn();
            mockWebContents.close = jest.fn();
            return {
                webContents: mockWebContents,
                setBounds: jest.fn(),
            };
        }),
    };
});

jest.mock('main/performanceMonitor', () => ({
    registerView: jest.fn(),
}));
jest.mock('main/utils', () => ({
    getLocalPreload: jest.fn(),
}));
jest.mock('main/views/modalManager', () => ({
    isModalDisplayed: jest.fn(() => false),
}));
jest.mock('main/windows/mainWindow', () => ({
    on: jest.fn(),
    get: jest.fn(),
}));

describe('main/views/loadingScreen', () => {
    let mainWindow;
    let loadingScreen;

    beforeEach(() => {
        mainWindow = {
            contentView: {
                addChildView: jest.fn(),
                removeChildView: jest.fn(),
                children: [],
            },
            getContentBounds: jest.fn(() => ({width: 800, height: 600})),
        };
        MainWindow.get.mockReturnValue(mainWindow);
        loadingScreen = new LoadingScreen();
    });

    describe('show', () => {
        it('should add the loading screen view when not loading', () => {
            loadingScreen.show();

            expect(loadingScreen.view.webContents.send).toHaveBeenCalledWith(TOGGLE_LOADING_SCREEN_VISIBILITY, true);
            expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(loadingScreen.view);
        });

        it('should add the loading screen view after loading finishes', () => {
            // First show creates the view
            loadingScreen.show();

            // Simulate that the view is still loading on next show
            loadingScreen.view.webContents.isLoading.mockReturnValue(true);
            loadingScreen.view.webContents.send.mockClear();
            mainWindow.contentView.addChildView.mockClear();

            loadingScreen.show();

            loadingScreen.view.webContents.emit('did-finish-load');

            expect(loadingScreen.view.webContents.send).toHaveBeenCalledWith(TOGGLE_LOADING_SCREEN_VISIBILITY, true);
            expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(loadingScreen.view);
        });

        it('should not re-add the loading screen view if fade() was called before did-finish-load', () => {
            // First show creates the view
            loadingScreen.show();

            // Simulate that the view is still loading on next show
            loadingScreen.view.webContents.isLoading.mockReturnValue(true);
            loadingScreen.view.webContents.send.mockClear();
            mainWindow.contentView.addChildView.mockClear();

            loadingScreen.show();

            // Simulate fade() being called before did-finish-load fires
            loadingScreen.fade();

            // Now did-finish-load fires
            loadingScreen.view.webContents.emit('did-finish-load');

            // The view should NOT be re-added since state is no longer VISIBLE
            expect(loadingScreen.view.webContents.send).not.toHaveBeenCalledWith(TOGGLE_LOADING_SCREEN_VISIBILITY, true);
            expect(mainWindow.contentView.addChildView).not.toHaveBeenCalled();
        });
    });
});
