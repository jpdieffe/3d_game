import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
} from '@babylonjs/core'
import type { PlayerState } from './types'

const PLAYER_HEIGHT = 1.8
const PLAYER_RADIUS = 0.4
const LERP_SPEED    = 15   // position catch-up per second

export class RemotePlayer {
  readonly mesh: Mesh

  private readonly target  = new Vector3(0, -20, 0)  // hidden until first update
  private readonly current = new Vector3(0, -20, 0)

  constructor(scene: Scene) {
    this.mesh = MeshBuilder.CreateCapsule('remote', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('remoteMat', scene)
    mat.diffuseColor = new Color3(1.0, 0.35, 0.2)   // orange — distinct from blue player
    this.mesh.material = mat
  }

  /** Called when a network packet arrives */
  updateTarget(state: PlayerState) {
    // state.y is feet; mesh centre = feet + half height
    this.target.set(state.x, state.y + PLAYER_HEIGHT / 2, state.z)
    this.mesh.rotation.y = state.ry
  }

  /** Called every render frame to interpolate toward the last known position */
  update(dt: number) {
    const t = Math.min(1, LERP_SPEED * dt)
    this.current.x += (this.target.x - this.current.x) * t
    this.current.y += (this.target.y - this.current.y) * t
    this.current.z += (this.target.z - this.current.z) * t
    this.mesh.position.copyFrom(this.current)
  }
}
