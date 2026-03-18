import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  ArcRotateCamera,
  Mesh,
} from '@babylonjs/core'
import type { BuildingDef, PlayerState } from './types'

const GRAVITY        = -28    // m/s²
const JUMP_VELOCITY  =  13    // m/s upward on jump
const MOVE_SPEED     =   8    // m/s horizontal
const PLAYER_HEIGHT  =   1.8  // metres (feet → top)
const PLAYER_RADIUS  =   0.4  // metres horizontal extent
const TERMINAL_VEL   = -30    // m/s downward cap
const RESPAWN_Y      = -12    // fall off world → respawn

const SPAWN = new Vector3(0, 0, -8)

export class Player {
  readonly mesh: Mesh
  readonly camera: ArcRotateCamera

  // Physics state — position is the FEET position
  readonly position = new Vector3(SPAWN.x, SPAWN.y, SPAWN.z)
  readonly velocity = new Vector3(0, 0, 0)
  onGround = false

  private readonly keys: Record<string, boolean> = {}
  private readonly buildings: BuildingDef[]

  constructor(scene: Scene, buildings: BuildingDef[]) {
    this.buildings = buildings

    // Visual mesh (capsule centred at feet + PLAYER_HEIGHT/2)
    this.mesh = MeshBuilder.CreateCapsule('player', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('playerMat', scene)
    mat.diffuseColor = new Color3(0.2, 0.55, 1.0)
    this.mesh.material = mat

    // Arc-rotate camera — orbits around the player, mouse-controlled
    this.camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2,   // alpha: camera behind player on -Z side
      Math.PI / 3.5,  // beta: 51° down from zenith
      14,             // radius
      Vector3.Zero(),
      scene,
    )
    this.camera.lowerRadiusLimit  =  4
    this.camera.upperRadiusLimit  = 28
    this.camera.upperBetaLimit    = Math.PI / 2.05
    this.camera.panningSensibility = 0  // disable pan; rotation only
    // Remove the default keyboard inputs so our WASD handler takes priority
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput')
    this.camera.attachControl(scene.getEngine().getRenderingCanvas()!, true)

    window.addEventListener('keydown', e => { this.keys[e.code] = true })
    window.addEventListener('keyup',   e => { this.keys[e.code] = false })
  }

  update(dt: number) {
    // --- Horizontal movement relative to camera's yaw (alpha) ---
    const a = this.camera.alpha
    // Forward: direction from camera toward target in XZ plane = (-cos a, -sin a)
    // Right:   forward rotated 90° CW in XZ = (-sin a, cos a)
    const fwdX = -Math.cos(a),  fwdZ = -Math.sin(a)
    const rgtX = -Math.sin(a),  rgtZ =  Math.cos(a)

    let mx = 0, mz = 0
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += fwdX; mz += fwdZ }
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= fwdX; mz -= fwdZ }
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= rgtX; mz -= rgtZ }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += rgtX; mz += rgtZ }
    const len = Math.sqrt(mx * mx + mz * mz)
    if (len > 0) { mx /= len; mz /= len }

    this.velocity.x = mx * MOVE_SPEED
    this.velocity.z = mz * MOVE_SPEED

    // Jump
    if ((this.keys['Space'] || this.keys['KeyE']) && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
    }

    // Gravity (with terminal velocity cap)
    this.velocity.y += GRAVITY * dt
    if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL

    // Integrate
    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    // Respawn if fallen off the world
    if (this.position.y < RESPAWN_Y) {
      this.position.copyFrom(SPAWN)
      this.velocity.setAll(0)
    }

    // Collisions (sets onGround)
    this.onGround = false
    this.resolveCollisions()

    // Sync mesh — mesh is centred at feet + half height
    this.mesh.position.set(
      this.position.x,
      this.position.y + PLAYER_HEIGHT / 2,
      this.position.z,
    )
    // Face movement direction when moving
    if (len > 0) {
      this.mesh.rotation.y = Math.atan2(mx, mz)
    }

    // Camera tracks the mesh
    this.camera.target.copyFrom(this.mesh.position)
  }

  private resolveCollisions() {
    // Ground plane
    if (this.position.y < 0) {
      this.position.y = 0
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    }

    // Building AABB resolution (minimum-overlap axis)
    for (const b of this.buildings) {
      const hw = b.width  / 2
      const hd = b.depth  / 2

      const pL = this.position.x - PLAYER_RADIUS
      const pR = this.position.x + PLAYER_RADIUS
      const pB = this.position.z - PLAYER_RADIUS
      const pF = this.position.z + PLAYER_RADIUS
      const pFt = this.position.y              // feet
      const pTp = this.position.y + PLAYER_HEIGHT

      const bL = b.x - hw,  bR = b.x + hw
      const bBk = b.z - hd, bFr = b.z + hd

      const overlapX = Math.min(pR, bR)  - Math.max(pL, bL)
      const overlapY = Math.min(pTp, b.height) - Math.max(pFt, 0)
      const overlapZ = Math.min(pF, bFr) - Math.max(pB, bBk)

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue

      // Resolve along the axis with the smallest penetration
      if (overlapY <= overlapX && overlapY <= overlapZ) {
        // Vertical: landing on top or bumping ceiling
        const playerMidY = pFt + PLAYER_HEIGHT / 2
        if (playerMidY >= b.height / 2) {
          // Came from above — land on roof
          this.position.y = b.height
          if (this.velocity.y < 0) this.velocity.y = 0
          this.onGround = true
        } else {
          // Came from below — bonk ceiling
          this.position.y = -PLAYER_HEIGHT  // pushed below; ground check fixes this
          if (this.velocity.y > 0) this.velocity.y = 0
        }
      } else if (overlapX <= overlapZ) {
        // Horizontal X push-out
        if (this.position.x < b.x) this.position.x = bL - PLAYER_RADIUS
        else                        this.position.x = bR + PLAYER_RADIUS
        this.velocity.x = 0
      } else {
        // Horizontal Z push-out
        if (this.position.z < b.z) this.position.z = bBk - PLAYER_RADIUS
        else                        this.position.z = bFr + PLAYER_RADIUS
        this.velocity.z = 0
      }
    }
  }

  getState(): PlayerState {
    return {
      x:  this.position.x,
      y:  this.position.y,
      z:  this.position.z,
      ry: this.camera.alpha,
    }
  }
}
