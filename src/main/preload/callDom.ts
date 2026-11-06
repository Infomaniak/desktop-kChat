// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export function resolveParentNode(parentNodeOrSelector: string | Element): Element | null {
    return typeof parentNodeOrSelector === 'string' ? document.querySelector(parentNodeOrSelector) : parentNodeOrSelector;
}
