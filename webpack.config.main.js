// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
// Copyright (c) 2015-2016 Yuya Ochiai

const CopyPlugin = require('copy-webpack-plugin');
const {merge} = require('webpack-merge');

const base = require('./webpack.config.base');

module.exports = merge(base, {
    entry: {
        index: './src/main/app/index.ts',
    },
    externals: {
        'macos-notification-state': 'require("macos-notification-state")',
        'windows-focus-assist': 'require("windows-focus-assist")',
        '@sentry/electron': 'require("@sentry/electron")',

        // Ik: the bare '@infomaniak/jitsi-meet-electron-sdk' entry was removed: all
        // imports use subpaths ('.../main', '.../preload', '.../renderer') that an
        // exact-match external never matched, so the SDK was silently bundled. If it
        // should become external again, use a regex — and note its __dirname would
        // then resolve inside node_modules, making the remote-draw overlay CopyPlugin
        // block below redundant (packaged asar build untested with that layout).
    },
    externalsPresets: {
        electronMain: true,
    },
    module: {
        noParse: /external_api\\.js/,
        rules: [{
            test: /\.node$/,
            loader: 'node-loader',
        }],
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: 'assets/**/*',
                    context: 'src',
                },

                // Ik: the SDK remote-draw overlay loads its html from the main bundle
                // directory (`file://${__dirname}/remoteDraw.html`); ship it. The
                // SDK main also resolves the overlay's preload at
                // `path.resolve(__dirname, './preload.js')` — without it the
                // overlay never exposes window.JitsiRemoteDraw and the marker
                // canvas stays empty.
                {
                    from: 'node_modules/@infomaniak/jitsi-meet-electron-sdk/remotedraw/remoteDraw.*',
                    to: '[name][ext]',
                },
                {
                    from: 'node_modules/@infomaniak/jitsi-meet-electron-sdk/remotedraw/preload.js',
                    to: 'preload.js',
                },

                // The shipped overlay preload requires `./constants` relative to
                // its own file, so the constants module must sit next to it.
                {
                    from: 'node_modules/@infomaniak/jitsi-meet-electron-sdk/remotedraw/constants.js',
                    to: 'constants.js',
                },
            ],
        }),
    ],
    node: {
        __filename: false,
        __dirname: false,

        // Ik: real paths — the SDK's remote-draw overlay loads its html with
        // `file://${__dirname}/remoteDraw.html`; the fake relative path made
        // that URL resolve against the drive root and fail (ERR_FAILED).
    },
    target: 'electron-main',
});
