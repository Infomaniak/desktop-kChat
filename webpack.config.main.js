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
        '@infomaniak/jitsi-meet-electron-sdk': 'require("@infomaniak/jitsi-meet-electron-sdk")',
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
                // directory (`file://${__dirname}/remoteDraw.html`); ship it.
                {
                    from: 'node_modules/@infomaniak/jitsi-meet-electron-sdk/remotedraw/remoteDraw.*',
                    to: '[name][ext]',
                },
            ],
        }),
    ],
    node: {
        // Ik: real paths — the SDK's remote-draw overlay loads its html with
        // `file://${__dirname}/remoteDraw.html`; the fake relative path made
        // that URL resolve against the drive root and fail (ERR_FAILED).
        __filename: false,
        __dirname: false,
    },
    target: 'electron-main',
});
