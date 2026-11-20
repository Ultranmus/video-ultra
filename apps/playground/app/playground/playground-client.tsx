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
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CopyButton } from '../copy-button';
import { useDemoServices, type ServerSetup } from '../editor/services';
import { SiteHeader } from '../site-header';
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
  cssCode,
  overridesOf,
  propsCode,
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
  text: string;
}

function describe(event: EditorEvent): string {
  switch (event.type) {
    case 'change':
      return `change${event.label ? ` · ${event.label}` : ''}`;
    case 'selection':
      return `selection · ${event.ids.length} selected`;
    case 'playback':
      return `playback · ${event.playing ? 'playing' : 'paused'}`;
    case 'command':
      return `command · ${event.id}`;
    case 'import':
      return `import · ${event.name}`;
    case 'export':
      return `export · ${event.phase}`;
    case 'panel':
      return `panel · ${event.id ?? 'closed'}`;
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

/** The stage's size, so a tall device frame shrinks to fit (its width, which picks the layout, stays). */
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
  const [code, setCode] = useState<'props' | 'css' | null>(null);
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

  // Stable: the editor keeps the first onEvent it gets until it restarts.
  const add = useCallback((text: string) => {
    const entry = { id: ++logId.current, time: new Date().toLocaleTimeString(), text };
    setLog((entries) => [entry, ...entries].slice(0, 60));
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
  // A frame taller than the stage gets shorter (never below 560 px: then the stage scrolls).
  const frameHeight =
    frame && stage.height ? Math.max(Math.min(frame.height, stage.height - 32), 560) : 0;

  const editorProps: VideoEditorProps = {
    theme: setup.mode,
    themeOverrides: overridesOf(setup),
    contrast: setup.contrast,
    density: setup.density,
    dir: setup.dir,
    labels,
    customize: { hide: setup.hide },
    ...services,
    onEvent: (event) => add(describe(event)),
    onSave: () => add('onSave · project saved'),
    onExport: (r) => add(`onExport · ${r.width}×${r.height}, ${(r.blob.size / 1e6).toFixed(1)} MB`),
  };

  const codeText = code === 'css' ? cssCode(setup) : propsCode(setup);
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
          <Tabs tab={tab} onTab={setTab} />
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
            <a className="pg-jump" href="#pg-title">
              Options ↓
            </a>
            <div className="pg-toolbar-end">
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
              <button
                type="button"
                className="s-btn s-btn-small"
                aria-expanded={code !== null}
                aria-controls="pg-code"
                onClick={() => setCode(code ? null : 'props')}
              >
                {code ? 'Hide code' : 'Get the code'}
              </button>
            </div>
          </div>

          <div className="pg-stage" ref={stageRef} data-framed={frame ? '' : undefined}>
            <div
              className="pg-frame"
              style={
                frame ? { width: frame.width, height: frameHeight || frame.height } : undefined
              }
            >
              <VideoEditor key={restartKey} {...editorProps} />
            </div>
            {frame && frameHeight > 0 && frameHeight < frame.height ? (
              <p className="pg-note">
                Shown {frame.width} × {frameHeight}: shortened to fit this window.
              </p>
            ) : null}
          </div>

          {code ? (
            <div className="pg-code" id="pg-code">
              <div className="pg-code-bar">
                <div className="s-seg" role="group" aria-label="Code as">
                  {(['props', 'css'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={code === c}
                      onClick={() => setCode(c)}
                    >
                      {c === 'props' ? 'React props' : 'CSS'}
                    </button>
                  ))}
                </div>
                <CopyButton text={codeText} label="Copy the code" className="pg-copy" />
              </div>
              <pre tabIndex={0} aria-label="Code for this setup">
                <code data-testid="pg-code">{codeText}</code>
              </pre>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function Tabs({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? TABS.length - 1
          : (i + step + TABS.length) % TABS.length;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    onTab(TABS[to]!.id);
    refs.current[to]?.focus();
  };
  return (
    <div className="pg-tabs" role="tablist" aria-label="Options">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`pg-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`pg-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onTab(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="pg-group">
      <legend>{title}</legend>
      {hint ? <p className="pg-hint">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function Choice<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="pg-row">
      {hideLabel ? null : <span className="pg-row-label">{label}</span>}
      <div className="s-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
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
  const id = useId();
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
      <Group title="Mode">
        <Choice<Mode>
          label="Colours"
          hideLabel
          value={setup.mode}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'auto', label: 'Follow the device' },
          ]}
          onChange={(mode) => set({ mode, colors: {} })}
        />
      </Group>

      <Group title="Accent">
        <div className="pg-swatches" role="group" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a.name}
              type="button"
              className="pg-swatch"
              style={{ background: a.accent }}
              aria-label={a.name}
              title={a.name}
              aria-pressed={color('accent') === a.accent}
              onClick={() =>
                set({
                  colors: {
                    ...setup.colors,
                    accent: a.accent,
                    accentText: shown === 'dark' ? a.dark : a.accent,
                  },
                })
              }
            />
          ))}
        </div>
      </Group>

      <Group title="Colours">
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
        {Object.keys(setup.colors).length ? (
          <button type="button" className="pg-link" onClick={() => set({ colors: {} })}>
            Reset colours
          </button>
        ) : null}
      </Group>

      <Group title="Shape and type">
        <label className="pg-row" htmlFor={`${id}-radius`}>
          <span className="pg-row-label">Corners · {setup.radius}px</span>
          <input
            id={`${id}-radius`}
            type="range"
            min={0}
            max={20}
            value={setup.radius}
            onChange={(e) => set({ radius: Number(e.target.value) })}
          />
        </label>
        <label className="pg-row" htmlFor={`${id}-font`}>
          <span className="pg-row-label">Font</span>
          <select
            id={`${id}-font`}
            className="pg-select"
            value={setup.font}
            onChange={(e) => set({ font: e.target.value })}
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Comfort">
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
            { value: 'auto', label: 'Follow the device' },
          ]}
          onChange={(contrast) => set({ contrast })}
        />
      </Group>

      <Group title="Readable?" hint="WCAG AA needs 4.5 for text.">
        <ul className="pg-ratios">
          {ratios.map((r) => {
            const ok = r.value >= 4.5;
            return (
              <li key={r.label}>
                <span>{r.label}</span>
                <strong data-ok={ok}>
                  {r.value.toFixed(1)} {ok ? '· good' : '· too low'}
                </strong>
              </li>
            );
          })}
        </ul>
      </Group>
    </>
  );
}

function ToolOptions({ setup, set }: { setup: Setup; set: (p: Partial<Setup>) => void }) {
  const toggle = (id: string, on: boolean) =>
    set({ hide: on ? setup.hide.filter((h) => h !== id) : [...setup.hide, id] });
  return (
    <>
      <p className="pg-hint pg-hint-top">
        Turn parts off to keep the editor simple. The editor restarts to apply them; your project
        comes back.
      </p>
      {TOOL_GROUPS.map((g) => (
        <Group key={g.title} title={g.title}>
          {g.items.map((item) => (
            <Switch
              key={item.id}
              label={item.label}
              on={!setup.hide.includes(item.id)}
              onChange={(on) => toggle(item.id, on)}
            />
          ))}
        </Group>
      ))}
      <Group title="Services" hint="Things your app passes in: each one adds its tools.">
        {SERVICES.map((s) => (
          <Switch
            key={s.id}
            label={s.label}
            on={setup.services[s.id]}
            onChange={(on) => set({ services: { ...setup.services, [s.id]: on } })}
          />
        ))}
      </Group>
    </>
  );
}

function WordOptions({ setup, set }: { setup: Setup; set: (p: Partial<Setup>) => void }) {
  const id = useId();
  return (
    <>
      <Group title="Direction">
        <Choice
          label="Reading order"
          value={setup.dir}
          options={[
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
          onChange={(dir) => set({ dir })}
        />
      </Group>
      <Group
        title="Your own words"
        hint="Every label in the editor can be changed or translated with the labels prop. Try a few:"
      >
        {WORDS.map((w) => (
          <label key={w.key} className="pg-field" htmlFor={`${id}-${w.key}`}>
            <span>{w.label}</span>
            <input
              id={`${id}-${w.key}`}
              type="text"
              placeholder={DEFAULT_WORDS[w.key]}
              value={setup.words[w.key] ?? ''}
              onChange={(e) => set({ words: { ...setup.words, [w.key]: e.target.value } })}
            />
          </label>
        ))}
      </Group>
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

function EventLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  return (
    <>
      <p className="pg-hint pg-hint-top">
        What your app hears through <code>onEvent</code>, <code>onSave</code> and{' '}
        <code>onExport</code>. Use the editor and watch.
      </p>
      <div className="pg-log-bar">
        <span aria-live="polite">{log.length ? `${log.length} events` : 'No events yet'}</span>
        {log.length ? (
          <button type="button" className="pg-link" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      <ol className="pg-log">
        {log.map((e) => (
          <li key={e.id}>
            <time>{e.time}</time>
            <code>{e.text}</code>
          </li>
        ))}
      </ol>
    </>
  );
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="pg-switch">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  // The parent keys this field by its value, so a new value starts a fresh draft.
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    else setText(String(value));
  };
  return (
    <label className="pg-number">
      <span className="site-sr">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
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
