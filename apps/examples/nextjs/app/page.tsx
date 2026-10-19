import { readFile } from 'node:fs/promises';
import { parseProject } from '@video-ultra/core';
import { Editor } from './editor';

/** Read the saved project on every visit (not once at build time). */
export const dynamic = 'force-dynamic';

/** Server component: loads the saved project (checked and upgraded), renders the editor. */
export default async function Page() {
  const json = await readFile('.data/project.json', 'utf8').catch(() => null);
  const parsed = json ? parseProject(json) : null;
  return <Editor project={parsed?.ok ? parsed.project : null} />;
}
