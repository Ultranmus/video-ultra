/**
 * The WebGPU video variant of a layer shader: the `texture_2d` marked `@frame` becomes a zero-copy
 * `texture_external`, sampled without mips. Derived at load time (two lines change), so the
 * package ships the WGSL once. Used by scripts/shaders.ts to validate the variant too.
 */
export function externalVariant(wgsl: string): string {
  const declared = wgsl.replace(
    /(var\s+\w+\s*:\s*)texture_2d<f32>(\s*;\s*\/\/\s*@frame)/,
    '$1texture_external$2',
  );
  const sampled = declared.replace(
    /textureSample\((\w+),\s*(\w+),\s*(\w+)\)(\s*;\s*\/\/\s*@sample-frame)/,
    'textureSampleBaseClampToEdge($1, $2, $3)$4',
  );
  if (declared === wgsl || sampled === declared)
    throw new Error('Missing @frame / @sample-frame markers');
  return sampled;
}
