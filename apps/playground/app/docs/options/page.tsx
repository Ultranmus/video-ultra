import type { Metadata } from 'next';
import Link from 'next/link';
import { PageNav } from '../parts';

export const metadata: Metadata = { title: 'All options' };

const ROWS: [string, string, string][] = [
  [
    'initialProject',
    'Project | string',
    'Project to open. Without it the last autosaved project reopens, or a new one starts.',
  ],
  [
    'onSave',
    '(project) => void | Promise<void>',
    'About a second after each edit — the durable save.',
  ],
  [
    'onExport',
    '(result: ExportResult) => void',
    'An export finished: the video file and its details.',
  ],
  ['onExportAudio', '(result: AudioExportResult) => void', 'A sound-only export finished.'],
  ['onSaveFrame', '(image: FrameImage) => void', 'A frame was saved as a picture.'],
  ['onClose', '() => void', 'Shows a close button that calls it.'],
  ['onUnsupported', '(capabilities) => void', "The device can't run the editor."],
  [
    'onReady',
    '(controller) => void',
    'The editor is ready; its controller for programmatic control.',
  ],
  [
    'onEvent',
    '(event: EditorEvent) => void',
    'Edits, selection, playback, commands, imports, exports, panels.',
  ],
  [
    'resolveMedia',
    '(asset) => Promise<Blob | null>',
    'Bytes for media you store yourself (url sources).',
  ],
  ['autosave', 'boolean', 'Local autosave and crash recovery (default true).'],
  [
    'proxies',
    "'auto' | 'always' | 'off'",
    'Lighter editing copies of heavy videos (default auto). Exports always use the original.',
  ],
  [
    'audioLibrary',
    'AudioLibrary',
    'A music and sound-effects source for the Audio panel (createStarterSounds() is a small CC0 set).',
  ],
  [
    'stickerLibrary',
    'string | false',
    'Where 3D stickers come from (a base URL to self-host), or false.',
  ],
  [
    'animatedStickerLibrary',
    'string | false',
    'Where animated emoji come from, or false to hide the tab.',
  ],
  [
    'transcriber',
    'Transcriber',
    'Auto captions: createOnDeviceTranscriber() from @video-ultra/captions (English), or your own service (any language).',
  ],
  [
    'backgroundRemover',
    'BackgroundRemover',
    'Photo background removal: createBackgroundRemover() from @video-ultra/ai.',
  ],
  [
    'assistant',
    'EditingAssistant',
    'AI editing through your server: createChatAssistant() from @video-ultra/ai.',
  ],
  [
    'speech',
    'SpeechGenerator',
    'Text to speech through your server: createSpeechEndpoint() from @video-ultra/ai.',
  ],
  [
    'customize',
    'EditorCustomization',
    'Hide or reorder tools; your own panels, buttons and media sources.',
  ],
  ['theme', "'dark' | 'light' | 'auto'", 'Colour theme (default dark).'],
  ['themeOverrides', 'ThemeOverrides', 'Typed overrides for the common theme tokens.'],
  ['contrast', "'normal' | 'high' | 'auto'", 'High contrast for low vision or bright sunlight.'],
  [
    'density',
    "'auto' | 'touch' | 'compact'",
    'Control sizes (default: thumb-sized on touch screens).',
  ],
  ['labels', 'Partial<Labels>', 'Replace any text (translation).'],
  [
    'dir',
    "'ltr' | 'rtl'",
    'Direction of the editor chrome (the timeline always runs left to right).',
  ],
  [
    'backend',
    "'auto' | 'webgpu' | 'webgl2'",
    'Force a renderer (testing). Default: WebGPU when available.',
  ],
  ['className / style', '', 'On the editor root.'],
];

export default function Options() {
  return (
    <article>
      <h1>All options</h1>
      <p className="docs-lead">
        Props of <code>&lt;VideoEditor /&gt;</code>. Every one is documented in its type too — see
        the <Link href="/docs/api">API reference</Link>.
      </p>
      <table tabIndex={0} className="docs-props">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([name, type, what]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{type ? <code>{type}</code> : null}</td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PageNav href="/docs/options" />
    </article>
  );
}
