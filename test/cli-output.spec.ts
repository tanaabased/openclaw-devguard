import assert from 'node:assert/strict';

import {
  createCliStyles,
  formatCliAction,
  formatCliError,
  formatCliField,
  formatCliStatus,
  formatCliTarget,
  writeCliLines,
} from '../lib/cli-output.ts';

describe('lib/cli-output', () => {
  it('should render readable lowercase summaries without color', () => {
    const styles = createCliStyles({ NO_COLOR: '' });

    assert.deepEqual(
      [
        formatCliAction('initialized', 'openclaw-devguard', styles),
        formatCliTarget('project', '/tmp/example', styles),
        formatCliField('config', 'created', styles),
        formatCliStatus('ready', 'openclaw-devguard', styles),
      ],
      [
        'initialized  openclaw-devguard',
        'project      /tmp/example',
        'config       created',
        'ready        openclaw-devguard',
      ],
    );
  });

  it('should apply semantic and brand styles only to owned tokens', () => {
    const styles = createCliStyles({ FORCE_COLOR: '3' });
    const action = formatCliAction('initialized', 'openclaw-devguard', styles);
    const status = formatCliStatus('ready', 'openclaw-devguard', styles);
    const error = formatCliError('error', 'unsafe configuration', styles);

    assert.ok(action.includes('\u001B[38;2;0;200;138m'));
    assert.ok(action.includes('\u001B[38;2;219;39;119m'));
    assert.ok(status.includes('\u001B[1m'));
    assert.ok(status.includes('\u001B[32m'));
    assert.ok(status.includes('\u001B[38;2;219;39;119m'));
    assert.ok(error.includes('\u001B[31m'));
  });

  it('should give NO_COLOR precedence over forced color', () => {
    const styles = createCliStyles({ FORCE_COLOR: '3', NO_COLOR: '' });

    assert.equal(
      formatCliStatus('ready', 'openclaw-devguard', styles),
      'ready        openclaw-devguard',
    );
  });

  it('should write one newline-terminated summary', () => {
    const writes: string[] = [];

    writeCliLines({ writeStdout: (value) => writes.push(value) }, ['first', 'second']);

    assert.deepEqual(writes, ['first\nsecond\n']);
  });
});
