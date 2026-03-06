import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWsServer } from './ws-server.js';
function createServer() {
    const fakeSessionManager = {
        getSession() {
            return {};
        },
    };
    return new BrowserWsServer({ sessionManager: fakeSessionManager });
}
test('rejects legacy selector actions in node_execute', async () => {
    const server = createServer();
    const clickResult = await server.handleNodeExecute('profile-a', {
        command_type: 'node_execute',
        node_type: 'click',
        parameters: { selector: '#submit' },
    });
    const typeResult = await server.handleNodeExecute('profile-a', {
        command_type: 'node_execute',
        node_type: 'type',
        parameters: { selector: '#search', text: 'hello' },
    });
    assert.equal(clickResult.success, false);
    assert.equal(clickResult.code, 'LEGACY_ACTION_DISABLED');
    assert.match(clickResult.error, /node_execute/);
    assert.match(clickResult.error, /mouse:\*/);
    assert.equal(typeResult.success, false);
    assert.equal(typeResult.code, 'LEGACY_ACTION_DISABLED');
    assert.match(typeResult.error, /node_execute/);
    assert.match(typeResult.error, /keyboard:\*/);
});
test('rejects legacy selector actions in user_action.operation', async () => {
    const server = createServer();
    const clickResult = await server.handleUserAction('profile-a', {
        command_type: 'user_action',
        action: 'operation',
        parameters: {
            operation_type: 'click',
            target: { selector: '#submit' },
        },
    });
    const typeResult = await server.handleUserAction('profile-a', {
        command_type: 'user_action',
        action: 'operation',
        parameters: {
            operation_type: 'type',
            target: { selector: '#search' },
            text: 'hello',
        },
    });
    assert.equal(clickResult.success, false);
    assert.equal(clickResult.code, 'LEGACY_ACTION_DISABLED');
    assert.match(clickResult.error, /user_action\.operation/);
    assert.equal(typeResult.success, false);
    assert.equal(typeResult.code, 'LEGACY_ACTION_DISABLED');
    assert.match(typeResult.error, /user_action\.operation/);
});
//# sourceMappingURL=ws-server.test.js.map