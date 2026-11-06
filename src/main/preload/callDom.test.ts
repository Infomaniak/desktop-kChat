// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {resolveParentNode} from './callDom';

describe('resolveParentNode', () => {
    it('keeps a DOM element passed by the legacy kMeet webapp', () => {
        const parentNode = {nodeName: 'DIV', nodeType: 1} as Element;
        const querySelector = jest.fn();
        global.document = {querySelector} as unknown as Document;

        expect(resolveParentNode(parentNode)).toBe(parentNode);
        expect(querySelector).not.toHaveBeenCalled();
    });

    it('resolves a selector passed by the isolated-bridge webapp', () => {
        const parentNode = {nodeType: 1} as Element;
        const querySelector = jest.fn().mockReturnValue(parentNode);
        global.document = {querySelector} as unknown as Document;

        expect(resolveParentNode('#kmeet')).toBe(parentNode);
        expect(querySelector).toHaveBeenCalledWith('#kmeet');
    });
});
