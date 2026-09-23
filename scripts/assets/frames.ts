/**
 * Prints the pet's frames as JSON for the asset generators (petsvg.py), so
 * the README images draw exactly what the plugin draws: every act's frames,
 * from hooks/pet-art.ts.
 */
import { type Act, CANVAS_H, CANVAS_W, PALETTE, scenePixels } from '../../hooks/pet-art.ts'

const ACTS: Act[] = ['think', 'read', 'search', 'write', 'run', 'fly', 'rest', 'rope', 'wave', 'look']
const frames: Record<string, string[]> = {}
for (const act of ACTS) for (let frame = 0; frame < 12; frame++) frames[`${act}:${frame}`] = scenePixels(act, frame, false, 0)
frames['rest:blink'] = scenePixels('rest', 0, true, 0)
frames['rest:dip'] = scenePixels('rest', 0, false, 4)
console.log(JSON.stringify({ width: CANVAS_W, height: CANVAS_H, palette: PALETTE, frames }))
