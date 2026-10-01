// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Build with KCHAT_PREPROD=true to target the preprod environment.
export const isPreprod = process.env.KCHAT_PREPROD === 'true';

export const tokenApiEndpoint = isPreprod ? 'https://login.preprod.dev.infomaniak.ch/token' : 'https://login.infomaniak.com/token';
export const IKOrigin = isPreprod ? 'https://kchat.preprod.dev.infomaniak.ch' : 'https://kchat.infomaniak.com';
export const devServerUrl = isPreprod ? 'https://infomaniak.kchat.preprod.dev.infomaniak.ch' : '';
export const isLocalEnv = false;
