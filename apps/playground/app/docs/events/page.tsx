import type { Metadata } from 'next';
import { Code, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Events and the controller' };

export default function Events() {
  return (
    <article>
      <h1>Events and the controller</h1>
      <h2>Listening</h2>
      <Code lang="tsx">{`
<VideoEditor
  onEvent={(event) => {
    switch (event.type) {
      case 'change': // an edit, undo or redo; event.label names it ("Split", "Add text"…)
      case 'selection': // event.ids
      case 'playback': // event.playing
      case 'command': // event.id — a menu or shortcut command ran
      case 'import': // event.assetId, event.name
      case 'export': // event.phase: 'start' | 'done' | 'cancelled' | 'error'
      case 'panel': // event.id — a left-menu panel opened (null: closed)
    }
  }}
/>
`}</Code>

      <h2>The controller</h2>
      <p>
        <code>onReady</code> hands you the editor&apos;s controller: the project, playback,
        selection and every action the UI uses.
      </p>
      <Code lang="tsx">{`
import { updateItem } from '@video-ultra/core';

<VideoEditor
  onReady={(ctl) => {
    ctl.seek(0);
    ctl.play();
    // Edits: a recipe on a draft of the project — one undo step, saved like any edit.
    ctl.run('Mute everything', (draft) => {
      for (const track of draft.tracks)
        for (const item of track.items)
          if ('muted' in item) updateItem(draft, item.id, { muted: true });
    });
    const off = ctl.on((event) => console.log(event.type)); // call off() to stop
  }}
/>
`}</Code>
      <p>
        Inside the editor (your own panels, or components under it) the hooks{' '}
        <code>useController</code>, <code>useProject(selector)</code>, <code>useUi(selector)</code>{' '}
        and <code>useHistory</code> give the same controller and re-render only when what they
        select changes.
      </p>
      <h2>Edit operations</h2>
      <p>
        <code>@video-ultra/core</code> exports the operations the editor uses —{' '}
        <code>insertMain</code>, <code>addToLane</code>, <code>splitItem</code>,{' '}
        <code>trimItem</code>, <code>setSpeed</code>, <code>updateItem</code>,{' '}
        <code>setTransition</code>, <code>combineItems</code> and more. Each keeps the project valid
        or throws an <code>EditError</code> with a reason, so they&apos;re safe to call from your
        code, on the server too.
      </p>
      <PageNav href="/docs/events" />
    </article>
  );
}
