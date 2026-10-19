import { ALLOWED_KINDS, assetKindsFor, itemEnd, projectFrame, sourceSpan } from './project';
import type { Project, Track } from './schema';

/**
 * Rules every project must satisfy after any edit. The edit operations keep them; the property
 * tests prove it with random edit sequences. Returns a list of violations (empty = valid).
 */
export function checkInvariants(project: Project): string[] {
  const problems: string[] = [];
  const frame = projectFrame(project);
  const ids = new Set<string>();
  const seen = (id: string, what: string) => {
    if (ids.has(id)) problems.push(`duplicate id ${id} (${what})`);
    ids.add(id);
  };

  // The timeline, then each combined clip's own timeline (file version 5+): same rules, ids unique
  // across all of them.
  checkTracks(project.tracks, 'timeline');
  for (const asset of Object.values(project.assets)) {
    if (asset.kind !== 'compound') continue;
    if (!asset.tracks) {
      problems.push(`combined clip ${asset.id} has no tracks`);
      continue;
    }
    checkTracks(asset.tracks, `combined clip ${asset.id}`);
    if (asset.tracks.some((t) => t.kind === 'caption'))
      problems.push(`combined clip ${asset.id} holds captions`);
    let end = 0;
    for (const t of asset.tracks) for (const i of t.items) end = Math.max(end, itemEnd(i));
    if (end > asset.duration)
      problems.push(`combined clip ${asset.id} is shorter than its content`);
    if (contains(asset.id, asset.id, new Set()))
      problems.push(`combined clip ${asset.id} contains itself`);
  }
  return problems;

  function contains(target: string, id: string, seen: Set<string>): boolean {
    const asset = project.assets[id];
    if (!asset?.tracks || seen.has(id)) return false;
    seen.add(id);
    return asset.tracks.some((t) =>
      t.items.some(
        (i) =>
          'assetId' in i &&
          !!i.assetId &&
          (i.assetId === target || contains(target, i.assetId, seen)),
      ),
    );
  }

  function checkTracks(tracks: readonly Track[], scope: string): void {
    const mains = tracks.filter((t) => t.kind === 'main');
    if (mains.length !== 1 || tracks[0]?.kind !== 'main') {
      problems.push(`${scope}: there must be exactly one main track, first in the list`);
    }

    for (const track of tracks) {
      seen(track.id, 'track');
      if (track.kind !== 'main' && track.items.length === 0)
        problems.push(`empty lane ${track.id}`);
      if (track.caption && track.kind !== 'caption')
        problems.push(`caption look on ${track.kind} track`);
      let cursor = 0;
      track.items.forEach((item, index) => {
        seen(item.id, 'item');
        const where = `${track.kind} track ${track.id}, item ${item.id}`;
        if (!ALLOWED_KINDS[track.kind].includes(item.kind)) {
          problems.push(`${where}: ${item.kind} not allowed here`);
        }
        if (item.duration < frame) problems.push(`${where}: shorter than one frame`);
        if (track.kind === 'main') {
          if (item.start !== cursor)
            problems.push(`${where}: main track has a gap or overlap at ${cursor}`);
        } else if (item.start < cursor) {
          problems.push(`${where}: overlaps the previous item`);
        }
        cursor = itemEnd(item);
        if (track.kind === 'main' && item.groupId)
          problems.push(`${where}: main-track clip in a group`);
        if ('duck' in item && item.duck !== undefined && !(item.duck > 0 && item.duck <= 1))
          problems.push(`${where}: duck amount ${item.duck} outside (0, 1] (off = no field)`);

        // Asset references
        const assetId = 'assetId' in item ? item.assetId : null;
        if (item.kind === 'sticker') {
          if ((item.assetId === null) === (item.emoji === null)) {
            problems.push(`${where}: sticker needs exactly one of assetId / emoji`);
          }
        }
        if (assetId !== null) {
          const asset = project.assets[assetId];
          if (!asset) problems.push(`${where}: missing asset ${assetId}`);
          else if (!assetKindsFor(item.kind).includes(asset.kind)) {
            problems.push(`${where}: ${item.kind} can't use a ${asset.kind} asset`);
          } else if (item.kind === 'video' || item.kind === 'audio') {
            // 1-flick tolerance for rounding of duration × speed.
            if (item.sourceIn + sourceSpan(item) > asset.duration + 1) {
              problems.push(`${where}: reads past the end of its media`);
            }
          } else if (item.kind === 'freeze' && item.sourceTime > asset.duration) {
            problems.push(`${where}: freeze frame past the end of its media`);
          }
        }

        // LUT looks point at a LUT file.
        if ('lut' in item && item.lut) {
          const lut = project.assets[item.lut.assetId];
          if (!lut) problems.push(`${where}: missing LUT ${item.lut.assetId}`);
          else if (lut.kind !== 'lut') problems.push(`${where}: LUT look uses a ${lut.kind} asset`);
        }

        // Transitions
        if ('transitionIn' in item && item.transitionIn) {
          const previous = track.items[index - 1];
          if (track.kind !== 'main' && track.kind !== 'overlay')
            problems.push(`${where}: transitions only between pictures`);
          else if (!previous) problems.push(`${where}: first item can't have a transition in`);
          else if (track.kind === 'overlay' && itemEnd(previous) !== item.start)
            problems.push(`${where}: layer transition between clips that don't touch`);
          else {
            if (item.transitionIn.duration > Math.min(previous.duration, item.duration)) {
              problems.push(`${where}: transition longer than its neighbours`);
            }
          }
        }
      });
    }
  }
}
