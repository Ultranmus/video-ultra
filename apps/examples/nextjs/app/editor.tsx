'use client';

import { VideoEditor, type Project } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { saveProject } from './actions';

/** The editor, saving each change through a server action. */
export function Editor({ project }: { project: Project | null }) {
  return (
    <div style={{ height: '100dvh' }}>
      <VideoEditor
        initialProject={project ?? undefined}
        onSave={(p) => saveProject(p)}
        onExport={({ blob, extension }) => {
          const url = URL.createObjectURL(blob);
          Object.assign(document.createElement('a'), {
            href: url,
            download: `video.${extension}`,
          }).click();
        }}
        theme="auto"
      />
    </div>
  );
}
