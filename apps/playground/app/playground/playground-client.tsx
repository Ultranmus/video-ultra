'use client';

/**
 * The playground: the editor with options beside it. Theme, size, direction, contrast and
 * density apply live; tools, services and words are read when the editor starts, so changing
 * them restarts it (autosave brings the project back). `?tab=theme|tools|words|events` and
 * `?mode=light|auto` open it set up (links from the docs).
 */
import {
  VideoEditor,
  type EditorEvent,
  type Labels,
  type VideoEditorProps,
} from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDemoServices, type ServerSetup } from '../editor/services';
import { SiteHeader } from '../site-header';
import { CodeDialog } from './code-dialog';
import {
  Choice,
  NumberField,
  Section,
  SelectField,
  Slider,
  Switch,
  Tabs,
  TextField,
} from './controls';
import {
  ACCENTS,
  COLOR_FIELDS,
  DEFAULT_COLORS,
  DEFAULT_SETUP,
  FONTS,
  SERVICES,
  SIZES,
  TOOL_GROUPS,
  WORDS,
  contrastRatio,
  overridesOf,
  type ColorKey,
  type Mode,
  type Setup,
  type SizeId,
} from './options';

const TABS = [
  { id: 'theme', label: 'Theme' },
  { id: 'tools', label: 'Tools' },
  { id: 'words', label: 'Words' },
  { id: 'events', label: 'Events' },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface LogEntry {
  id: number;
  time: string;
  kind: EditorEvent['type'] | 'onSave' | 'onExport';
  text: string;
  /** How many times in a row the same event came (shown as ×N). */
  count: number;
}

function describe(event: EditorEvent): string {
  switch (event.type) {
    case 'change':
      return event.label ?? 'project updated';
    case 'selection':
      return event.ids.length ? `${event.ids.length} selected` : 'nothing selected';
    case 'playback':
      return event.playing ? 'playing' : 'paused';
    case 'command':
      return event.id;
    case 'import':
      return event.name;
    case 'export':
      return event.phase;
    case 'panel':
      return event.id ?? 'closed';
  }
}

/** The OS colour scheme (for `auto`), kept up to date. */
function useOsDark(): boolean {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

/** An element's size, kept up to date. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function Playground({ server }: { server: ServerSetup }) {
  const params = useSearchParams();
  const [setup, setSetup] = useState<Setup>(() => {
    const mode = params.get('mode');
    return mode === 'light' || mode === 'auto' ? { ...DEFAULT_SETUP, mode } : DEFAULT_SETUP;
  });
  const [tab, setTab] = useState<TabId>(() => {
    const t = params.get('tab');
    return TABS.some((x) => x.id === t) ? (t as TabId) : 'theme';
  });
  const [codeOpen, setCodeOpen] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const osDark = useOsDark();
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useBoxSize(stageRef);

  const set = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));
  const shown: 'dark' | 'light' = setup.mode === 'auto' ? (osDark ? 'dark' : 'light') : setup.mode;
  const color = (key: ColorKey) => setup.colors[key] ?? DEFAULT_COLORS[shown][key];

  // Words apply after typing pauses (each change restarts the editor).
  const [words, setWords] = useState(setup.words);
  useEffect(() => {
    const t = window.setTimeout(() => setWords(setup.words), 600);
    return () => window.clearTimeout(t);
  }, [setup.words]);

  const services = useDemoServices(server, {
    sounds: setup.services.audioLibrary,
    captions: setup.services.transcriber,
    assistant: setup.services.assistant,
    cutout: setup.services.backgroundRemover,
  });

  // Stable: the log keeps one row per run of the same event (×N), newest first.
  const add = useCallback((kind: LogEntry['kind'], text: string) => {
    const time = new Date().toLocaleTimeString();
    setLog((entries) => {
      const last = entries[0];
      if (last && last.kind === kind && last.text === text)
        return [{ ...last, time, count: last.count + 1 }, ...entries.slice(1)];
      return [{ id: ++logId.current, time, kind, text, count: 1 }, ...entries].slice(0, 80);
    });
  }, []);

  // What the editor reads only when it starts: a change restarts it.
  const restartKey = JSON.stringify({ hide: setup.hide, services: setup.services, words });
  const labels = useMemo(
    () => Object.fromEntries(Object.entries(words).filter(([, v]) => v)) as Partial<Labels>,
    [words],
  );

  const size = SIZES[setup.size];
  const frame =
    setup.size === 'fill'
      ? null
      : setup.size === 'custom'
        ? setup.custom
        : { width: size.width, height: size.height };
  // A frame bigger than the stage is zoomed out to fit (CSS zoom: the editor keeps its own size,
  // so its layout is the device's, and pointers still land where they should).
  const zoom =
    frame && stage.width && stage.height
      ? Math.min(1, (stage.width - 48) / frame.width, (stage.height - 48) / frame.height)
      : 1;

  const editorProps: VideoEditorProps = {
    theme: setup.mode,
    themeOverrides: overridesOf(setup),
    contrast: setup.contrast,
    density: setup.density,
    dir: setup.dir,
    labels,
    customize: { hide: setup.hide },
    ...services,
    onEvent: (event) => add(event.type, describe(event)),
    onSave: () => add('onSave', 'project saved'),
    onExport: (r) =>
      add('onExport', `${r.width}×${r.height}, ${(r.blob.size / 1e6).toFixed(1)} MB`),
  };

  const changed = JSON.stringify(setup) !== JSON.stringify(DEFAULT_SETUP);

  return (
    <div className="site pg">
      <SiteHeader />
      <main id="content" className="pg-app">
        <aside className="pg-panel" aria-labelledby="pg-title" id="pg-options">
          <div className="pg-panel-head">
            <h1 id="pg-title">Playground</h1>
            <p>Shape the editor for your app, then copy the code.</p>
          </div>
          <Tabs tabs={TABS} tab={tab} onTab={setTab} label="Options" idPrefix="pg" />
          <div
            className="pg-panel-body"
            role="tabpanel"
            id={`pg-panel-${tab}`}
            aria-labelledby={`pg-tab-${tab}`}
            tabIndex={0}
          >
            {tab === 'theme' ? (
              <ThemeOptions setup={setup} set={set} color={color} shown={shown} />
            ) : null}
            {tab === 'tools' ? <ToolOptions setup={setup} set={set} /> : null}
            {tab === 'words' ? <WordOptions setup={setup} set={set} /> : null}
            {tab === 'events' ? <EventLog log={log} onClear={() => setLog([])} /> : null}
          </div>
          <div className="pg-panel-foot">
            {changed ? (
              <button
                type="button"
                className="s-btn s-btn-quiet s-btn-small"
                onClick={() => {
                  setSetup(DEFAULT_SETUP);
                  setWords({});
                }}
              >
                Reset all
              </button>
            ) : null}
            <button type="button" className="s-btn s-btn-small" onClick={() => setCodeOpen(true)}>
              Get the code
            </button>
          </div>
        </aside>

        <section className="pg-work" aria-label="Preview">
          <div className="pg-toolbar">
            <div className="s-seg pg-sizes" role="group" aria-label="Preview size">
              {(Object.keys(SIZES) as SizeId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={setup.size === id}
                  onClick={() => set({ size: id })}
                  title={
                    SIZES[id].width ? `${SIZES[id].width} × ${SIZES[id].height}` : SIZES[id].label
                  }
                >
                  {SIZES[id].label}
                </button>
              ))}
            </div>
            {setup.size === 'custom' ? (
              <div className="pg-custom">
                <NumberField
                  key={`w${setup.custom.width}`}
                  label="Width"
                  value={setup.custom.width}
                  min={320}
                  max={2560}
                  onChange={(width) => set({ custom: { ...setup.custom, width } })}
                />
                <span aria-hidden="true">×</span>
                <NumberField
                  key={`h${setup.custom.height}`}
                  label="Height"
                  value={setup.custom.height}
                  min={480}
                  max={1600}
                  onChange={(height) => set({ custom: { ...setup.custom, height } })}
                />
              </div>
            ) : null}
            {frame ? (
              <span className="pg-size-note">
                {frame.width} × {frame.height}
                {zoom < 1 ? ` · shown at ${Math.round(zoom * 100)}%` : ''}
              </span>
            ) : null}
            <a className="pg-jump" href="#pg-title">
              Options ↓
            </a>
          </div>

          <div className="pg-stage" ref={stageRef} data-framed={frame ? '' : undefined}>
            <div
              className="pg-frame"
              style={frame ? { width: frame.width, height: frame.height, zoom: zoom } : undefined}
            >
              <VideoEditor key={restartKey} {...editorProps} />
            </div>
          </div>
        </section>
      </main>
      {codeOpen ? <CodeDialog setup={setup} onClose={() => setCodeOpen(false)} /> : null}
    </div>
  );
}

function ThemeOptions({
  setup,
  set,
  color,
  shown,
}: {
  setup: Setup;
  set: (p: Partial<Setup>) => void;
  color: (k: ColorKey) => string;
  shown: 'dark' | 'light';
}) {
  const ratios = [
    { label: 'Button text on accent', value: contrastRatio('#ffffff', color('accent')) },
    { label: 'Text on panels', value: contrastRatio(color('text'), color('surface1')) },
    { label: 'Quiet text on panels', value: contrastRatio(color('textMuted'), color('surface1')) },
    {
      label: 'Accent text on panels',
      value: contrastRatio(color('accentText'), color('surface1')),
    },
  ];
  return (
    <>
      <Section title="Mode">
        <Choice<Mode>
          label="Colour mode"
          hideLabel
          value={setup.mode}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'auto', label: 'System' },
          ]}
          onChange={(mode) => set({ mode, colors: {} })}
        />
      </Section>

      <Section title="Accent">
        <div className="pg-swatches" role="group" aria-label="Accent colour">
          {ACCENTS.map((a) => {
            const on = color('accent') === a.accent;
            return (
              <button
                key={a.name}
                type="button"
                className="pg-swatch"
                style={{ background: a.accent }}
                aria-label={a.name}
                title={a.name}
                aria-pressed={on}
                onClick={() =>
                  set({
                    colors: {
                      ...setup.colors,
                      accent: a.accent,
                      accentText: shown === 'dark' ? a.dark : a.accent,
                    },
                  })
                }
              >
                {on ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Colours"
        action={
          Object.keys(setup.colors).length ? (
            <button type="button" className="pg-link" onClick={() => set({ colors: {} })}>
              Reset
            </button>
          ) : null
        }
      >
        <div className="pg-colors">
          {COLOR_FIELDS.map(({ key, label }) => (
            <label key={key} className="pg-color">
              <input
                type="color"
                value={color(key)}
                onChange={(e) => set({ colors: { ...setup.colors, [key]: e.target.value } })}
              />
              <span>{label}</span>
              <code>{color(key)}</code>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Shape and type">
        <Slider
          label="Corners"
          value={setup.radius}
          min={0}
          max={20}
          defaultValue={8}
          unit="px"
          onChange={(radius) => set({ radius })}
        />
        <SelectField
          label="Font"
          value={setup.font}
          options={FONTS.map((f) => ({ value: f.value, label: f.label }))}
          onChange={(font) => set({ font })}
        />
      </Section>

      <Section title="Comfort">
        <Choice
          label="Control size"
          value={setup.density}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'touch', label: 'Touch' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={(density) => set({ density })}
        />
        <Choice
          label="Contrast"
          value={setup.contrast}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
            { value: 'auto', label: 'System' },
          ]}
          onChange={(contrast) => set({ contrast })}
        />
      </Section>

      <Section title="Readable?" hint="Text needs 4.5 or more (WCAG AA).">
        <ul className="pg-ratios">
          {ratios.map((r) => {
            const ok = r.value >= 4.5;
            return (
              <li key={r.label}>
                <span>{r.label}</span>
                <strong data-ok={ok}>
                  {r.value.toFixed(1)}
                  <span className="pg-badge">{ok ? 'Good' : 'Too low'}</span>
                </strong>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

function ToolOptions({ setup, set }: { setup: Setup; set: (p: Partial<Setup>) => void }) {
  const toggle = (id: string, on: boolean) =>
    set({ hide: on ? setup.hide.filter((h) => h !== id) : [...setup.hide, id] });
  return (
    <>
      <p className="pg-intro">
        Turn parts off to keep the editor simple. The editor restarts to apply them; your project
        comes back.
      </p>
      {TOOL_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.items.map((item) => (
            <Switch
              key={item.id}
              label={item.label}
              on={!setup.hide.includes(item.id)}
              onChange={(on) => toggle(item.id, on)}
            />
          ))}
        </Section>
      ))}
      <Section title="Services" hint="Things your app passes in; each one adds its tools.">
        {SERVICES.map((s) => (
          <Switch
            key={s.id}
            label={s.label}
            on={setup.services[s.id]}
            onChange={(on) => set({ services: { ...setup.services, [s.id]: on } })}
          />
        ))}
      </Section>
    </>
  );
}

const DEFAULT_WORDS: Partial<Record<keyof Labels, string>> = {
  export: 'Export',
  media: 'Media',
  text: 'Text',
  audio: 'Audio',
  untitledVideo: 'Untitled video',
};

function WordOptions({ setup, set }: { setup: Setup; set: (p: Partial<Setup>) => void }) {
  return (
    <>
      <Section title="Direction">
        <Choice
          label="Reading order"
          hideLabel
          value={setup.dir}
          options={[
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
          onChange={(dir) => set({ dir })}
        />
      </Section>
      <Section
        title="Your own words"
        hint="Any label in the editor can be changed or translated with the labels prop. Try a few:"
      >
        {WORDS.map((w) => (
          <TextField
            key={w.key}
            label={w.label}
            placeholder={DEFAULT_WORDS[w.key] ?? ''}
            value={setup.words[w.key] ?? ''}
            onChange={(value) => set({ words: { ...setup.words, [w.key]: value } })}
          />
        ))}
      </Section>
    </>
  );
}

const KIND_LABEL: Record<LogEntry['kind'], string> = {
  change: 'change',
  selection: 'selection',
  playback: 'playback',
  command: 'command',
  import: 'import',
  export: 'export',
  panel: 'panel',
  onSave: 'onSave',
  onExport: 'onExport',
};

function EventLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  return (
    <>
      <p className="pg-intro">
        What your app hears through <code>onEvent</code>, <code>onSave</code> and{' '}
        <code>onExport</code>. Use the editor and watch.
      </p>
      <div className="pg-log-bar">
        <span aria-live="polite">
          {log.length ? `${log.length} ${log.length === 1 ? 'event' : 'events'}` : 'No events yet'}
        </span>
        {log.length ? (
          <button type="button" className="pg-link" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      {log.length ? (
        <ol className="pg-log">
          {log.map((e) => (
            <li key={e.id}>
              <span className="pg-log-kind" data-kind={e.kind}>
                {KIND_LABEL[e.kind]}
              </span>
              <span className="pg-log-text">
                {e.text}
                {e.count > 1 ? <span className="pg-log-count"> ×{e.count}</span> : null}
              </span>
              <time>{e.time}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pg-empty">
          Select a clip, press play or add some media: each event shows here.
        </p>
      )}
    </>
  );
}

/** The playground page's client side. */
export function PlaygroundClient(server: ServerSetup) {
  return (
    <Suspense>
      <Playground server={server} />
    </Suspense>
  );
}
