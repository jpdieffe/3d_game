import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
} from '@babylonjs/core'
import type { BuildingDef } from './types'

// All buildings are placed on the ground plane (y = 0 is ground level).
// Both players load this identical array — no sync needed.
export const BUILDINGS: BuildingDef[] = [
  { x:  0,  z:  0,  width:  6, depth:  6, height:  5 },
  { x: 12,  z:  5,  width:  5, depth:  8, height:  8 },
  { x: -10, z:  8,  width:  7, depth:  5, height:  3 },
  { x:  5,  z: -12, width:  4, depth:  4, height: 12 },
  { x: -8,  z: -10, width:  8, depth:  6, height:  6 },
  { x: 18,  z: -8,  width:  5, depth:  5, height:  9 },
  { x: -18, z:  3,  width:  6, depth:  7, height:  4 },
  { x: 10,  z: 18,  width:  7, depth:  4, height:  7 },
  { x: -5,  z: 18,  width:  5, depth:  6, height: 10 },
  { x: 22,  z: 15,  width:  4, depth:  9, height:  5 },
  { x: -22, z: -12, width:  6, depth:  5, height:  8 },
  { x:  0,  z: 25,  width:  8, depth:  5, height:  6 },
]

const BUILDING_COLORS = [
  new Color3(0.62, 0.62, 0.70),
  new Color3(0.50, 0.55, 0.65),
  new Color3(0.70, 0.65, 0.58),
  new Color3(0.55, 0.65, 0.72),
  new Color3(0.72, 0.60, 0.60),
]

export class World {
  readonly buildings: BuildingDef[] = BUILDINGS

  constructor(scene: Scene) {
    scene.clearColor = new Color4(0.53, 0.81, 0.98, 1.0) // sky blue

    // Soft fill light from above
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
    hemi.intensity = 0.5

    // Directional sun
    const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
    sun.intensity = 0.9
    sun.position = new Vector3(30, 50, 30)

    // Ground
    const ground = MeshBuilder.CreateGround('ground', { width: 120, height: 120 }, scene)
    const groundMat = new StandardMaterial('groundMat', scene)
    groundMat.diffuseColor = new Color3(0.30, 0.50, 0.22)
    ground.material = groundMat

    // Buildings — mesh center is at height/2 so the base sits on y=0
    BUILDINGS.forEach((b, i) => {
      const box = MeshBuilder.CreateBox(`building_${i}`, {
        width: b.width,
        depth: b.depth,
        height: b.height,
      }, scene)
      box.position.set(b.x, b.height / 2, b.z)

      const mat = new StandardMaterial(`bmat_${i}`, scene)
      mat.diffuseColor = BUILDING_COLORS[i % BUILDING_COLORS.length]
      box.material = mat

      // Darker rooftop panel so players can see the top surface clearly
      const roof = MeshBuilder.CreateBox(`roof_${i}`, {
        width: b.width,
        depth: b.depth,
        height: 0.08,
      }, scene)
      roof.position.set(b.x, b.height + 0.04, b.z)
      const roofMat = new StandardMaterial(`rmat_${i}`, scene)
      roofMat.diffuseColor = new Color3(0.25, 0.25, 0.30)
      roof.material = roofMat
    })
  }
}
