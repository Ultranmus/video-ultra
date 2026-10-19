'use server';

import { mkdir, writeFile } from 'node:fs/promises';
import type { Project } from '@video-ultra/core';

/** Stores the project (here: a file next to the app — use your database). */
export async function saveProject(project: Project): Promise<void> {
  await mkdir('.data', { recursive: true });
  await writeFile('.data/project.json', JSON.stringify(project));
}
